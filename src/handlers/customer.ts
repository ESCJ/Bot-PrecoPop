import { Composer, Markup, Scenes } from "telegraf";
import { MyContext, PaymentMethod } from "../types";
import {
  createUser,
  findUserById,
  formatCpf,
  isValidCep,
  isValidCpf,
} from "../services/users";
import {
  findItemById,
  formatPrice,
  listActiveItems,
} from "../services/items";
import { createOrder } from "../services/orders";
import {
  createCheckoutPreference,
  createPixPayment,
} from "../services/payments";
import { notifyAdmin, notifyShippingGroup } from "./admin";

export const registrationWizard = new Scenes.WizardScene<MyContext>(
  "registration-wizard",
  async (ctx) => {
    await ctx.reply("Bem-vindo ao *Grupo Vip - Loja Preço Pop!* 🛍️\n\nPara começar, informe seu *nome completo*:", {
      parse_mode: "Markdown",
    });
    (ctx.wizard.state as any).registration = {};
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !("text" in ctx.message)) {
      await ctx.reply("Por favor, envie seu nome.");
      return;
    }
    ((ctx.wizard.state as any).registration).name = ctx.message.text.trim();
    await ctx.reply("Agora informe seu *CPF* (somente números):", {
      parse_mode: "Markdown",
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !("text" in ctx.message)) {
      await ctx.reply("Por favor, envie seu CPF.");
      return;
    }
    const cpf = ctx.message.text.trim();
    if (!isValidCpf(cpf)) {
      await ctx.reply("CPF inválido. Envie novamente (somente números):");
      return;
    }
    ((ctx.wizard.state as any).registration).cpf = cpf;
    await ctx.reply("Informe seu *endereço completo* (rua, número, bairro, cidade, estado):", {
      parse_mode: "Markdown",
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !("text" in ctx.message)) {
      await ctx.reply("Por favor, envie seu endereço.");
      return;
    }
    ((ctx.wizard.state as any).registration).address = ctx.message.text.trim();
    await ctx.reply("Por último, informe seu *CEP*:", { parse_mode: "Markdown" });
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.message || !("text" in ctx.message)) {
      await ctx.reply("Por favor, envie seu CEP.");
      return;
    }
    const zipCode = ctx.message.text.trim();
    if (!isValidCep(zipCode)) {
      await ctx.reply("CEP inválido. Envie novamente (ex: 00000-000):");
      return;
    }
    const state = (ctx.wizard.state as any).registration;
    state.zipCode = zipCode;

    try {
      await createUser(ctx.from!.id, state.name, state.cpf, state.address, state.zipCode);
      await ctx.reply(
        `✅ Cadastro realizado com sucesso!\n\nNome: ${state.name}\nCPF: ${formatCpf(
          state.cpf
        )}\nEndereço: ${state.address}\nCEP: ${state.zipCode}\n\nAgora você pode comprar nossos itens.`,
        mainMenuKeyboard()
      );
    } catch (err) {
      console.error(err);
      await ctx.reply("Erro ao salvar cadastro. Tente novamente com /start.");
    }
    return ctx.scene.leave();
  }
);

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🛍️ Ver itens à venda", "catalog")],
  ]);
}

export const customerCommands = new Composer<MyContext>();

customerCommands.start(async (ctx) => {
  const user = await findUserById(ctx.from.id);
  if (user) {
    await ctx.reply(
      `Olá, ${user.name}! Bem-vindo de volta ao *Grupo Vip - Loja Preço Pop!* 🛍️`,
      { parse_mode: "Markdown", ...mainMenuKeyboard() }
    );
  } else {
    await ctx.scene.enter("registration-wizard");
  }
});

customerCommands.action("catalog", async (ctx) => {
  await ctx.answerCbQuery();
  const items = await listActiveItems();
  if (items.length === 0) {
    await ctx.reply("Nenhum item disponível no momento. Fique de olho, novidades em breve! 👀");
    return;
  }

  await ctx.reply("Confira nossos itens disponíveis:");
  for (const item of items) {
    const caption = `*${item.title}*\n\n${item.description}\n\nPreço: ${formatPrice(
      item.price_cents
    )}\nEstoque: ${item.stock}`;
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("🛒 Comprar", `buy:${item.id}`)],
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
});

