import { Composer } from "telegraf";
import { config } from "../../../config/env";
import { MyContext } from "../../../domain/types";
import { countCartItems } from "../../../repositories/carts.repo";
import { findUserById } from "../../../repositories/users.repo";
import { bold, esc } from "../../ui/format";
import { CB, mainMenuKeyboard } from "../../ui/keyboards";
import { ack, render } from "../../ui/reply";

/** Recarrega o usuário quando o cadastro acabou de ser concluído. */
async function ensureUser(ctx: MyContext, reload: boolean) {
  if ((reload || !ctx.dbUser) && ctx.from?.id) {
    ctx.dbUser = await findUserById(ctx.from.id);
  }
  return ctx.dbUser;
}

export async function showMainMenu(ctx: MyContext, reload = false): Promise<void> {
  const user = await ensureUser(ctx, reload);
  if (!user) return;

  const cartCount = await countCartItems(user.id);
  const firstName = user.name.split(" ")[0] ?? user.name;

  const text =
    `${bold(config.storeName)}\n\n` +
    `Olá, ${esc(firstName)}! O que você quer fazer?` +
    (cartCount > 0 ? `\n\nVocê tem ${cartCount} item(ns) no carrinho.` : "");

  await render(ctx, text, mainMenuKeyboard(cartCount, ctx.isAdmin));
}

export const menuHandlers = new Composer<MyContext>();

menuHandlers.action(CB.menu, async (ctx) => {
  await ack(ctx);
  await showMainMenu(ctx);
});

menuHandlers.action(CB.noop, async (ctx) => ack(ctx));

menuHandlers.command("menu", async (ctx) => showMainMenu(ctx));

menuHandlers.command("ajuda", async (ctx) => {
  await render(
    ctx,
    `${bold("Como usar o bot")}\n\n` +
      `/start — iniciar ou voltar ao menu\n` +
      `/menu — abrir o menu principal\n` +
      `/carrinho — ver seu carrinho\n` +
      `/pedidos — acompanhar seus pedidos\n` +
      `/dados — conferir seus dados de entrega\n` +
      `/cancelar — sair de um cadastro em andamento\n` +
      `/ajuda — mostrar esta mensagem\n\n` +
      `Pagamento por Pix, cartão ou boleto, processado pelo Mercado Pago.`
  );
});
