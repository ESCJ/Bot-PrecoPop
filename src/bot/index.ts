import { Composer, Scenes, Telegraf, session } from "telegraf";
import { config } from "../config/env";
import { MyContext, MySession } from "../domain/types";
import { logger } from "../infra/logger";
import { createPostgresSessionStore } from "../infra/telegram/session-store";
import {
  contextEnricher,
  errorBoundary,
  rateLimit,
  requestLogger,
  userLoader,
} from "./middlewares";
import { registrationScene, REGISTRATION_SCENE } from "./scenes/registration.scene";
import { couponScene, cartHandlers } from "./handlers/customer/cart";
import { catalogHandlers } from "./handlers/customer/catalog";
import { checkoutHandlers } from "./handlers/customer/checkout";
import { menuHandlers, showMainMenu } from "./handlers/customer/menu";
import { ordersHandlers } from "./handlers/customer/orders";
import { profileEditScene, profileHandlers } from "./handlers/customer/profile";
import { adminPanelHandlers } from "./handlers/admin/panel";
import {
  adminItemsHandlers,
  itemEditScene,
  newItemScene,
  variantScene,
} from "./handlers/admin/items";
import { adminOrdersHandlers, trackingScene } from "./handlers/admin/orders";
import {
  adminMarketingHandlers,
  couponCreateScene,
  shippingEditScene,
} from "./handlers/admin/marketing";
import { adminBroadcastHandlers, broadcastScene } from "./handlers/admin/broadcast";
import { send } from "./ui/reply";
import { bold } from "./ui/format";

/** Restringe um conjunto de handlers a administradores. */
function adminScope(...handlers: Composer<MyContext>[]) {
  const combined = Composer.compose<MyContext>(handlers.map((handler) => handler.middleware()));
  return Composer.optional<MyContext>((ctx) => ctx.isAdmin, combined);
}

export function createBot(): Telegraf<MyContext> {
  const bot = new Telegraf<MyContext>(config.telegram.botToken, {
    handlerTimeout: 60_000,
  });

  const stage = new Scenes.Stage<MyContext>([
    registrationScene,
    profileEditScene,
    couponScene,
    newItemScene,
    variantScene,
    itemEditScene,
    trackingScene,
    couponCreateScene,
    shippingEditScene,
    broadcastScene,
  ]);

  bot.use(contextEnricher);
  bot.use(errorBoundary);
  bot.use(requestLogger);
  bot.use(rateLimit);
  bot.use(
    session({
      store: createPostgresSessionStore<MySession>(),
      defaultSession: () => ({}) as MySession,
    })
  );
  bot.use(userLoader);
  bot.use(stage.middleware());

  bot.start(async (ctx) => {
    if (!ctx.dbUser) {
      return ctx.scene.enter(REGISTRATION_SCENE);
    }
    return showMainMenu(ctx);
  });

  bot.command("cancelar", async (ctx) => {
    await send(ctx, "Não há nada em andamento para cancelar.");
    if (ctx.dbUser) await showMainMenu(ctx);
  });

  /** Compras exigem cadastro concluído. */
  bot.use(async (ctx, next) => {
    const isCommandOrCallback =
      ctx.callbackQuery !== undefined ||
      (ctx.message !== undefined && "text" in ctx.message && ctx.message.text.startsWith("/"));

    if (isCommandOrCallback && !ctx.dbUser) {
      await send(
        ctx,
        `${bold("Cadastro necessário")}\n\nEnvie /start para se cadastrar e começar a comprar.`
      );
      return;
    }
    return next();
  });

  bot.use(menuHandlers);
  bot.use(catalogHandlers);
  bot.use(cartHandlers);
  bot.use(checkoutHandlers);
  bot.use(ordersHandlers);
  bot.use(profileHandlers);

  bot.use(
    adminScope(
      adminPanelHandlers,
      adminItemsHandlers,
      adminOrdersHandlers,
      adminMarketingHandlers,
      adminBroadcastHandlers
    )
  );

  // Callback administrativo que chegou até aqui veio de quem não é admin.
  bot.action(/^adm(:|$)/, async (ctx) => {
    logger.warn({ userId: ctx.from?.id }, "Tentativa de acesso administrativo negada");
    await ctx.answerCbQuery("Acesso restrito.", { show_alert: true }).catch(() => undefined);
  });

  bot.on("message", async (ctx) => {
    if (!ctx.dbUser) return;
    await send(ctx, "Não entendi. Use /menu para ver as opções ou /ajuda para os comandos.");
  });

  bot.catch((err, ctx) => {
    logger.error({ err, updateType: ctx.updateType }, "Erro capturado no nível do Telegraf");
  });

  return bot;
}

export async function registerBotCommands(bot: Telegraf<MyContext>): Promise<void> {
  try {
    await bot.telegram.setMyCommands([
      { command: "start", description: "Iniciar ou voltar ao menu" },
      { command: "menu", description: "Menu principal" },
      { command: "carrinho", description: "Ver o carrinho" },
      { command: "pedidos", description: "Meus pedidos" },
      { command: "dados", description: "Meus dados de entrega" },
      { command: "ajuda", description: "Como usar o bot" },
      { command: "cancelar", description: "Cancelar operação em andamento" },
    ]);
  } catch (err) {
    logger.warn({ err }, "Não foi possível registrar os comandos do bot");
  }
}
