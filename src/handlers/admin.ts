import { Composer, Markup, Scenes } from "telegraf";
import { config } from "../config";
import { MyContext } from "../types";
import {
  createItem,
  findItemById,
  formatPrice,
  listAllItems,
  markItemAsSoldOut,
  relaunchItem,
} from "../services/items";
import { listAllUserIds } from "../services/users";

export function isAdmin(ctx: MyContext): boolean {
  return ctx.from?.id === config.admin.chatId;
}

export function adminOnlyMiddleware(
  ctx: MyContext,
  next: () => Promise<void>
): void | Promise<void> {
  if (!isAdmin(ctx)) {
    ctx.reply("Você não tem permissão para executar este comando.");
    return;
  }
  return next();
}

// Wizard para publicar novo item
export const newItemWizard = new Scenes.WizardScene<MyContext>(
  "new-item-wizard",
  async (ctx) => {
    if (!isAdmin(ctx)) return ctx.scene.leave();
    await ctx.reply(
      "Vamos publicar um novo item. Envie a foto do produto ou digite /pular para sem foto."
    );
    (ctx.wizard.state as any).item = {};
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !("photo" in ctx.message || "text" in ctx.message)) {
      await ctx.reply("Por favor, envie uma foto ou digite /pular.");
      return;
    }
    const state = (ctx.wizard.state as any).item;
    if (ctx.message && "photo" in ctx.message) {
      const photos = ctx.message.photo;
      state.photoUrl = photos[photos.length - 1].file_id;
    } else if (ctx.message && "text" in ctx.message && ctx.message.text === "/pular") {
      state.photoUrl = null;
    } else {
      await ctx.reply("Por favor, envie uma foto ou digite /pular.");
      return;
    }
    await ctx.reply("Qual o nome/título do item?");
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !("text" in ctx.message)) {
      await ctx.reply("Por favor, envie o nome do item.");
      return;
    }
    ((ctx.wizard.state as any).item).title = ctx.message.text.trim();
    await ctx.reply("Qual a descrição do item?");
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !("text" in ctx.message)) {
      await ctx.reply("Por favor, envie a descrição.");
      return;
    }
    ((ctx.wizard.state as any).item).description = ctx.message.text.trim();
    await ctx.reply("Qual o preço do item? (ex: 19,90)");
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !("text" in ctx.message)) {
      await ctx.reply("Por favor, envie o preço.");
      return;
    }
    const text = ctx.message.text.replace(",", ".").replace(/[^0-9.]/g, "");
    const price = parseFloat(text);
    if (Number.isNaN(price) || price <= 0) {
      await ctx.reply("Preço inválido. Envie novamente (ex: 19,90).");
      return;
    }
    ((ctx.wizard.state as any).item).priceCents = Math.round(price * 100);
    await ctx.reply("Qual a quantidade em estoque?");
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !("text" in ctx.message)) {
      await ctx.reply("Por favor, envie a quantidade em estoque.");
      return;
    }
    const stock = parseInt(ctx.message.text.trim(), 10);
    if (Number.isNaN(stock) || stock < 0) {
      await ctx.reply("Quantidade inválida. Envie novamente.");
      return;
    }
    const state = (ctx.wizard.state as any).item;
    state.stock = stock;

    try {
      const item = await createItem(
        state.title,
        state.description,
        state.photoUrl,
        state.priceCents,
        state.stock,
        ctx.from!.id
      );

      await ctx.reply(
        `Item publicado com sucesso!\n\nID: ${item.id}\nTítulo: ${item.title}\nPreço: ${formatPrice(
          item.price_cents
        )}\nEstoque: ${item.stock}`
      );

      await publishItemToCatalog(ctx, item);
    } catch (err) {
      console.error(err);
      await ctx.reply("Erro ao publicar item. Tente novamente.");
    }
    return ctx.scene.leave();
  }
);

async function publishItemToCatalog(ctx: MyContext, item: any) {
  const caption = `*${item.title}*\n\n${item.description}\n\nPreço: ${formatPrice(
    item.price_cents
  )}\nEstoque: ${item.stock}`;
  const keyboard = Markup.inlineKeyboard([
    Markup.button.callback("🛒 Comprar", `buy:${item.id}`),
  ]);

  if (item.photo_url) {
    await ctx.replyWithPhoto(item.photo_url, {
      caption,
      parse_mode: "Markdown",
      ...keyboard,
    });
  } else {
    await ctx.reply(caption, { parse_mode: "Markdown", ...keyboard });
  }
}

// Comando /admin com painel
export const adminCommands = new Composer<MyContext>();
adminCommands.use(adminOnlyMiddleware);

