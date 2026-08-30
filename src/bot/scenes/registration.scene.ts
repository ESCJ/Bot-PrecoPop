import { Markup, Scenes } from "telegraf";
import { MyContext } from "../../domain/types";
import { formatCpf, isValidCpf, onlyDigits } from "../../domain/cpf";
import { formatCep, isValidCep, isValidState, normalizeCep } from "../../domain/cep";
import { lookupCep } from "../../infra/http/viacep";
import { createUser, findUserByCpf } from "../../repositories/users.repo";
import { bold, esc } from "../ui/format";
import { ack, send } from "../ui/reply";
import { showMainMenu } from "../handlers/customer/menu";

export const REGISTRATION_SCENE = "registration";

interface Draft {
  name?: string;
  cpf?: string;
  zipCode?: string;
  street?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  number?: string | null;
  complement?: string | null;
  autoFilled?: boolean;
}

function draft(ctx: MyContext): Draft {
  const state = ctx.scene.session.state as { draft?: Draft } | undefined;
  if (!state?.draft) {
    ctx.scene.session.state = { ...(ctx.scene.session.state ?? {}), draft: {} };
  }
  return (ctx.scene.session.state as { draft: Draft }).draft;
}

function text(ctx: MyContext): string | null {
  const message = ctx.message;
  if (message && "text" in message) return message.text.trim();
  return null;
}

const CANCEL_HINT = "\n\nEnvie /cancelar para sair do cadastro.";

