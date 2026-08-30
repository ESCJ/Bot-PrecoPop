import { Composer, Markup, Scenes } from "telegraf";
import { MyContext, PaymentMethod } from "../types";
import {
  createUser,
  findUserById,
  formatCpf,
  isValidCep,
  isValidCpf,
  updateUser,
} from "../services/users";
import { findItemById, formatPrice, listActiveItems } from "../services/items";
import { createOrder, findOrdersByUser } from "../services/orders";
import { createCheckoutPreference, createPixPayment } from "../services/payments";
import { notifyAdmin, notifyShippingGroup } from "./admin";

export const registrationWizard = new Scenes.WizardScene<MyContext>(
  "registration-wizard",
  async (ctx) => {
    await ctx.reply(
      "👋 *Bem-vindo ao Grupo Vip - Loja Preço Pop!*\n\n" +
        "Para começar a comprar, preciso de alguns dados seus.\n\n" +
        "Qual o seu *nome completo*?",
      { parse_mode: "Markdown" }
    );
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
      await ctx.reply("❌ CPF inválido. Envie novamente (somente números):");
      return;
    }
    ((ctx.wizard.state as any).registration).cpf = cpf;
    await ctx.reply(
      "Informe seu *endereço completo* para entrega:\n" +
        "(rua, número, bairro, cidade, estado)",
      { parse_mode: "Markdown" }
    );
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
      await ctx.reply("❌ CEP inválido. Envie novamente (ex: 00000-000):");
      return;
    }
    const state = (ctx.wizard.state as any).registration;
    state.zipCode = zipCode;

    try {
      await createUser(ctx.from!.id, state.name, state.cpf, state.address, state.zipCode);
      await ctx.reply(
        `✅ *Cadastro realizado com sucesso!*\n\n` +
          `*Nome:* ${state.name}\n` +
          `*CPF:* ${formatCpf(state.cpf)}\n` +
          `*Endereço:* ${state.address}\n` +
          `*CEP:* ${state.zipCode}\n\n` +
          `Agora você pode comprar nossos itens. 🛍️`,
        mainMenuKeyboard()
      );
    } catch (err) {
      console.error(err);
      await ctx.reply("❌ Erro ao salvar cadastro. Tente novamente com /start.");
    }
    return ctx.scene.leave();
  }
);

function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🛍️ Ver itens à venda", "catalog")],
    [Markup.button.callback("📦 Meus pedidos", "myorders")],
    [Markup.button.callback("✏️ Editar meus dados", "editprofile")],
  ]);
}

export const customerCommands = new Composer<MyContext>();