adminCommands.command("admin", async (ctx) => {
  await ctx.reply(
    "Painel do Administrador",
    Markup.inlineKeyboard([
      [Markup.button.callback("➕ Novo Item", "admin:newitem")],
      [Markup.button.callback("📦 Gerenciar Itens", "admin:manage")],
    ])
  );
});

adminCommands.action("admin:newitem", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.scene.enter("new-item-wizard");
});

adminCommands.action("admin:manage", async (ctx) => {
  await ctx.answerCbQuery();
  await sendAdminItemList(ctx);
});

async function sendAdminItemList(ctx: MyContext) {
  const items = await listAllItems();
  if (items.length === 0) {
    await ctx.reply("Nenhum item cadastrado ainda.");
    return;
  }

  const buttons = items.map((item) => {
    const status = item.sold_out ? "ESGOTADO" : item.active ? "ATIVO" : "INATIVO";
    return [
      Markup.button.callback(
        `${status} - ${item.title} (${formatPrice(item.price_cents)})`,
        `admin:item:${item.id}`
      ),
    ];
  });

  await ctx.reply("Itens cadastrados:", Markup.inlineKeyboard(buttons));
}

adminCommands.action(/admin:item:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const itemId = parseInt(ctx.match![1], 10);
  const item = await findItemById(itemId);
  if (!item) {
    await ctx.reply("Item não encontrado.");
    return;
  }

  const status = item.sold_out ? "Esgotado" : item.active ? "Ativo" : "Inativo";
  const text = `*${item.title}*\nStatus: ${status}\nEstoque: ${item.stock}\nPreço: ${formatPrice(
    item.price_cents
  )}`;

  const buttons: any[] = [];
  if (!item.sold_out) {
    buttons.push(Markup.button.callback("⚠️ Marcar como Esgotado", `admin:soldout:${item.id}`));
  } else {
    buttons.push(Markup.button.callback("🔄 Relançar Item", `admin:relaunch:${item.id}`));
  }

  if (item.photo_url) {
    await ctx.replyWithPhoto(item.photo_url, {
      caption: text,
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([buttons]),
    });
  } else {
    await ctx.reply(text, {
      parse_mode: "Markdown",
      ...Markup.inlineKeyboard([buttons]),
    });
  }
});

adminCommands.action(/admin:soldout:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const itemId = parseInt(ctx.match![1], 10);
  const item = await findItemById(itemId);
  if (!item || item.sold_out) {
    await ctx.reply("Item já está esgotado ou não encontrado.");
    return;
  }

  await markItemAsSoldOut(itemId);
  await ctx.reply(`Item "${item.title}" marcado como esgotado.`);
  await notifyAllUsers(ctx, `⚠️ O item *${item.title}* acabou de esgotar!`);
  await sendAdminItemList(ctx);
});

adminCommands.action(/admin:relaunch:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const itemId = parseInt(ctx.match![1], 10);
  const item = await findItemById(itemId);
  if (!item) {
    await ctx.reply("Item não encontrado.");
    return;
  }

  ctx.session.relaunchItemId = itemId;
  await ctx.reply("Qual a nova quantidade em estoque?");
});

adminCommands.hears(/^\d+$/, async (ctx) => {
  if (!isAdmin(ctx)) return;
  if (!ctx.session.relaunchItemId) return;

  const stock = parseInt(ctx.message.text, 10);
  if (Number.isNaN(stock) || stock <= 0) {
    await ctx.reply("Quantidade inválida. Envie novamente.");
    return;
  }

  await relaunchItem(ctx.session.relaunchItemId, stock);
  const item = await findItemById(ctx.session.relaunchItemId);
  ctx.session.relaunchItemId = undefined;

  await ctx.reply(`Item "${item?.title}" relançado com estoque de ${stock} unidade(s).`);
  await notifyAllUsers(ctx, `🎉 O item *${item?.title}* voltou! Estoque: ${stock}`);
  await publishItemToCatalog(ctx, item);
});

export async function notifyAllUsers(ctx: MyContext, message: string) {
  const ids = await listAllUserIds();
  for (const userId of ids) {
    try {
      await ctx.telegram.sendMessage(userId, message, { parse_mode: "Markdown" });
    } catch (err) {
      console.warn(`Não foi possível notificar o usuário ${userId}:`, err);
    }
  }
}

export async function notifyAdmin(ctx: MyContext, message: string) {
  try {
    await ctx.telegram.sendMessage(config.admin.chatId, message, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.warn("Erro ao notificar admin:", err);
  }
}

export async function notifyShippingGroup(ctx: MyContext, message: string) {
  try {
    await ctx.telegram.sendMessage(config.admin.shippingGroupChatId, message, {
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.warn("Erro ao notificar grupo de envio:", err);
  }
}