export const registrationScene = new Scenes.WizardScene<MyContext>(
  REGISTRATION_SCENE,

  // 1. Nome completo
  async (ctx) => {
    await send(
      ctx,
      `${bold("Cadastro")}\n\nPara comprar, precisamos dos seus dados de entrega.\n\n` +
        `Qual é o seu ${bold("nome completo")}?${CANCEL_HINT}`
    );
    return ctx.wizard.next();
  },

  // 2. Recebe nome, pede CPF
  async (ctx) => {
    const value = text(ctx);
    if (!value) return send(ctx, "Envie seu nome completo em texto.");

    if (value.length < 5 || !value.includes(" ")) {
      return send(ctx, "Informe o nome completo (nome e sobrenome).");
    }
    if (value.length > 120) {
      return send(ctx, "Nome muito longo. Use no máximo 120 caracteres.");
    }

    draft(ctx).name = value.replace(/\s+/g, " ");
    await send(ctx, `Obrigado, ${esc(value.split(" ")[0]!)}!\n\nAgora informe seu ${bold("CPF")}.`);
    return ctx.wizard.next();
  },

  // 3. Recebe CPF, pede CEP
  async (ctx) => {
    const value = text(ctx);
    if (!value) return send(ctx, "Envie seu CPF em texto.");

    const cpf = onlyDigits(value);
    if (!isValidCpf(cpf)) {
      return send(ctx, "CPF inválido. Confira os números e envie novamente.");
    }

    const existing = await findUserByCpf(cpf);
    if (existing && existing.id !== ctx.from?.id) {
      return send(
        ctx,
        "Este CPF já está cadastrado em outra conta do Telegram. " +
          "Se você acredita que isso é um engano, fale com o suporte."
      );
    }

    draft(ctx).cpf = cpf;
    await send(
      ctx,
      `CPF ${esc(formatCpf(cpf))} registrado.\n\n` +
        `Agora envie seu ${bold("CEP")} — vou preencher o endereço automaticamente.`
    );
    return ctx.wizard.next();
  },

  // 4. Recebe CEP, consulta ViaCEP e confirma
  async (ctx) => {
    const value = text(ctx);
    if (!value) return send(ctx, "Envie seu CEP em texto.");

    const zipCode = normalizeCep(value);
    if (!isValidCep(zipCode)) {
      return send(ctx, "CEP inválido. Envie os 8 dígitos, por exemplo 01001-000.");
    }

    const current = draft(ctx);
    current.zipCode = zipCode;

    const address = await lookupCep(zipCode);

    if (address) {
      current.street = address.street;
      current.neighborhood = address.neighborhood;
      current.city = address.city;
      current.state = address.state;
      current.autoFilled = true;

      const preview =
        `${bold("Encontramos este endereço")}\n\n` +
        `CEP: ${esc(formatCep(zipCode))}\n` +
        `Rua: ${esc(address.street || "não informada")}\n` +
        `Bairro: ${esc(address.neighborhood || "não informado")}\n` +
        `Cidade: ${esc(address.city)} - ${esc(address.state)}\n\n` +
        `Está correto?`;

      await send(
        ctx,
        preview,
        Markup.inlineKeyboard([
          [Markup.button.callback("Sim, está correto", "reg:ok")],
          [Markup.button.callback("Não, digitar manualmente", "reg:manual")],
        ])
      );
      return ctx.wizard.next();
    }

    current.autoFilled = false;
    await send(
      ctx,
      "Não consegui consultar esse CEP agora. Vamos preencher manualmente.\n\n" +
        `Qual é o ${bold("nome da rua")}?`
    );
    ctx.wizard.selectStep(5);
    return;
  },

  // 5. Confirmação do endereço automático
  async (ctx) => {
    const data = ctx.callbackQuery && "data" in ctx.callbackQuery ? ctx.callbackQuery.data : null;

    if (data === "reg:ok") {
      await ack(ctx);
      await send(ctx, `Perfeito. Qual é o ${bold("número")} do endereço?`);
      ctx.wizard.selectStep(6);
      return;
    }

    if (data === "reg:manual") {
      await ack(ctx);
      const current = draft(ctx);
      current.autoFilled = false;
      await send(ctx, `Sem problema. Qual é o ${bold("nome da rua")}?`);
      ctx.wizard.selectStep(5);
      return;
    }

    return send(ctx, "Use os botões acima para confirmar o endereço.");
  },

  // 6. Rua (manual) -> bairro -> cidade -> UF
  async (ctx) => {
    const value = text(ctx);
    if (!value) return send(ctx, "Envie o nome da rua em texto.");
    if (value.length < 3) return send(ctx, "Nome de rua muito curto.");

    draft(ctx).street = value;
    await send(ctx, `Qual é o ${bold("bairro")}?`);
    ctx.wizard.selectStep(7);
    return;
  },

  // 7. Número
  async (ctx) => {
    const value = text(ctx);
    if (!value) return send(ctx, "Envie o número em texto.");
    if (value.length > 20) return send(ctx, "Número muito longo.");

    draft(ctx).number = value;
    await send(
      ctx,
      `Algum ${bold("complemento")}? (apartamento, bloco, referência)\n\n` +
        `Se não houver, envie ${bold("nao")}.`
    );
    ctx.wizard.selectStep(10);
    return;
  },

  // 8. Bairro (fluxo manual)
  async (ctx) => {
    const value = text(ctx);
    if (!value) return send(ctx, "Envie o bairro em texto.");

    draft(ctx).neighborhood = value;
    await send(ctx, `Qual é a ${bold("cidade")}?`);
    ctx.wizard.selectStep(8);
    return;
  },

  // 9. Cidade (fluxo manual)
  async (ctx) => {
    const value = text(ctx);
    if (!value) return send(ctx, "Envie a cidade em texto.");

    draft(ctx).city = value;
    await send(ctx, `Qual é o ${bold("estado")}? Envie a sigla, por exemplo SP.`);
    ctx.wizard.selectStep(9);
    return;
  },

  // 10. Estado (fluxo manual) -> número
  async (ctx) => {
    const value = text(ctx);
    if (!value) return send(ctx, "Envie a sigla do estado, por exemplo SP.");

    const uf = value.toUpperCase();
    if (!isValidState(uf)) {
      return send(ctx, "Sigla inválida. Envie duas letras, por exemplo SP, RJ ou MG.");
    }

    draft(ctx).state = uf;
    await send(ctx, `Qual é o ${bold("número")} do endereço?`);
    ctx.wizard.selectStep(6);
    return;
  },

  // 11. Complemento e gravação final
  async (ctx) => {
    const value = text(ctx);
    if (!value) return send(ctx, "Envie o complemento ou a palavra nao.");

    const current = draft(ctx);
    const normalized = value.toLowerCase();
    current.complement =
      normalized === "nao" || normalized === "não" || normalized === "-" ? null : value;

    if (!current.name || !current.cpf || !current.zipCode || !current.state) {
      await send(ctx, "Faltaram dados no cadastro. Vamos recomeçar com /start.");
      return ctx.scene.leave();
    }

    await createUser({
      id: ctx.from!.id,
      name: current.name,
      cpf: current.cpf,
      zipCode: current.zipCode,
      street: current.street ?? null,
      number: current.number ?? null,
      complement: current.complement ?? null,
      neighborhood: current.neighborhood ?? null,
      city: current.city ?? null,
      state: current.state,
    });

    await send(ctx, `${bold("Cadastro concluído!")}\n\nAgora é só escolher seus produtos.`);
    await ctx.scene.leave();
    ctx.dbUser = undefined;
    return showMainMenu(ctx, true);
  }
);

registrationScene.command("cancelar", async (ctx) => {
  await send(ctx, "Cadastro cancelado. Envie /start quando quiser recomeçar.");
  return ctx.scene.leave();
});
