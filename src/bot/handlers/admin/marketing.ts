import { Composer, Markup, Scenes } from "telegraf";
import { MyContext, CouponKind } from "../../../domain/types";
import { formatPrice, parsePriceToCents, parseQuantity } from "../../../domain/money";
import {
  createCoupon,
  deleteCoupon,
  findCouponByCode,
  listCoupons,
  setCouponActive,
} from "../../../repositories/coupons.repo";
import { listRates, upsertRate } from "../../../repositories/shipping.repo";
import { isValidState } from "../../../domain/cep";
import { describeCoupon } from "../../../services/coupons.service";
import { bold, esc, formatDateOnly } from "../../ui/format";
import { CB, btn, cb, cbArgs, rows } from "../../ui/keyboards";
import { ack, render, send } from "../../ui/reply";
import { showAdminPanel } from "./panel";

export const COUPON_CREATE_SCENE = "adminCouponCreate";
export const SHIPPING_EDIT_SCENE = "adminShippingEdit";

export const adminMarketingHandlers = new Composer<MyContext>();

/* ------------------------------------------------------------------ */
/* Cupons                                                              */
/* ------------------------------------------------------------------ */

async function showCoupons(ctx: MyContext): Promise<void> {
  const coupons = await listCoupons();

  const lines =
    coupons.length > 0
      ? coupons
          .map((coupon) => {
            const uses = coupon.max_uses
              ? `${coupon.used_count}/${coupon.max_uses}`
              : `${coupon.used_count}`;
            const expiry = coupon.expires_at ? ` · até ${formatDateOnly(coupon.expires_at)}` : "";
            const minimum =
              coupon.min_order_cents > 0 ? ` · mín. ${formatPrice(coupon.min_order_cents)}` : "";
            return (
              `${coupon.active ? "✅" : "⏸"} ${bold(esc(coupon.code))} — ` +
              `${esc(describeCoupon(coupon))} · usos ${uses}${minimum}${expiry}`
            );
          })
          .join("\n")
      : "Nenhum cupom cadastrado.";

  const couponRows = coupons
    .slice(0, 10)
    .map((coupon) => [
      btn.cb(
        `${coupon.active ? "Desativar" : "Ativar"} ${coupon.code}`.slice(0, 30),
        cb(CB.adminCouponToggle, coupon.id)
      ),
      btn.cb("🗑", cb(CB.adminCouponDelete, coupon.id)),
    ]);

  await render(
    ctx,
    `${bold("Cupons de desconto")}\n\n${lines}`,
    Markup.inlineKeyboard(
      rows(
        ...couponRows,
        [btn.cb("Criar cupom", CB.adminCouponNew)],
        [btn.cb("‹ Painel", CB.admin)]
      )
    )
  );
}

adminMarketingHandlers.action(CB.adminCoupons, async (ctx) => {
  await ack(ctx);
  await showCoupons(ctx);
});

adminMarketingHandlers.action(new RegExp(`^${CB.adminCouponToggle}:(\\d+)$`), async (ctx) => {
  const [idRaw] = cbArgs(ctx.match[0], CB.adminCouponToggle);
  const coupons = await listCoupons();
  const coupon = coupons.find((entry) => entry.id === Number(idRaw));
  if (!coupon) return ack(ctx, "Cupom não encontrado.");

  await setCouponActive(coupon.id, !coupon.active);
  await ack(ctx, coupon.active ? "Cupom desativado." : "Cupom ativado.");
  await showCoupons(ctx);
});

adminMarketingHandlers.action(new RegExp(`^${CB.adminCouponDelete}:(\\d+)$`), async (ctx) => {
  const [idRaw] = cbArgs(ctx.match[0], CB.adminCouponDelete);
  await deleteCoupon(Number(idRaw));
  await ack(ctx, "Cupom excluído.");
  await showCoupons(ctx);
});

adminMarketingHandlers.action(CB.adminCouponNew, async (ctx) => {
  await ack(ctx);
  await ctx.scene.enter(COUPON_CREATE_SCENE);
});

interface CouponDraft {
  code?: string;
  kind?: CouponKind;
  value?: number;
  minOrderCents?: number;
  maxUses?: number | null;
}

function couponDraft(ctx: MyContext): CouponDraft {
  const state = ctx.scene.session.state as { draft?: CouponDraft } | undefined;
  if (!state?.draft) {
    ctx.scene.session.state = { ...(ctx.scene.session.state ?? {}), draft: {} };
  }
  return (ctx.scene.session.state as { draft: CouponDraft }).draft;
}