// Fluxo de compra
customerCommands.action(/buy:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const itemId = parseInt(ctx.match![1], 10);
  const item = await findItemById(itemId);
  const user = await findUserById(ctx.from!.id);

  if (!user) {
    await ctx.reply("Você precisa se cadastrar primeiro. Use /start.");
    return;
  }

  if (!item || !item.active || item.sold_out || item.stock <= 0) {
    await ctx.reply("Este item não está mais disponível.");
    return;
  }

  ctx.session.orderItemId = itemId;
  await ctx.reply(
    `Você escolheu *${item.title}*.\nPreço unitário: ${formatPrice(
      item.price_cents
    )}\n\nInforme a quantidade desejada:`
  );
});

// Quantidade
customerCommands.hears(/^\d+$/, async (ctx) => {
  if (!ctx.session.orderItemId) return;
  const quantity = parseInt(ctx.message.text, 10);
  const item = await findItemById(ctx.session.orderItemId);

  if (!item || item.stock < quantity || quantity <= 0) {
    await ctx.reply(
      `Quantidade inválida. O estoque disponível é de ${item?.stock || 0} unidade(s). Envie novamente:`
    );
    return;
  }

  ctx.session.orderQuantity = quantity;
  await ctx.reply(
    `Quantidade: ${quantity}\nTotal: ${formatPrice(item.price_cents * quantity)}\n\nEscolha a forma de pagamento:`,
    Markup.inlineKeyboard([
      [Markup.button.callback("💠 Pix", "pay:pix")],
      [Markup.button.callback("💳 Cartão de Crédito", "pay:credit_card")],
      [Markup.button.callback("💳 Cartão de Débito", "pay:debit_card")],
      [Markup.button.callback("📄 Boleto", "pay:boleto")],
    ])
  );
});

customerCommands.action(/pay:(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const method = ctx.match![1] as PaymentMethod;
  const itemId = ctx.session.orderItemId;
  const quantity = ctx.session.orderQuantity;

  if (!itemId || !quantity) {
    await ctx.reply("Sessão de compra expirada. Volte ao catálogo.");
    return;
  }

  const item = await findItemById(itemId);
  const user = await findUserById(ctx.from!.id);

  if (!item || !user || item.stock < quantity) {
    await ctx.reply("Item indisponível ou estoque insuficiente.");
    return;
  }

  try {
    const order = await createOrder(
      user.id,
      item.id,
      quantity,
      item.price_cents,
      method
    );

    if (method === "pix") {
      const pix = await createPixPayment(order, item, user);
      await ctx.reply(
        `Pedido #${order.id} criado!\nTotal: ${formatPrice(order.total_cents)}\n\n` +
          `Escaneie o QR Code abaixo ou use o código Pix para pagar:`,
        { parse_mode: "Markdown" }
      );
      await ctx.replyWithPhoto(
        { source: Buffer.from(pix.qrCodeBase64, "base64") },
        { caption: `Código Pix:\n\`\`\`\n${pix.qrCode}\n\`\`\``, parse_mode: "Markdown" }
      );
      await ctx.reply(`Ou pague pelo link: ${pix.checkoutUrl}`);
    } else {
      const preference = await createCheckoutPreference(order, item, user);
      const methodLabel = {
        credit_card: "cartão de crédito",
        debit_card: "cartão de débito",
        boleto: "boleto",
      }[method];
      await ctx.reply(
        `Pedido #${order.id} criado!\nTotal: ${formatPrice(
          order.total_cents
        )}\n\nClique no link abaixo para pagar com ${methodLabel}:\n${preference.initPoint}`
      );
    }

    ctx.session.orderItemId = undefined;
    ctx.session.orderQuantity = undefined;
  } catch (err) {
    console.error(err);
    await ctx.reply("Erro ao criar o pagamento. Tente novamente.");
  }
});

export { notifyAdmin, notifyShippingGroup };
