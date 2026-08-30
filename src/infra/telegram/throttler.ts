import { logger } from "../logger";

const GLOBAL_INTERVAL_MS = 40; // ~25 mensagens por segundo
const PER_CHAT_INTERVAL_MS = 1_100; // ~1 mensagem por segundo por chat
const MAX_ATTEMPTS = 4;

interface QueuedTask<T> {
  chatId: number | string;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  attempt: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Erro de flood control do Telegram traz `retry_after` em segundos. */
function retryAfterSeconds(err: unknown): number | null {
  const parameters = (err as { parameters?: { retry_after?: number } })?.parameters;
  if (typeof parameters?.retry_after === "number") return parameters.retry_after;

  const response = (err as { response?: { parameters?: { retry_after?: number } } })?.response;
  if (typeof response?.parameters?.retry_after === "number") {
    return response.parameters.retry_after;
  }

  const code = (err as { code?: number })?.code;
  return code === 429 ? 1 : null;
}

/**
 * Fila de envio que respeita os limites do Telegram (global e por chat)
 * e reprocessa automaticamente respostas 429 usando o `retry_after` oficial.
 */
class TelegramThrottler {
  private queue: QueuedTask<unknown>[] = [];
  private running = false;
  private lastGlobalSend = 0;
  private lastChatSend = new Map<number | string, number>();

  schedule<T>(chatId: number | string, run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        chatId,
        run,
        resolve: resolve as (value: unknown) => void,
        reject,
        attempt: 0,
      } as QueuedTask<unknown>);
      void this.drain();
    });
  }

  get pending(): number {
    return this.queue.length;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      while (this.queue.length > 0) {
        const task = this.queue.shift()!;
        await this.waitForSlot(task.chatId);

        try {
          const result = await task.run();
          this.markSent(task.chatId);
          task.resolve(result);
        } catch (err) {
          const retryAfter = retryAfterSeconds(err);

          if (retryAfter !== null && task.attempt < MAX_ATTEMPTS) {
            task.attempt += 1;
            const waitMs = retryAfter * 1000 + 250 * task.attempt;
            logger.warn(
              { chatId: task.chatId, attempt: task.attempt, waitMs },
              "Flood control do Telegram; reagendando envio"
            );
            this.markSent(task.chatId);
            await sleep(waitMs);
            this.queue.unshift(task);
            continue;
          }

          this.markSent(task.chatId);
          task.reject(err);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async waitForSlot(chatId: number | string): Promise<void> {
    const now = Date.now();
    const globalWait = Math.max(0, this.lastGlobalSend + GLOBAL_INTERVAL_MS - now);
    const chatLast = this.lastChatSend.get(chatId) ?? 0;
    const chatWait = Math.max(0, chatLast + PER_CHAT_INTERVAL_MS - now);
    const wait = Math.max(globalWait, chatWait);
    if (wait > 0) await sleep(wait);
  }

  private markSent(chatId: number | string): void {
    const now = Date.now();
    this.lastGlobalSend = now;
    this.lastChatSend.set(chatId, now);

    // Evita crescimento indefinido do mapa em bases grandes.
    if (this.lastChatSend.size > 5_000) {
      const cutoff = now - PER_CHAT_INTERVAL_MS * 10;
      for (const [key, timestamp] of this.lastChatSend) {
        if (timestamp < cutoff) this.lastChatSend.delete(key);
      }
    }
  }
}

export const throttler = new TelegramThrottler();

/** Indica que o usuário bloqueou o bot ou apagou a conta. */
export function isUnreachableUserError(err: unknown): boolean {
  const description =
    (err as { description?: string })?.description ??
    (err as { response?: { description?: string } })?.response?.description ??
    (err as Error)?.message ??
    "";

  return /bot was blocked|user is deactivated|chat not found|bot can't initiate|USER_IS_BLOCKED/i.test(
    description
  );
}
