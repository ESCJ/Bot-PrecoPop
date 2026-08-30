import { Composer, Markup } from "telegraf";
import { MyContext } from "../../../domain/types";
import { formatPrice } from "../../../domain/money";
import {
  countAvailableItems,
  findItemWithStock,
  findVariantById,
  listAvailableItems,
  listAvailableVariantsByItem,
} from "../../../repositories/items.repo";
import { addVariantToCart, MAX_QUANTITY_PER_LINE } from "../../../services/cart.service";
import { bold, esc } from "../../ui/format";
import { CB, btn, cb, cbArgs, paginationRow, rows } from "../../ui/keyboards";
import { ack, render, sendPhoto } from "../../ui/reply";
import { renderVariant } from "../../ui/views";

const PAGE_SIZE = 6;

export const catalogHandlers = new Composer<MyContext>();

async function showCatalogPage(ctx: MyContext, page: number): Promise<void> {
  const total = await countAvailableItems();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);

  if (total === 0) {
    await render(
      ctx,
      `${bold("Catálogo")}\n\nNenhum produto disponível no momento. Volte em breve!`,
      Markup.inlineKeyboard([[btn.cb("‹ Menu principal", CB.menu)]])
    );
    return;
  }

  const items = await listAvailableItems(PAGE_SIZE, (safePage - 1) * PAGE_SIZE);
  ctx.session.catalogPage = safePage;

  const itemRows = items.map((item) => {
    const price =
      item.min_price_cents === item.max_price_cents
        ? formatPrice(item.min_price_cents)
        : `a partir de ${formatPrice(item.min_price_cents)}`;
    return [btn.cb(`${item.title} · ${price}`.slice(0, 60), cb(CB.itemView, item.id))];
  });

  const keyboard = Markup.inlineKeyboard(
    rows(...itemRows, paginationRow(CB.catalogPage, safePage, totalPages), [
      btn.cb("‹ Menu principal", CB.menu),
    ])
  );

  await render(
    ctx,
    `${bold("Catálogo")}\n\n` +
      `${total} produto(s) disponível(is). Toque em um item para ver os detalhes.`,
    keyboard
  );
}

catalogHandlers.action(CB.catalog, async (ctx) => {
  await ack(ctx);
  await showCatalogPage(ctx, ctx.session.catalogPage ?? 1);
});

catalogHandlers.action(new RegExp(`^${CB.catalogPage}:(\\d+)$`), async (ctx) => {
  await ack(ctx);
  const page = Number(ctx.match[1]);
  await showCatalogPage(ctx, Number.isFinite(page) ? page : 1);
});

/** Detalhe do item: mostra a foto e as opções disponíveis. */
catalogHandlers.action(new RegExp(`^${CB.itemView}:(\\d+)$`), async (ctx) => {
  await ack(ctx);
  const itemId = Number(ctx.match[1]);

  const item = await findItemWithStock(itemId);
  if (!item || !item.active || item.total_available <= 0) {
    await ack(ctx, "Este produto não está mais disponível.");
    await showCatalogPage(ctx, ctx.session.catalogPage ?? 1);
    return;
  }

  const variants = await listAvailableVariantsByItem(itemId);
  if (variants.length === 0) {
    await ack(ctx, "Este produto esgotou.");
    await showCatalogPage(ctx, ctx.session.catalogPage ?? 1);
    return;
  }

  const singleVariant = variants.length === 1 && variants[0]!.name === "Padrão";

  const caption =
    `${bold(item.title)}\n\n${esc(item.description)}\n\n` +
    (singleVariant
      ? `Preço: ${bold(formatPrice(variants[0]!.effective_price_cents))}\n` +
        `Disponível: ${variants[0]!.available} unidade(s)`
      : `Escolha uma opção abaixo:`);

  const variantRows = singleVariant
    ? [[btn.cb("Adicionar ao carrinho", cb(CB.variantPick, variants[0]!.id))]]
    : variants.map((variant) => [
        btn.cb(
          `${variant.name} · ${formatPrice(variant.effective_price_cents)} (${variant.available})`.slice(
            0,
            60
          ),
          cb(CB.variantPick, variant.id)
        ),
      ]);

  const keyboard = Markup.inlineKeyboard(
    rows(...variantRows, [btn.cb("‹ Voltar ao catálogo", CB.catalog)])
  );

  await sendPhoto(ctx, item.photo_file_id, caption, keyboard);
});

/** Seletor de quantidade por botões — sem digitação, sem colisão de regex. */
function quantityKeyboard(variantId: number, quantity: number, max: number) {
  const decrement = Math.max(1, quantity - 1);
  const increment = Math.min(max, quantity + 1);

  return Markup.inlineKeyboard(
    rows(
      [
        btn.cb("−", cb(CB.variantPick, variantId, decrement)),
        btn.cb(`${quantity}`, CB.noop),
        btn.cb("+", cb(CB.variantPick, variantId, increment)),
      ],
      [btn.cb(`Adicionar ${quantity} ao carrinho`, cb(CB.cartAdd, variantId, quantity))],
      [btn.cb("‹ Voltar ao catálogo", CB.catalog)]
    )
  );
}

catalogHandlers.action(new RegExp(`^${CB.variantPick}:(\\d+)(?::(\\d+))?$`), async (ctx) => {
  await ack(ctx);
  const [variantIdRaw, quantityRaw] = cbArgs(ctx.match[0], CB.variantPick);
  const variantId = Number(variantIdRaw);
  const requested = quantityRaw ? Number(quantityRaw) : 1;

  const variant = await findVariantById(variantId);
  if (!variant || !variant.active || !variant.item_active || variant.available <= 0) {
    await ack(ctx, "Esta opção esgotou.");
    await showCatalogPage(ctx, ctx.session.catalogPage ?? 1);
    return;
  }

  const max = Math.min(variant.available, MAX_QUANTITY_PER_LINE);
  const quantity = Math.min(Math.max(requested, 1), max);

  const text =
    `${renderVariant(variant)}\n\n` +
    `Quantidade: ${bold(quantity)}\n` +
    `Subtotal: ${bold(formatPrice(variant.effective_price_cents * quantity))}`;

  await render(ctx, text, quantityKeyboard(variantId, quantity, max));
});

catalogHandlers.action(new RegExp(`^${CB.cartAdd}:(\\d+):(\\d+)$`), async (ctx) => {
  const [variantIdRaw, quantityRaw] = cbArgs(ctx.match[0], CB.cartAdd);
  const variantId = Number(variantIdRaw);
  const quantity = Number(quantityRaw);

  if (!ctx.dbUser) {
    await ack(ctx, "Complete seu cadastro com /start antes de comprar.");
    return;
  }

  await addVariantToCart(ctx.dbUser.id, variantId, quantity);
  await ack(ctx, "Adicionado ao carrinho!");

  await render(
    ctx,
    `${bold("Produto adicionado ao carrinho")}\n\nO que deseja fazer agora?`,
    Markup.inlineKeyboard([
      [btn.cb("Ir para o carrinho", CB.cartOpen)],
      [btn.cb("Continuar comprando", CB.catalog)],
      [btn.cb("‹ Menu principal", CB.menu)],
    ])
  );
});
