import type { Context, Scenes } from "telegraf";

export type OrderStatus = "pending" | "paid" | "cancelled" | "expired" | "refunded";
export type PaymentMethod = "pix" | "credit_card" | "debit_card" | "boleto";
export type CouponKind = "percent" | "fixed" | "free_shipping";

export interface User {
  id: number;
  name: string;
  cpf: string;
  phone: string | null;
  zip_code: string;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  blocked_bot: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface Item {
  id: number;
  title: string;
  description: string;
  photo_file_id: string | null;
  price_cents: number;
  active: boolean;
  created_by: number;
  created_at: Date;
  updated_at: Date;
}

export interface ItemVariant {
  id: number;
  item_id: number;
  name: string;
  sku: string | null;
  price_cents: number | null;
  stock: number;
  reserved: number;
  active: boolean;
}

/** Variação já combinada com os dados do item pai e o preço efetivo. */
export interface VariantWithItem extends ItemVariant {
  item_title: string;
  item_description: string;
  photo_file_id: string | null;
  item_active: boolean;
  effective_price_cents: number;
  available: number;
}

export interface ItemWithStock extends Item {
  total_stock: number;
  total_available: number;
  variant_count: number;
  min_price_cents: number;
  max_price_cents: number;
}

export interface CartLine {
  cart_item_id: number;
  variant_id: number;
  item_id: number;
  item_title: string;
  variant_name: string;
  photo_file_id: string | null;
  unit_price_cents: number;
  quantity: number;
  available: number;
  line_total_cents: number;
}

export interface Coupon {
  id: number;
  code: string;
  kind: CouponKind;
  value: number;
  min_order_cents: number;
  max_uses: number | null;
  used_count: number;
  starts_at: Date | null;
  expires_at: Date | null;
  active: boolean;
}

export interface ShippingRate {
  id: number;
  state: string;
  price_cents: number;
  days_min: number;
  days_max: number;
  active: boolean;
}

export interface ShippingQuote {
  price_cents: number;
  days_min: number;
  days_max: number;
  free: boolean;
  reason?: string;
}

export interface CartTotals {
  lines: CartLine[];
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  total_cents: number;
  coupon: Coupon | null;
  shipping: ShippingQuote | null;
}

export interface Order {
  id: number;
  user_id: number;
  status: OrderStatus;
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  total_cents: number;
  coupon_id: number | null;
  coupon_code: string | null;
  payment_method: PaymentMethod;
  mp_payment_id: string | null;
  checkout_url: string | null;
  shipping_snapshot: ShippingSnapshot | null;
  tracking_code: string | null;
  shipped: boolean;
  shipped_at: Date | null;
  paid_at: Date | null;
  expires_at: Date | null;
  cancelled_at: Date | null;
  stock_committed: boolean;
  stock_released: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface OrderItem {
  id: number;
  order_id: number;
  variant_id: number | null;
  item_id: number | null;
  item_title: string;
  variant_name: string;
  unit_price_cents: number;
  quantity: number;
  total_cents: number;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

export interface ShippingSnapshot {
  name: string;
  cpf: string;
  phone: string | null;
  zip_code: string;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  days_min?: number;
  days_max?: number;
}

export interface Broadcast {
  id: number;
  message: string;
  photo_file_id: string | null;
  created_by: number;
  status: "queued" | "sending" | "done" | "failed";
  total_targets: number;
  sent_count: number;
  failed_count: number;
  created_at: Date;
  finished_at: Date | null;
}

/* ---------------------------------------------------------------- */
/* Contexto do Telegraf                                              */
/* ---------------------------------------------------------------- */

export interface WizardStateBag {
  [key: string]: unknown;
}

export interface MySceneSession extends Scenes.WizardSessionData {
  state?: WizardStateBag;
}

export interface MySession extends Scenes.WizardSession<MySceneSession> {
  catalogPage?: number;
  ordersPage?: number;
  adminItemsPage?: number;
  lastMenuMessageId?: number;
}

export interface MyContext extends Context {
  session: MySession;
  scene: Scenes.SceneContextScene<MyContext, MySceneSession>;
  wizard: Scenes.WizardContextWizard<MyContext>;
  /** Usuário cadastrado, carregado pelo middleware `userLoader`. */
  dbUser?: User;
  /** Verdadeiro quando o remetente está na lista de administradores. */
  isAdmin: boolean;
  /** Identificador de correlação usado nos logs. */
  requestId: string;
}
