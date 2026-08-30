import { Telegraf, Scenes, session } from "telegraf";
import { config } from "./config";
import { MyContext } from "./types";
import { adminCommands, newItemWizard, registerShipAction } from "./handlers/admin";
import { customerCommands, registrationWizard } from "./handlers/customer";

const stage = new Scenes.Stage<MyContext>([registrationWizard, newItemWizard]);

export function createBot(): Telegraf<MyContext> {
  const bot = new Telegraf<MyContext>(config.telegram.botToken, {
    telegram: { webhookReply: true },
  });

  bot.use(session());
  bot.use(stage.middleware());

  bot.use(customerCommands);
  bot.use(adminCommands);
  registerShipAction(bot);

  bot.catch((err, ctx) => {
    console.error(`Erro no bot para ${ctx.updateType}:`, err);
  });

  return bot;
}
