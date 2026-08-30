import { Markup } from "telegraf";
import type { InlineKeyboardButton } from "telegraf/types";

/** Prefixos de callback_data. Mantidos curtos: o limite do Telegram é 64 bytes. */
export const CB = {
  catalog: "cat",
  catalogPage: "cat:p",
  itemView: "it",
  variantPick: "vp",
  cartAdd: "ca",
  cartOpen: "crt",
  cartInc: "ci",
  cartDec: "cd",
  cartRemove: "cr",
  cartClear: "cc",
  couponApply: "cpa",
  couponRemove: "cpr",
  checkout: "chk",
  payMethod: "pay",
  orderCancel: "ocx",
  orders: "ord",
  ordersPage: "ord:p",
  orderView: "ov",
  profile: "prof",
  profileEdit: "pe",
  menu: "menu",
  noop: "noop",
  admin: "adm",
  adminItems: "adm:it",
  adminItemsPage: "adm:it:p",
  adminItemView: "adm:iv",
  adminItemToggle: "adm:itg",
  adminItemDelete: "adm:idl",
  adminItemDeleteYes: "adm:idy",
  adminItemEdit: "adm:ied",
  adminVariantAdd: "adm:va",
  adminVariantStock: "adm:vs",
  adminVariantToggle: "adm:vt",
  adminVariantDelete: "adm:vd",
  adminNewItem: "adm:new",
  adminOrders: "adm:ord",
  adminOrdersPage: "adm:ord:p",
  adminOrderView: "adm:ov",
  adminShip: "adm:shp",
  adminCoupons: "adm:cp",
  adminCouponNew: "adm:cpn",
  adminCouponToggle: "adm:cpt",
  adminCouponDelete: "adm:cpd",
  adminShipping: "adm:sh",
  adminShippingEdit: "adm:she",
  adminBroadcast: "adm:bc",
  adminReport: "adm:rp",
  adminReportRange: "adm:rpr",
} as const;

export function cb(prefix: string, ...parts: (string | number)[]): string {
  return [prefix, ...parts].join(":");
}

/** Extrai os argumentos de um callback_data, descartando o prefixo. */
export function cbArgs(data: string, prefix: string): string[] {
  return data.slice(prefix.length + 1).split(":");
}

type Button = InlineKeyboardButton;

export function rows(...values: Button[][]): Button[][] {
  return values.filter((row) => row.length > 0);
}

export const btn = {
  cb: (label: string, data: string): Button => Markup.button.callback(label, data),
  url: (label: string, url: string): Button => Markup.button.url(label, url),
};

/** Barra de paginação padronizada. Some quando há apenas uma página. */
export function paginationRow(prefix: string, page: number, totalPages: number): Button[] {
  if (totalPages <= 1) return [];

  const buttons: Button[] = [];
  if (page > 1) buttons.push(btn.cb("‹ Anterior", cb(prefix, page - 1)));
  buttons.push(btn.cb(`${page}/${totalPages}`, CB.noop));
  if (page < totalPages) buttons.push(btn.cb("Próxima ›", cb(prefix, page + 1)));
  return buttons;
}

export function mainMenuKeyboard(cartCount: number, isAdmin: boolean) {
  const cartLabel = cartCount > 0 ? `Carrinho (${cartCount})` : "Carrinho";
  const keyboard = rows(
    [btn.cb("Ver catálogo", CB.catalog)],
    [btn.cb(cartLabel, CB.cartOpen), btn.cb("Meus pedidos", cb(CB.ordersPage, 1))],
    [btn.cb("Meus dados", CB.profile)],
    isAdmin ? [btn.cb("Painel do administrador", CB.admin)] : []
  );
  return Markup.inlineKeyboard(keyboard);
}

export function backToMenuKeyboard() {
  return Markup.inlineKeyboard([[btn.cb("‹ Menu principal", CB.menu)]]);
}

export function confirmKeyboard(confirmData: string, confirmLabel = "Confirmar") {
  return Markup.inlineKeyboard([
    [btn.cb(confirmLabel, confirmData)],
    [btn.cb("Cancelar", CB.menu)],
  ]);
}
