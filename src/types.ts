import { Context, Scenes } from "telegraf";
import { SceneSession, SceneSessionData, WizardSessionData } from "telegraf/typings/scenes";

export interface User {
  id: number;
  name: string;
  cpf: string;
  address: string;
  zip_code: string;
  created_at: string;
}

export interface Item {
  id: number;
  title: string;
  description: string;
  photo_url: string | null;
  price_cents: number;
  stock: number;
  active: number;
  sold_out: number;
  created_by: number;
  created_at: string;
}

export interface Order {
  id: number;
  user_id: number;
  item_id: number;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
  payment_method: string;
  mp_payment_id: string | null;
  status: "pending" | "paid" | "cancelled";
  shipped: number;
  created_at: string;
  paid_at: string | null;
}

export type PaymentMethod = "pix" | "credit_card" | "debit_card" | "boleto";

export interface MySceneSession extends SceneSessionData, WizardSessionData {}

export interface MySession extends SceneSession<MySceneSession> {
  relaunchItemId?: number;
  editItemId?: number;
  editProfile?: boolean;
  orderItemId?: number;
  orderQuantity?: number;
}

export interface MyContext extends Context {
  session: MySession;
  scene: Scenes.SceneContextScene<MyContext, MySceneSession>;
  wizard: Scenes.WizardContextWizard<MyContext>;
}
