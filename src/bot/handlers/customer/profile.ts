import { Composer, Markup, Scenes } from "telegraf";
import { MyContext } from "../../../domain/types";
import { isValidCep, normalizeCep, formatCep } from "../../../domain/cep";
import { lookupCep } from "../../../infra/http/viacep";
import { findUserById, updateUser } from "../../../repositories/users.repo";
import { bold, esc } from "../../ui/format";
import { CB, btn, cb, cbArgs, rows } from "../../ui/keyboards";
import { ack, render, send } from "../../ui/reply";
import { renderProfile } from "../../ui/views";

export const PROFILE_EDIT_SCENE = "profileEdit";

type EditableField = "name" | "phone" | "cep" | "number" | "complement";

const FIELD_LABELS: Record<EditableField, string> = {
  name: "Nome completo",
  phone: "Telefone",
  cep: "CEP e endereço",
  number: "Número",
  complement: "Complemento",
};

export const profileHandlers = new Composer<MyContext>();

export async function showProfile(ctx: MyContext): Promise<void> {
  if (!ctx.dbUser) return;

  const keyboard = Markup.inlineKeyboard(
    rows(
      [btn.cb("Editar nome", cb(CB.profileEdit, "name"))],
      [btn.cb("Editar telefone", cb(CB.profileEdit, "phone"))],
      [btn.cb("Editar CEP e endereço", cb(CB.profileEdit, "cep"))],
      [
        btn.cb("Editar número", cb(CB.profileEdit, "number")),
        btn.cb("Editar complemento", cb(CB.profileEdit, "complement")),
      ],
      [btn.cb("‹ Menu principal", CB.menu)]
    )
  );

  await render(ctx, renderProfile(ctx.dbUser), keyboard);
}

profileHandlers.action(CB.profile, async (ctx) => {
  await ack(ctx);
  await showProfile(ctx);
});

profileHandlers.command("dados", async (ctx) => showProfile(ctx));

profileHandlers.action(
  new RegExp(`^${CB.profileEdit}:(name|phone|cep|number|complement)$`),
  async (ctx) => {
    await ack(ctx);
    const [field] = cbArgs(ctx.match[0], CB.profileEdit) as [EditableField];
    await ctx.scene.enter(PROFILE_EDIT_SCENE, { field });
  }
);

function currentField(ctx: MyContext): EditableField {
  const state = ctx.scene.session.state as { field?: EditableField } | undefined;
  return state?.field ?? "name";
}

export const profileEditScene = new Scenes.WizardScene<MyContext>(
  PROFILE_EDIT_SCENE,

  async (ctx) => {
    const field = currentField(ctx);
    const prompts: Record<EditableField, string> = {
      name: "Envie seu nome completo.",
      phone: "Envie seu telefone com DDD, por exemplo 11912345678.",
      cep: "Envie seu novo CEP. Vou buscar o endereço automaticamente.",
      number: "Envie o número do endereço.",
      complement: "Envie o complemento, ou a palavra nao para deixar em branco.",
    };

    await send(
      ctx,
      `${bold(FIELD_LABELS[field])}\n\n${prompts[field]}\n\nEnvie /cancelar para voltar.`
    );
    return ctx.wizard.next();
  },

  async (ctx) => {
    const message = ctx.message;
    if (!message || !("text" in message)) return send(ctx, "Envie a informação em texto.");
    if (!ctx.dbUser) return ctx.scene.leave();

    const field = currentField(ctx);
    const value = message.text.trim();

    switch (field) {
      case "name": {
        if (value.length < 5 || !value.includes(" ")) {
          return send(ctx, "Informe o nome completo (nome e sobrenome).");
        }
        await updateUser(ctx.dbUser.id, { name: value.replace(/\s+/g, " ").slice(0, 120) });
        break;
      }

      case "phone": {
        const digits = value.replace(/\D/g, "");
        if (digits.length < 10 || digits.length > 11) {
          return send(ctx, "Telefone inválido. Envie DDD + número, por exemplo 11912345678.");
        }
        await updateUser(ctx.dbUser.id, { phone: digits });
        break;
      }

      case "cep": {
        const zipCode = normalizeCep(value);
        if (!isValidCep(zipCode)) {
          return send(ctx, "CEP inválido. Envie os 8 dígitos, por exemplo 01001-000.");
        }

        const address = await lookupCep(zipCode);
        if (!address) {
          await updateUser(ctx.dbUser.id, { zip_code: zipCode });
          await send(
            ctx,
            `CEP ${esc(formatCep(zipCode))} salvo, mas não consegui buscar o endereço agora.\n\n` +
              `Qual é o nome da rua?`
          );
          ctx.scene.session.state = { field: "street-manual" as never };
          return ctx.wizard.next();
        }

        await updateUser(ctx.dbUser.id, {
          zip_code: zipCode,
          street: address.street,
          neighborhood: address.neighborhood,
          city: address.city,
          state: address.state,
        });

        await send(
          ctx,
          `Endereço atualizado:\n` +
            `${esc(address.street ?? "")}, ${esc(address.neighborhood ?? "")}\n` +
            `${esc(address.city ?? "")} - ${esc(address.state ?? "")}`
        );
        break;
      }

      case "number": {
        if (!value || value.length > 20) return send(ctx, "Número inválido.");
        await updateUser(ctx.dbUser.id, { number: value });
        break;
      }

      case "complement": {
        const normalized = value.toLowerCase();
        const complement =
          normalized === "nao" || normalized === "não" || normalized === "-" ? null : value;
        await updateUser(ctx.dbUser.id, { complement });
        break;
      }
    }

    await send(ctx, `${bold("Dados atualizados!")}`);
    await ctx.scene.leave();

    ctx.dbUser = await findUserById(ctx.from!.id);
    return showProfile(ctx);
  },

  // Preenchimento manual da rua quando o ViaCEP falha.
  async (ctx) => {
    const message = ctx.message;
    if (!message || !("text" in message)) return send(ctx, "Envie o nome da rua em texto.");
    if (!ctx.dbUser) return ctx.scene.leave();

    await updateUser(ctx.dbUser.id, { street: message.text.trim() });
    await send(ctx, `${bold("Endereço atualizado!")}`);
    await ctx.scene.leave();

    ctx.dbUser = await findUserById(ctx.from!.id);
    return showProfile(ctx);
  }
);

profileEditScene.command("cancelar", async (ctx) => {
  await ctx.scene.leave();
  return showProfile(ctx);
});
