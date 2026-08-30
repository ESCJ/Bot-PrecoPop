import { Composer, Markup, Scenes } from "telegraf";
import { MyContext } from "../../../domain/types";
import { formatPrice, parsePriceToCents, parseQuantity } from "../../../domain/money";
import {
  countAllItems,
  createItem,
  createVariant,
  deleteItem,
  deleteVariant,
  findItemWithStock,
  findVariantById,
  listAllItems,
  listVariantsByItem,
  updateItem,
  updateVariant,
} from "../../../repositories/items.repo";
import { bold, esc } from "../../ui/format";
import { CB, btn, cb, cbArgs, paginationRow, rows } from "../../ui/keyboards";
import { ack, render, send, sendPhoto } from "../../ui/reply";
import { showAdminPanel } from "./panel";

export const NEW_ITEM_SCENE = "adminNewItem";
export const VARIANT_SCENE = "adminVariant";
export const ITEM_EDIT_SCENE = "adminItemEdit";

const PAGE_SIZE = 6;

export const adminItemsHandlers = new Composer<MyContext>();

/* ------------------------------------------------------------------ */
/* Listagem e detalhe                                                  */
/* ------------------------------------------------------------------ */

async function showItemsPage(ctx: MyContext, page: number): Promise<void> {
  const total = await countAllItems();

  if (total === 0) {
    await render(
      ctx,
      `${bold("Produtos")}\n\nNenhum produto cadastrado ainda.`,
      Markup.inlineKeyboard([
        [btn.cb("Cadastrar produto", CB.adminNewItem)],
        [btn.cb("‹ Painel", CB.admin)],
      ])
    );
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  ctx.session.adminItemsPage = safePage;

  const items = await listAllItems(PAGE_SIZE, (safePage - 1) * PAGE_SIZE);

  const itemRows = items.map((item) => {
    const status = !item.active ? "⏸" : item.total_available > 0 ? "✅" : "❌";
    return [
      btn.cb(
        `${status} ${item.title} · ${item.total_available} un.`.slice(0, 60),
        cb(CB.adminItemView, item.id)
      ),
    ];
  });

  await render(
    ctx,
    `${bold("Produtos")}\n\n✅ disponível · ❌ esgotado · ⏸ inativo`,
    Markup.inlineKeyboard(
      rows(
        ...itemRows,
        paginationRow(CB.adminItemsPage, safePage, totalPages),
        [btn.cb("Novo produto", CB.adminNewItem)],
        [btn.cb("‹ Painel", CB.admin)]
      )
    )
  );
}

adminItemsHandlers.action(new RegExp(`^${CB.adminItemsPage}:(\\d+)$`), async (ctx) => {
  await ack(ctx);
  const [page] = cbArgs(ctx.match[0], CB.adminItemsPage);
  await showItemsPage(ctx, Number(page) || 1);
});

async function showItemDetail(ctx: MyContext, itemId: number): Promise<void> {
  const item = await findItemWithStock(itemId);
  if (!item) {
    await ack(ctx, "Produto não encontrado.");
    return showItemsPage(ctx, ctx.session.adminItemsPage ?? 1);
  }

  const variants = await listVariantsByItem(itemId);

  const variantLines = variants
    .map(
      (variant) =>
        `• ${esc(variant.name)} — ${formatPrice(variant.effective_price_cents)} · ` +
        `estoque ${variant.stock} (${variant.reserved} reservado)` +
        (variant.active ? "" : " · inativa")
    )
    .join("\n");

  const text =
    `${bold(item.title)}\n\n${esc(item.description)}\n\n` +
    `Preço base: ${formatPrice(item.price_cents)}\n` +
    `Status: ${item.active ? "ativo" : "inativo"}\n` +
    `Disponível: ${item.total_available} de ${item.total_stock}\n\n` +
    `${bold("Variações")}\n${variantLines || "Nenhuma variação cadastrada."}`;

  const variantRows = variants.map((variant) => [
    btn.cb(`Estoque: ${variant.name}`.slice(0, 30), cb(CB.adminVariantStock, variant.id)),
    btn.cb(variant.active ? "Desativar" : "Ativar", cb(CB.adminVariantToggle, variant.id)),
    btn.cb("🗑", cb(CB.adminVariantDelete, variant.id)),
  ]);

  const keyboard = Markup.inlineKeyboard(
    rows(
      ...variantRows,
      [btn.cb("Adicionar variação", cb(CB.adminVariantAdd, itemId))],
      [btn.cb("Editar produto", cb(CB.adminItemEdit, itemId))],
      [
        btn.cb(
          item.active ? "Desativar produto" : "Ativar produto",
          cb(CB.adminItemToggle, itemId)
        ),
        btn.cb("Excluir", cb(CB.adminItemDelete, itemId)),
      ],
      [btn.cb("‹ Produtos", cb(CB.adminItemsPage, ctx.session.adminItemsPage ?? 1))]
    )
  );

  await render(ctx, text, keyboard);
}

adminItemsHandlers.action(new RegExp(`^${CB.adminItemView}:(\\d+)$`), async (ctx) => {
  await ack(ctx);
  const [id] = cbArgs(ctx.match[0], CB.adminItemView);
  await showItemDetail(ctx, Number(id));
});

adminItemsHandlers.action(new RegExp(`^${CB.adminItemToggle}:(\\d+)$`), async (ctx) => {
  const [idRaw] = cbArgs(ctx.match[0], CB.adminItemToggle);
  const id = Number(idRaw);

  const item = await findItemWithStock(id);
  if (!item) return ack(ctx, "Produto não encontrado.");

  await updateItem(id, { active: !item.active });
  await ack(ctx, item.active ? "Produto desativado." : "Produto ativado.");
  await showItemDetail(ctx, id);
});

/** Exclusão exige confirmação explícita. */
adminItemsHandlers.action(new RegExp(`^${CB.adminItemDelete}:(\\d+)$`), async (ctx) => {
  await ack(ctx);
  const [idRaw] = cbArgs(ctx.match[0], CB.adminItemDelete);
  const id = Number(idRaw);

  const item = await findItemWithStock(id);
  if (!item) return ack(ctx, "Produto não encontrado.");

  await render(
    ctx,
    `${bold("Excluir produto")}\n\n` +
      `Tem certeza que deseja excluir ${bold(esc(item.title))}?\n\n` +
      `Esta ação remove o produto e todas as suas variações. ` +
      `O histórico de pedidos é preservado.`,
    Markup.inlineKeyboard([
      [btn.cb("Sim, excluir", cb(CB.adminItemDeleteYes, id))],
      [btn.cb("Não, voltar", cb(CB.adminItemView, id))],
    ])
  );
});

adminItemsHandlers.action(new RegExp(`^${CB.adminItemDeleteYes}:(\\d+)$`), async (ctx) => {
  const [idRaw] = cbArgs(ctx.match[0], CB.adminItemDeleteYes);
  await deleteItem(Number(idRaw));
  await ack(ctx, "Produto excluído.");
  await showItemsPage(ctx, ctx.session.adminItemsPage ?? 1);
});

adminItemsHandlers.action(new RegExp(`^${CB.adminVariantToggle}:(\\d+)$`), async (ctx) => {
  const [idRaw] = cbArgs(ctx.match[0], CB.adminVariantToggle);
  const variant = await findVariantById(Number(idRaw));
  if (!variant) return ack(ctx, "Variação não encontrada.");

  await updateVariant(variant.id, { active: !variant.active });
  await ack(ctx, variant.active ? "Variação desativada." : "Variação ativada.");
  await showItemDetail(ctx, variant.item_id);
});

adminItemsHandlers.action(new RegExp(`^${CB.adminVariantDelete}:(\\d+)$`), async (ctx) => {
  const [idRaw] = cbArgs(ctx.match[0], CB.adminVariantDelete);
  const variant = await findVariantById(Number(idRaw));
  if (!variant) return ack(ctx, "Variação não encontrada.");

  const siblings = await listVariantsByItem(variant.item_id);
  if (siblings.length <= 1) {
    return ack(ctx, "O produto precisa de ao menos uma variação.");
  }

  await deleteVariant(variant.id);
  await ack(ctx, "Variação excluída.");
  await showItemDetail(ctx, variant.item_id);
});

adminItemsHandlers.action(new RegExp(`^${CB.adminVariantStock}:(\\d+)$`), async (ctx) => {
  await ack(ctx);
  const [id] = cbArgs(ctx.match[0], CB.adminVariantStock);
  await ctx.scene.enter(VARIANT_SCENE, { mode: "stock", variantId: Number(id) });
});

adminItemsHandlers.action(new RegExp(`^${CB.adminVariantAdd}:(\\d+)$`), async (ctx) => {
  await ack(ctx);
  const [id] = cbArgs(ctx.match[0], CB.adminVariantAdd);
  await ctx.scene.enter(VARIANT_SCENE, { mode: "create", itemId: Number(id) });
});

adminItemsHandlers.action(new RegExp(`^${CB.adminItemEdit}:(\\d+)$`), async (ctx) => {
  await ack(ctx);
  const [id] = cbArgs(ctx.match[0], CB.adminItemEdit);
  await ctx.scene.enter(ITEM_EDIT_SCENE, { itemId: Number(id) });
});

adminItemsHandlers.action(CB.adminNewItem, async (ctx) => {
  await ack(ctx);
  await ctx.scene.enter(NEW_ITEM_SCENE);
});

/* ------------------------------------------------------------------ */
/* Cena: cadastro de produto                                           */
/* ------------------------------------------------------------------ */

interface NewItemDraft {
  title?: string;
  description?: string;
  priceCents?: number;
  photoFileId?: string | null;
  stock?: number;
}

function newItemDraft(ctx: MyContext): NewItemDraft {
  const state = ctx.scene.session.state as { draft?: NewItemDraft } | undefined;
  if (!state?.draft) {
    ctx.scene.session.state = { ...(ctx.scene.session.state ?? {}), draft: {} };
  }
  return (ctx.scene.session.state as { draft: NewItemDraft }).draft;
}

function textOf(ctx: MyContext): string | null {
  const message = ctx.message;
  if (message && "text" in message) return message.text.trim();
  return null;
}

export const newItemScene = new Scenes.WizardScene<MyContext>(
  NEW_ITEM_SCENE,

  async (ctx) => {
    await send(
      ctx,
      `${bold("Novo produto")}\n\nQual é o ${bold("nome")} do produto?\n\n` +
        `Envie /cancelar para sair.`
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const value = textOf(ctx);
    if (!value) return send(ctx, "Envie o nome do produto em texto.");
    if (value.length < 2 || value.length > 100) {
      return send(ctx, "O nome deve ter entre 2 e 100 caracteres.");
    }

    newItemDraft(ctx).title = value;
    await send(ctx, `Agora envie a ${bold("descrição")} do produto.`);
    return ctx.wizard.next();
  },

  async (ctx) => {
    const value = textOf(ctx);
    if (!value) return send(ctx, "Envie a descrição em texto.");
    if (value.length < 5 || value.length > 800) {
      return send(ctx, "A descrição deve ter entre 5 e 800 caracteres.");
    }

    newItemDraft(ctx).description = value;
    await send(ctx, `Qual é o ${bold("preço")}? Exemplo: 49,90`);
    return ctx.wizard.next();
  },

  async (ctx) => {
    const value = textOf(ctx);
    if (!value) return send(ctx, "Envie o preço em texto, por exemplo 49,90.");

    const cents = parsePriceToCents(value);
    if (cents === null) {
      return send(ctx, "Preço inválido. Envie no formato 49,90.");
    }

    newItemDraft(ctx).priceCents = cents;
    await send(ctx, `Qual é a ${bold("quantidade em estoque")}?`);
    return ctx.wizard.next();
  },

  async (ctx) => {
    const value = textOf(ctx);
    if (!value) return send(ctx, "Envie a quantidade em números.");

    const stock = parseQuantity(value, 9999);
    if (stock === null) {
      return send(ctx, "Quantidade inválida. Envie um número entre 1 e 9999.");
    }

    newItemDraft(ctx).stock = stock;
    await send(
      ctx,
      `Por último, envie a ${bold("foto")} do produto.\n\n` +
        `Se preferir cadastrar sem foto, envie ${bold("pular")}.`
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const draft = newItemDraft(ctx);
    const message = ctx.message;

    let photoFileId: string | null = null;

    if (message && "photo" in message && message.photo.length > 0) {
      photoFileId = message.photo[message.photo.length - 1]!.file_id;
    } else {
      const value = textOf(ctx);
      if (value?.toLowerCase() !== "pular") {
        return send(ctx, `Envie uma foto do produto ou a palavra ${bold("pular")}.`);
      }
    }

    if (!draft.title || !draft.description || !draft.priceCents || draft.stock === undefined) {
      await send(ctx, "Faltaram dados. Vamos recomeçar.");
      return ctx.scene.leave();
    }

    const item = await createItem({
      title: draft.title,
      description: draft.description,
      photoFileId,
      priceCents: draft.priceCents,
      createdBy: ctx.from!.id,
    });

    await createVariant({
      itemId: item.id,
      name: "Padrão",
      priceCents: null,
      stock: draft.stock,
    });

    await ctx.scene.leave();

    await sendPhoto(
      ctx,
      photoFileId,
      `${bold("Produto cadastrado!")}\n\n` +
        `${bold(esc(item.title))}\n${esc(item.description)}\n\n` +
        `Preço: ${formatPrice(item.price_cents)}\nEstoque: ${draft.stock} unidade(s)`,
      Markup.inlineKeyboard([
        [btn.cb("Adicionar variações", cb(CB.adminVariantAdd, item.id))],
        [btn.cb("Ver produto", cb(CB.adminItemView, item.id))],
        [btn.cb("‹ Painel", CB.admin)],
      ])
    );
  }
);

newItemScene.command("cancelar", async (ctx) => {
  await ctx.scene.leave();
  await send(ctx, "Cadastro cancelado.");
  return showAdminPanel(ctx);
});

/* ------------------------------------------------------------------ */
/* Cena: variações (criar ou repor estoque)                            */
/* ------------------------------------------------------------------ */

interface VariantSceneState {
  mode: "create" | "stock";
  itemId?: number;
  variantId?: number;
  name?: string;
  priceCents?: number | null;
}

function variantState(ctx: MyContext): VariantSceneState {
  return (ctx.scene.session.state ?? { mode: "create" }) as unknown as VariantSceneState;
}

export const variantScene = new Scenes.WizardScene<MyContext>(
  VARIANT_SCENE,

  async (ctx) => {
    const state = variantState(ctx);

    if (state.mode === "stock") {
      const variant = state.variantId ? await findVariantById(state.variantId) : undefined;
      if (!variant) {
        await send(ctx, "Variação não encontrada.");
        return ctx.scene.leave();
      }

      await send(
        ctx,
        `${bold(`Estoque de ${esc(variant.item_title)} — ${esc(variant.name)}`)}\n\n` +
          `Estoque atual: ${variant.stock} (${variant.reserved} reservado)\n\n` +
          `Envie a ${bold("nova quantidade total")} em estoque.\n\n` +
          `Envie /cancelar para sair.`
      );
      ctx.wizard.selectStep(3);
      return;
    }

    await send(
      ctx,
      `${bold("Nova variação")}\n\n` +
        `Qual é o ${bold("nome")} da variação? Exemplo: Tamanho M, Azul, 500ml\n\n` +
        `Envie /cancelar para sair.`
    );
    return ctx.wizard.next();
  },

  // Nome da variação
  async (ctx) => {
    const value = textOf(ctx);
    if (!value) return send(ctx, "Envie o nome da variação em texto.");
    if (value.length < 1 || value.length > 60) {
      return send(ctx, "O nome deve ter entre 1 e 60 caracteres.");
    }

    ctx.scene.session.state = { ...variantState(ctx), name: value };
    await send(
      ctx,
      `Qual é o ${bold("preço")} desta variação?\n\n` +
        `Envie ${bold("padrao")} para usar o preço base do produto.`
    );
    return ctx.wizard.next();
  },

  // Preço da variação
  async (ctx) => {
    const value = textOf(ctx);
    if (!value) return send(ctx, "Envie o preço ou a palavra padrao.");

    let priceCents: number | null = null;
    if (value.toLowerCase() !== "padrao" && value.toLowerCase() !== "padrão") {
      priceCents = parsePriceToCents(value);
      if (priceCents === null) {
        return send(ctx, "Preço inválido. Envie no formato 49,90 ou a palavra padrao.");
      }
    }

    ctx.scene.session.state = { ...variantState(ctx), priceCents };
    await send(ctx, `Qual é a ${bold("quantidade em estoque")} desta variação?`);
    return ctx.wizard.next();
  },

  // Estoque (usado tanto na criação quanto na reposição)
  async (ctx) => {
    const value = textOf(ctx);
    if (!value) return send(ctx, "Envie a quantidade em números.");

    const stock = parseQuantity(value, 9999);
    if (stock === null && value !== "0") {
      return send(ctx, "Quantidade inválida. Envie um número entre 0 e 9999.");
    }

    const quantity = stock ?? 0;
    const state = variantState(ctx);

    if (state.mode === "stock" && state.variantId) {
      const variant = await findVariantById(state.variantId);
      if (!variant) {
        await send(ctx, "Variação não encontrada.");
        return ctx.scene.leave();
      }

      if (quantity < variant.reserved) {
        return send(
          ctx,
          `Existem ${variant.reserved} unidade(s) reservadas em pedidos pendentes. ` +
            `O estoque não pode ser menor que isso.`
        );
      }

      await updateVariant(variant.id, { stock: quantity, active: quantity > 0 || variant.active });
      await ctx.scene.leave();
      await send(ctx, `${bold("Estoque atualizado!")}\n\nNovo total: ${quantity} unidade(s).`);
      return showItemDetail(ctx, variant.item_id);
    }

    if (!state.itemId || !state.name) {
      await send(ctx, "Faltaram dados. Vamos recomeçar.");
      return ctx.scene.leave();
    }

    await createVariant({
      itemId: state.itemId,
      name: state.name,
      priceCents: state.priceCents ?? null,
      stock: quantity,
    });

    await ctx.scene.leave();
    await send(ctx, `${bold("Variação criada!")}`);
    return showItemDetail(ctx, state.itemId);
  }
);

variantScene.command("cancelar", async (ctx) => {
  await ctx.scene.leave();
  await send(ctx, "Operação cancelada.");
  return showAdminPanel(ctx);
});

/* ------------------------------------------------------------------ */
/* Cena: edição de produto                                             */
/* ------------------------------------------------------------------ */

export const itemEditScene = new Scenes.WizardScene<MyContext>(
  ITEM_EDIT_SCENE,

  async (ctx) => {
    const state = ctx.scene.session.state as { itemId?: number } | undefined;
    const item = state?.itemId ? await findItemWithStock(state.itemId) : undefined;

    if (!item) {
      await send(ctx, "Produto não encontrado.");
      return ctx.scene.leave();
    }

    await send(
      ctx,
      `${bold("Editar produto")}\n\n` +
        `Atual: ${bold(esc(item.title))}\n\n` +
        `Envie o ${bold("novo nome")}, ou ${bold("manter")} para não alterar.\n\n` +
        `Envie /cancelar para sair.`
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const value = textOf(ctx);
    if (!value) return send(ctx, "Envie o nome ou a palavra manter.");

    const state = ctx.scene.session.state as { itemId: number };
    if (value.toLowerCase() !== "manter") {
      if (value.length < 2 || value.length > 100) {
        return send(ctx, "O nome deve ter entre 2 e 100 caracteres.");
      }
      await updateItem(state.itemId, { title: value });
    }

    await send(ctx, `Envie a ${bold("nova descrição")}, ou ${bold("manter")}.`);
    return ctx.wizard.next();
  },

  async (ctx) => {
    const value = textOf(ctx);
    if (!value) return send(ctx, "Envie a descrição ou a palavra manter.");

    const state = ctx.scene.session.state as { itemId: number };
    if (value.toLowerCase() !== "manter") {
      if (value.length < 5 || value.length > 800) {
        return send(ctx, "A descrição deve ter entre 5 e 800 caracteres.");
      }
      await updateItem(state.itemId, { description: value });
    }

    await send(ctx, `Envie o ${bold("novo preço base")}, ou ${bold("manter")}.`);
    return ctx.wizard.next();
  },

  async (ctx) => {
    const value = textOf(ctx);
    if (!value) return send(ctx, "Envie o preço ou a palavra manter.");

    const state = ctx.scene.session.state as { itemId: number };
    if (value.toLowerCase() !== "manter") {
      const cents = parsePriceToCents(value);
      if (cents === null) return send(ctx, "Preço inválido. Envie no formato 49,90.");
      await updateItem(state.itemId, { price_cents: cents });
    }

    await send(
      ctx,
      `Envie a ${bold("nova foto")} do produto, ou ${bold("manter")} para não alterar.`
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const state = ctx.scene.session.state as { itemId: number };
    const message = ctx.message;

    if (message && "photo" in message && message.photo.length > 0) {
      await updateItem(state.itemId, {
        photo_file_id: message.photo[message.photo.length - 1]!.file_id,
      });
    } else {
      const value = textOf(ctx);
      if (value?.toLowerCase() !== "manter") {
        return send(ctx, `Envie uma foto ou a palavra ${bold("manter")}.`);
      }
    }

    await ctx.scene.leave();
    await send(ctx, `${bold("Produto atualizado!")}`);
    return showItemDetail(ctx, state.itemId);
  }
);

itemEditScene.command("cancelar", async (ctx) => {
  await ctx.scene.leave();
  await send(ctx, "Edição cancelada.");
  return showAdminPanel(ctx);
});