function textOf(ctx: MyContext): string | null {
  const message = ctx.message;
  if (message && "text" in message) return message.text.trim();
  return null;
}

export const couponCreateScene = new Scenes.WizardScene<MyContext>(
  COUPON_CREATE_SCENE,

  async (ctx) => {
    await send(
      ctx,
      `${bold("Novo cupom")}\n\nEnvie o ${bold("código")} do cupom. Exemplo: BEMVINDO10\n\n` +
        `Envie /cancelar para sair.`
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const value = textOf(ctx);
    if (!value) return send(ctx, "Envie o código em texto.");

    const code = value.toUpperCase();
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
      return send(ctx, "Código inválido. Use letras, números, hífen e underscore (3 a 32).");
    }

    const existing = await findCouponByCode(code);
    if (existing) return send(ctx, "Já existe um cupom com esse código. Escolha outro.");

    couponDraft(ctx).code = code;

    await send(
      ctx,
      `Qual é o ${bold("tipo")} do cupom?\n\n` +
        `1 — Percentual (ex: 10% de desconto)\n` +
        `2 — Valor fixo (ex: R$ 15,00 de desconto)\n` +
        `3 — Frete grátis\n\n` +
        `Envie 1, 2 ou 3.`
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const value = textOf(ctx);
    const kinds: Record<string, CouponKind> = {
      "1": "percent",
      "2": "fixed",
      "3": "free_shipping",
    };
    const kind = value ? kinds[value] : undefined;
    if (!kind) return send(ctx, "Opção inválida. Envie 1, 2 ou 3.");

    couponDraft(ctx).kind = kind;

    if (kind === "free_shipping") {
      couponDraft(ctx).value = 0;
      await send(
        ctx,
        `Qual é o ${bold("valor mínimo do pedido")} para usar o cupom?\n\n` +
          `Envie ${bold("0")} para não exigir mínimo.`
      );
      ctx.wizard.selectStep(4);
      return;
    }

    await send(
      ctx,
      kind === "percent"
        ? `Qual é o ${bold("percentual")} de desconto? Envie um número de 1 a 100.`
        : `Qual é o ${bold("valor")} do desconto? Exemplo: 15,00`
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const value = textOf(ctx);
    if (!value) return send(ctx, "Envie o valor em texto.");

    const draft = couponDraft(ctx);

    if (draft.kind === "percent") {
      const percent = parseQuantity(value, 100);
      if (percent === null) return send(ctx, "Percentual inválido. Envie um número de 1 a 100.");
      draft.value = percent;
    } else {
      const cents = parsePriceToCents(value);
      if (cents === null) return send(ctx, "Valor inválido. Envie no formato 15,00.");
      draft.value = cents;
    }

    await send(
      ctx,
      `Qual é o ${bold("valor mínimo do pedido")} para usar o cupom?\n\n` +
        `Envie ${bold("0")} para não exigir mínimo.`
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const value = textOf(ctx);
    if (!value) return send(ctx, "Envie o valor mínimo ou 0.");

    const draft = couponDraft(ctx);
    if (value === "0") {
      draft.minOrderCents = 0;
    } else {
      const cents = parsePriceToCents(value);
      if (cents === null) return send(ctx, "Valor inválido. Envie no formato 50,00 ou 0.");
      draft.minOrderCents = cents;
    }

    await send(
      ctx,
      `Quantas vezes o cupom pode ser usado no total?\n\n` +
        `Envie um número, ou ${bold("ilimitado")}.`
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const value = textOf(ctx);
    if (!value) return send(ctx, "Envie o limite de usos ou a palavra ilimitado.");

    const draft = couponDraft(ctx);

    if (value.toLowerCase() === "ilimitado") {
      draft.maxUses = null;
    } else {
      const uses = parseQuantity(value, 9999);
      if (uses === null) return send(ctx, "Número inválido. Envie de 1 a 9999 ou ilimitado.");
      draft.maxUses = uses;
    }

    if (!draft.code || !draft.kind || draft.value === undefined) {
      await send(ctx, "Faltaram dados. Vamos recomeçar.");
      return ctx.scene.leave();
    }

    const coupon = await createCoupon({
      code: draft.code,
      kind: draft.kind,
      value: draft.value,
      minOrderCents: draft.minOrderCents ?? 0,
      maxUses: draft.maxUses ?? null,
      expiresAt: null,
      createdBy: ctx.from!.id,
    });

    await ctx.scene.leave();
    await send(
      ctx,
      `${bold("Cupom criado!")}\n\n` +
        `Código: ${bold(esc(coupon.code))}\n` +
        `Benefício: ${esc(describeCoupon(coupon))}\n` +
        `Mínimo: ${coupon.min_order_cents > 0 ? formatPrice(coupon.min_order_cents) : "sem mínimo"}\n` +
        `Limite de usos: ${coupon.max_uses ?? "ilimitado"}`
    );
    return showCoupons(ctx);
  }
);

couponCreateScene.command("cancelar", async (ctx) => {
  await ctx.scene.leave();
  await send(ctx, "Criação cancelada.");
  return showAdminPanel(ctx);
});

/* ------------------------------------------------------------------ */
/* Frete                                                               */
/* ------------------------------------------------------------------ */

async function showShipping(ctx: MyContext): Promise<void> {
  const rates = await listRates();

  const lines = rates
    .map(
      (rate) =>
        `${rate.active ? "" : "⏸ "}${rate.state}: ${formatPrice(rate.price_cents)} · ` +
        `${rate.days_min}-${rate.days_max} dias`
    )
    .join("\n");

  await render(
    ctx,
    `${bold("Tabela de frete")}\n\n${lines || "Nenhuma faixa cadastrada."}\n\n` +
      `Para alterar, toque em Editar UF.`,
    Markup.inlineKeyboard([
      [btn.cb("Editar UF", CB.adminShippingEdit)],
      [btn.cb("‹ Painel", CB.admin)],
    ])
  );
}

adminMarketingHandlers.action(CB.adminShipping, async (ctx) => {
  await ack(ctx);
  await showShipping(ctx);
});

adminMarketingHandlers.action(CB.adminShippingEdit, async (ctx) => {
  await ack(ctx);
  await ctx.scene.enter(SHIPPING_EDIT_SCENE);
});

export const shippingEditScene = new Scenes.WizardScene<MyContext>(
  SHIPPING_EDIT_SCENE,

  async (ctx) => {
    await send(
      ctx,
      `${bold("Editar frete")}\n\nEnvie a ${bold("sigla do estado")}. Exemplo: SP\n\n` +
        `Envie /cancelar para sair.`
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const value = textOf(ctx);
    if (!value) return send(ctx, "Envie a sigla do estado.");

    const uf = value.toUpperCase();
    if (!isValidState(uf)) return send(ctx, "Sigla inválida. Envie duas letras, como SP ou RJ.");

    ctx.scene.session.state = { ...(ctx.scene.session.state ?? {}), state: uf };
    await send(ctx, `Qual é o ${bold("valor do frete")} para ${bold(uf)}? Exemplo: 24,90`);
    return ctx.wizard.next();
  },

  async (ctx) => {
    const value = textOf(ctx);
    if (!value) return send(ctx, "Envie o valor do frete.");

    const cents = value === "0" ? 0 : parsePriceToCents(value);
    if (cents === null) return send(ctx, "Valor inválido. Envie no formato 24,90 ou 0.");

    ctx.scene.session.state = { ...(ctx.scene.session.state ?? {}), priceCents: cents };
    await send(
      ctx,
      `Qual é o ${bold("prazo de entrega")}? Envie no formato ${bold("mínimo-máximo")}, ` +
        `por exemplo 3-7.`
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const value = textOf(ctx);
    if (!value) return send(ctx, "Envie o prazo no formato 3-7.");

    const match = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(value);
    if (!match) return send(ctx, "Formato inválido. Envie por exemplo 3-7.");

    const daysMin = Number(match[1]);
    const daysMax = Number(match[2]);
    if (daysMax < daysMin) return send(ctx, "O prazo máximo deve ser maior ou igual ao mínimo.");

    const state = ctx.scene.session.state as { state: string; priceCents: number };

    const rate = await upsertRate({
      state: state.state,
      priceCents: state.priceCents,
      daysMin,
      daysMax,
    });

    await ctx.scene.leave();
    await send(
      ctx,
      `${bold("Frete atualizado!")}\n\n` +
        `${esc(rate.state)}: ${formatPrice(rate.price_cents)} · ${rate.days_min}-${rate.days_max} dias`
    );
    return showShipping(ctx);
  }
);

shippingEditScene.command("cancelar", async (ctx) => {
  await ctx.scene.leave();
  await send(ctx, "Edição cancelada.");
  return showAdminPanel(ctx);
});
