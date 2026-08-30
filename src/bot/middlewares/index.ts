import { MiddlewareFn } from "telegraf";
import crypto from "node:crypto";
import { config } from "../../config/env";
import { childLogger, logger } from "../../infra/logger";
import { MyContext } from "../../domain/types";
import { findUserById, markUserBlocked } from "../../repositories/users.repo";
import { isAppError } from "../../domain/errors";
import { isUnreachableUserError } from "../../infra/telegram/throttler";

/** Marca administradores e cria o id de correlação usado nos logs. */
export const contextEnricher: MiddlewareFn<MyContext> = async (ctx, next) => {
  ctx.requestId = crypto.randomUUID();
  const senderId = ctx.from?.id;
  ctx.isAdmin = senderId !== undefined && config.admin.chatIds.includes(senderId);
  return next();
};

/** Carrega o usuário cadastrado a cada update, sem confiar na sessão. */
export const userLoader: MiddlewareFn<MyContext> = async (ctx, next) => {
  if (ctx.from?.id) {
    ctx.dbUser = await findUserById(ctx.from.id);
  }
  return next();
};

/** Bloqueia handlers administrativos para quem não está na allowlist. */
export const adminOnly: MiddlewareFn<MyContext> = async (ctx, next) => {
  if (!ctx.isAdmin) {
    logger.warn({ userId: ctx.from?.id }, "Acesso negado a rota administrativa");
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery("Acesso restrito.", { show_alert: true }).catch(() => undefined);
    }
    return;
  }
  return next();
};

/**
 * Limitador por usuário (token bucket) para conter flood e abuso.
 * Administradores não são limitados.
 */
const BUCKET_CAPACITY = 20;
const REFILL_PER_SECOND = 2;
const buckets = new Map<number, { tokens: number; updatedAt: number }>();

export const rateLimit: MiddlewareFn<MyContext> = async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId || ctx.isAdmin) return next();

  const now = Date.now();
  const bucket = buckets.get(userId) ?? { tokens: BUCKET_CAPACITY, updatedAt: now };
  const elapsedSeconds = (now - bucket.updatedAt) / 1000;

  bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + elapsedSeconds * REFILL_PER_SECOND);
  bucket.updatedAt = now;

  if (bucket.tokens < 1) {
    buckets.set(userId, bucket);
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery("Calma aí! Aguarde um instante.").catch(() => undefined);
    }
    return;
  }

  bucket.tokens -= 1;
  buckets.set(userId, bucket);

  if (buckets.size > 10_000) {
    const cutoff = now - 60_000;
    for (const [key, value] of buckets) {
      if (value.updatedAt < cutoff) buckets.delete(key);
    }
  }

  return next();
};

/**
 * Fronteira de erro: nenhuma exceção deve derrubar o processo ou vazar
 * stack trace para o cliente. Erros de domínio viram mensagem amigável.
 */
export const errorBoundary: MiddlewareFn<MyContext> = async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    const log = childLogger({
      requestId: ctx.requestId,
      userId: ctx.from?.id,
      updateType: ctx.updateType,
    });

    if (isUnreachableUserError(err)) {
      if (ctx.from?.id) await markUserBlocked(ctx.from.id, true).catch(() => undefined);
      log.info("Usuário inacessível; marcado como bloqueado");
      return;
    }

    const friendly = isAppError(err)
      ? err.userMessage
      : "Ocorreu um erro inesperado. Tente novamente em instantes.";

    if (isAppError(err)) {
      log.warn({ code: err.code, err: err.message }, "Erro de domínio tratado");
    } else {
      log.error({ err }, "Erro não tratado no bot");
    }

    try {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery(friendly.slice(0, 200), { show_alert: true });
      } else {
        await ctx.reply(friendly);
      }
    } catch (replyErr) {
      log.error({ err: replyErr }, "Falha ao notificar o usuário sobre o erro");
    }
  }
};

/** Log estruturado por update, com duração. */
export const requestLogger: MiddlewareFn<MyContext> = async (ctx, next) => {
  const startedAt = Date.now();
  await next();
  childLogger({
    requestId: ctx.requestId,
    userId: ctx.from?.id,
    updateType: ctx.updateType,
    durationMs: Date.now() - startedAt,
  }).debug("Update processado");
};
