import { Composer, Markup, Scenes } from "telegraf";
import { MyContext } from "../../../domain/types";
import {
  applyCouponByCode,
  changeCartQuantity,
  emptyCart,
  getCartTotals,
  removeCoupon,
  removeFromCart,
} from "../../../services/cart.service";
import { bold, esc } from "../../ui/format";
import { CB, btn, cb, cbArgs, rows } from "../../ui/keyboards";
import { ack, render, send } from "../../ui/reply";
import { renderCart } from "../../ui/views";

export const COUPON_SCENE = "coupon";

export const cartHandlers = new Composer<MyContext>();

export async function showCart(ctx: MyContext): Promise<void> {
  if (!ctx.dbUser) return;

  const totals = await getCartTotals(ctx.dbUser);

  if (totals.lines.length === 0) {
    await render(
      ctx,
      renderCart(totals),
      Markup.inlineKeyboard([
        [btn.cb("Ver catálogo", CB.catalog)],
        [btn.cb("‹ Menu principal", CB.menu)],
      ])
    );
    return;
  }

  const lineRows = totals.lines.map((line) => [
    btn.cb("−", cb(CB.cartDec, line.cart_item_id)),
    btn.cb(`${line.quantity}× ${line.item_title}`.slice(0, 28), CB.noop),
    btn.cb("+", cb(CB.cartInc, line.cart_item_id)),
    btn.cb("🗑", cb(CB.cartRemove, line.cart_item_id)),
  ]);

  const couponRow = totals.coupon
    ? [btn.cb(`Remover cupom ${totals.coupon.code}`.slice(0, 40), CB.couponRemove)]
    : [btn.cb("Tenho um cupom", CB.couponApply)];

  const keyboard = Markup.inlineKeyboard(
    rows(
      ...lineRows,
      couponRow,
      [btn.cb("Finalizar compra", CB.checkout)],
      [btn.cb("Esvaziar carrinho", CB.cartClear), btn.cb("Continuar comprando", CB.catalog)],
      [btn.cb("‹ Menu principal", CB.menu)]
    )
  );

  await render(ctx, renderCart(totals), keyboard);
}

cartHandlers.action(CB.cartOpen, async (ctx) => {
  await ack(ctx);
  await showCart(ctx);
});

cartHandlers.command("carrinho", async (ctx) => showCart(ctx));

cartHandlers.action(new RegExp(`^${CB.cartInc}:(\\d+)$`), async (ctx) => {
  if (!ctx.dbUser) return ack(ctx);
  const [id] = cbArgs(ctx.match[0], CB.cartInc);
  await changeCartQuantity(ctx.dbUser.id, Number(id), 1);
  await ack(ctx);
  await showCart(ctx);
});

cartHandlers.action(new RegExp(`^${CB.cartDec}:(\\d+)$`), async (ctx) => {
  if (!ctx.dbUser) return ack(ctx);
  const [id] = cbArgs(ctx.match[0], CB.cartDec);
  await changeCartQuantity(ctx.dbUser.id, Number(id), -1);
  await ack(ctx);
  await showCart(ctx);
});

cartHandlers.action(new RegExp(`^${CB.cartRemove}:(\\d+)$`), async (ctx) => {
  if (!ctx.dbUser) return ack(ctx);
  const [id] = cbArgs(ctx.match[0], CB.cartRemove);
  await removeFromCart(ctx.dbUser.id, Number(id));
  await ack(ctx, "Item removido.");
  await showCart(ctx);
});

cartHandlers.action(CB.cartClear, async (ctx) => {
  if (!ctx.dbUser) return ack(ctx);
  await emptyCart(ctx.dbUser.id);
  await ack(ctx, "Carrinho esvaziado.");
  await showCart(ctx);
});

cartHandlers.action(CB.couponRemove, async (ctx) => {
  if (!ctx.dbUser) return ack(ctx);
  await removeCoupon(ctx.dbUser.id);
  await ack(ctx, "Cupom removido.");
  await showCart(ctx);
});

cartHandlers.action(CB.couponApply, async (ctx) => {
  await ack(ctx);
  await ctx.scene.enter(COUPON_SCENE);
});

/** Cena dedicada para digitar o cupom, evitando handlers globais de texto. */
export const couponScene = new Scenes.WizardScene<MyContext>(
  COUPON_SCENE,

  async (ctx) => {
    await send(
      ctx,
      `${bold("Cupom de desconto")}\n\nEnvie o código do cupom.\n\n` +
        `Envie /cancelar para voltar ao carrinho.`
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const message = ctx.message;
    if (!message || !("text" in message)) {
      return send(ctx, "Envie o código do cupom em texto.");
    }

    const code = message.text.trim();
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(code)) {
      return send(ctx, "Código inválido. Use apenas letras, números, hífen e underscore.");
    }

    if (!ctx.dbUser) return ctx.scene.leave();

    try {
      const applied = await applyCouponByCode(ctx.dbUser, code);
      await send(ctx, `Cupom ${bold(esc(applied))} aplicado com sucesso!`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Cupom inválido.";
      await send(ctx, `${esc(reason)}\n\nEnvie outro código ou /cancelar para voltar.`);
      return;
    }

    await ctx.scene.leave();
    return showCart(ctx);
  }
);

couponScene.command("cancelar", async (ctx) => {
  await ctx.scene.leave();
  return showCart(ctx);
});