customerCommands.start(async (ctx) => {
  const user = await findUserById(ctx.from.id);
  if (user) {
    await ctx.reply(
      `👋 *Olá, ${user.name}!*\n\n` +
        `Bem-vindo de volta à *Grupo Vip - Loja Preço Pop!* 🛍️\n\n` +
        `Escolha uma opção abaixo:`,
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
    await ctx.reply(
      "😕 *Nenhum item disponível no momento.*\n\nFique de olho, novidades em breve!",
      { parse_mode: "Markdown" }
    );
    return;
  }

  await ctx.reply("🛍️ *Confira nossos itens disponíveis:*", { parse_mode: "Markdown" });
  for (const item of items) {
    const caption =
      `*${item.title}*\n\n` +
      `${item.description}\n\n` +
      `💰 Preço: ${formatPrice(item.price_cents)}\n` +
      `📦 Estoque: ${item.stock}`;
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

customerCommands.action("myorders", async (ctx) => {
  await ctx.answerCbQuery();
  const orders = await findOrdersByUser(ctx.from!.id);

  if (orders.length === 0) {
    await ctx.reply("📭 *Você ainda não fez nenhum pedido.*", {
      parse_mode: "Markdown",
      ...mainMenuKeyboard(),
    });
    return;
  }

  let message = "📦 *Meus pedidos:*\n\n";
  for (const order of orders) {
    const item = await findItemById(order.item_id);
    const status = order.status === "paid" ? "✅ Pago" : order.status === "pending" ? "⏳ Pendente" : "❌ Cancelado";
    const shipped = order.shipped ? "\n🚚 Enviado" : "";
    message +=
      `*Pedido #${order.id}*\n` +
      `Item: ${item?.title || "N/A"}\n` +
      `Qtd: ${order.quantity} | Total: ${formatPrice(order.total_cents)}\n` +
      `Status: ${status}${shipped}\n\n`;
  }

  await ctx.reply(message, { parse_mode: "Markdown", ...mainMenuKeyboard() });
});

customerCommands.action("editprofile", async (ctx) => {
  await ctx.answerCbQuery();
  const user = await findUserById(ctx.from!.id);
  if (!user) {
    await ctx.reply("Você precisa se cadastrar primeiro. Use /start.");
    return;
  }

  await ctx.reply(
    `✏️ *Editar cadastro*\n\n` +
      `Seus dados atuais:\n` +
      `*Nome:* ${user.name}\n` +
      `*CPF:* ${formatCpf(user.cpf)}\n` +
      `*Endereço:* ${user.address}\n` +
      `*CEP:* ${user.zip_code}\n\n` +
      `Envie os novos dados no formato:\n` +
      `nome | endereço | cep\n\n` +
      `Exemplo:\n` +
      `João Silva | Rua das Flores, 123, Centro, São Paulo, SP | 01000-000`,
    { parse_mode: "Markdown" }
  );
  ctx.session.editProfile = true;
});

customerCommands.hears(/^([^|]+)\|([^|]+)\|([^|]+)$/, async (ctx) => {
  if (!ctx.session.editProfile) return;

  const match = ctx.message.text.match(/^([^|]+)\|([^|]+)\|([^|]+)$/);
  if (!match) return;

  const [, name, address, zipCode] = match;

  if (!isValidCep(zipCode.trim())) {
    await ctx.reply("❌ CEP inválido. Envie novamente no formato: nome | endereço | cep");
    return;
  }

  await updateUser(ctx.from!.id, {
    name: name.trim(),
    address: address.trim(),
    zip_code: zipCode.trim(),
  });

  ctx.session.editProfile = false;

  await ctx.reply(
    `✅ *Cadastro atualizado com sucesso!*\n\n` +
      `*Nome:* ${name.trim()}\n` +
      `*Endereço:* ${address.trim()}\n` +
      `*CEP:* ${zipCode.trim()}`,
    { parse_mode: "Markdown", ...mainMenuKeyboard() }
  );
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
    await ctx.reply("😕 *Este item não está mais disponível.*", { parse_mode: "Markdown" });
    return;
  }

  ctx.session.orderItemId = itemId;
  await ctx.reply(
    `🛍️ *Você escolheu:* ${item.title}\n\n` +
      `💰 Preço unitário: ${formatPrice(item.price_cents)}\n` +
      `📦 Estoque disponível: ${item.stock}\n\n` +
      `Informe a *quantidade* desejada:`,
    { parse_mode: "Markdown" }
  );
});

// Quantidade
customerCommands.hears(/^\d+$/, async (ctx) => {
  if (ctx.session.editProfile) return;
  if (!ctx.session.orderItemId) return;
  if (ctx.session.relaunchItemId) return;

  const quantity = parseInt(ctx.message.text, 10);
  const item = await findItemById(ctx.session.orderItemId);

  if (!item || item.stock < quantity || quantity <= 0) {
    await ctx.reply(
      `❌ Quantidade inválida. O estoque disponível é de ${item?.stock || 0} unidade(s). Envie novamente:`
    );
    return;
  }

  ctx.session.orderQuantity = quantity;
  await ctx.reply(
    `🛒 *Resumo da compra*\n\n` +
      `Item: ${item.title}\n` +
      `Quantidade: ${quantity}\n` +
      `Total: ${formatPrice(item.price_cents * quantity)}\n\n` +
      `Escolha a forma de pagamento:`,
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
    await ctx.reply("❌ Item indisponível ou estoque insuficiente.");
    return;
  }

  try {
    const order = await createOrder(user.id, item.id, quantity, item.price_cents, method);

    if (method === "pix") {
      const pix = await createPixPayment(order, item, user);
      await ctx.reply(
        `✅ *Pedido #${order.id} criado!*\n\n` +
          `💰 Total: ${formatPrice(order.total_cents)}\n\n` +
          `Escaneie o QR Code abaixo ou use o código Pix para pagar:`,
        { parse_mode: "Markdown" }
      );
      await ctx.replyWithPhoto(
        { source: Buffer.from(pix.qrCodeBase64, "base64") },
        {
          caption: `*Código Pix:*\n\`\`\`\n${pix.qrCode}\n\`\`\``,
          parse_mode: "Markdown",
        }
      );
      await ctx.reply(`🔗 Ou pague pelo link:\n${pix.checkoutUrl}`);
    } else {
      const preference = await createCheckoutPreference(order, item, user);
      const methodLabel = {
        credit_card: "cartão de crédito",
        debit_card: "cartão de débito",
        boleto: "boleto",
      }[method];
      await ctx.reply(
        `✅ *Pedido #${order.id} criado!*\n\n` +
          `💰 Total: ${formatPrice(order.total_cents)}\n\n` +
          `Clique no link abaixo para pagar com ${methodLabel}:\n` +
          `${preference.initPoint}`
      );
    }

    ctx.session.orderItemId = undefined;
    ctx.session.orderQuantity = undefined;
  } catch (err) {
    console.error(err);
    await ctx.reply("❌ Erro ao criar o pagamento. Tente novamente.");
  }
});

export { notifyAdmin, notifyShippingGroup };
