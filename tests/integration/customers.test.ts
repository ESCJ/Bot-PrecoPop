import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeDatabase,
  db,
  ensureSchema,
  resetData,
  seedProduct,
  seedUser,
  setShippingRate,
  variantStock,
} from "./helpers";
import { config } from "../../src/config/env";
import { ConflictError, NotFoundError } from "../../src/domain/errors";
import { addVariantToCart } from "../../src/services/cart.service";
import { confirmOrderPayment, createOrderFromCart } from "../../src/services/checkout.service";
import {
  getCustomer,
  getCustomersPage,
  getPaymentHistory,
  removeCustomer,
  setCustomerBanned,
} from "../../src/services/customers.service";
import { getSalesReport } from "../../src/repositories/orders.repo";
import { findUserById, listReachableUserIds } from "../../src/repositories/users.repo";

/** Compra completa: carrinho -> pedido -> pagamento confirmado. */
async function buyAndPay(
  user: { id: number },
  variantId: number,
  quantity: number,
  paymentId: string
) {
  await addVariantToCart(user.id, variantId, quantity);
  const order = await createOrderFromCart(await getFullUser(user.id), "pix");
  await confirmOrderPayment(order.id, paymentId);
  return order;
}

async function getFullUser(id: number) {
  const user = await findUserById(id);
  if (!user) throw new Error(`Usuário ${id} não encontrado no teste`);
  return user;
}

describe("Painel administrativo de clientes", () => {
  beforeAll(async () => {
    await ensureSchema();
    await setShippingRate("SP", 1990);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    await resetData();
  });

  describe("Listagem", () => {
    it("agrega pedidos e valor pago por cliente", async () => {
      const buyer = await seedUser({ state: "SP" });
      const browser = await seedUser({ state: "SP" });
      const { variant } = await seedProduct({ priceCents: 10_000, stock: 10 });

      await buyAndPay(buyer, variant.id, 2, "mp-cust-1");

      const page = await getCustomersPage("all", 1, 10);
      expect(page.total).toBe(2);

      const buyerRow = page.rows.find((row) => row.id === buyer.id)!;
      expect(buyerRow.paid_orders_count).toBe(1);
      // 2 x 100,00 + 19,90 de frete.
      expect(buyerRow.total_spent_cents).toBe(21_990);
      expect(buyerRow.last_order_at).toBeInstanceOf(Date);

      const browserRow = page.rows.find((row) => row.id === browser.id)!;
      expect(browserRow.orders_count).toBe(0);
      expect(browserRow.total_spent_cents).toBe(0);
      expect(browserRow.last_order_at).toBeNull();
    });

    it("não soma pedidos pendentes no total pago", async () => {
      const user = await seedUser({ state: "SP" });
      const { variant } = await seedProduct({ priceCents: 5_000, stock: 5 });

      await addVariantToCart(user.id, variant.id, 1);
      await createOrderFromCart(await getFullUser(user.id), "pix");

      const customer = await getCustomer(user.id);
      expect(customer.orders_count).toBe(1);
      expect(customer.paid_orders_count).toBe(0);
      expect(customer.total_spent_cents).toBe(0);
    });

    it("filtra por compradores e por suspensos", async () => {
      const buyer = await seedUser({ state: "SP" });
      const banned = await seedUser({ state: "SP" });
      const { variant } = await seedProduct({ priceCents: 4_000, stock: 5 });

      await buyAndPay(buyer, variant.id, 1, "mp-cust-2");
      await setCustomerBanned(banned.id, true);

      const buyers = await getCustomersPage("buyers", 1, 10);
      expect(buyers.rows.map((row) => row.id)).toEqual([buyer.id]);

      const suspended = await getCustomersPage("banned", 1, 10);
      expect(suspended.rows.map((row) => row.id)).toEqual([banned.id]);
    });

    it("pagina sem estourar os limites", async () => {
      for (let i = 0; i < 7; i += 1) await seedUser({ state: "SP" });

      const first = await getCustomersPage("all", 1, 5);
      expect(first.rows).toHaveLength(5);
      expect(first.totalPages).toBe(2);

      const last = await getCustomersPage("all", 99, 5);
      expect(last.page).toBe(2);
      expect(last.rows).toHaveLength(2);
    });
  });

  describe("Histórico de pagamentos", () => {
    it("lista apenas pedidos pagos, com itens e valores", async () => {
      const user = await seedUser({ state: "SP" });
      const { variant } = await seedProduct({ priceCents: 3_000, stock: 10, title: "Camiseta" });

      await buyAndPay(user, variant.id, 2, "mp-hist-1");

      // Pedido pendente: não pode aparecer no histórico de pagamentos.
      await addVariantToCart(user.id, variant.id, 1);
      await createOrderFromCart(await getFullUser(user.id), "pix");

      const history = await getPaymentHistory(user.id, 1, 5);
      expect(history.total).toBe(1);
      expect(history.rows[0]!.status).toBe("paid");
      expect(history.rows[0]!.items[0]!.item_title).toBe("Camiseta");
      expect(history.rows[0]!.items[0]!.quantity).toBe(2);
      expect(history.rows[0]!.total_cents).toBe(7_990);
    });

    it("devolve página vazia quando não há pagamentos", async () => {
      const user = await seedUser({ state: "SP" });
      const history = await getPaymentHistory(user.id, 1, 5);
      expect(history.total).toBe(0);
      expect(history.rows).toEqual([]);
      expect(history.totalPages).toBe(1);
    });
  });

  describe("Bloqueio", () => {
    it("suspende e reativa o cliente", async () => {
      const user = await seedUser({ state: "SP" });

      const banned = await setCustomerBanned(user.id, true);
      expect(banned.banned_at).toBeInstanceOf(Date);

      const restored = await setCustomerBanned(user.id, false);
      expect(restored.banned_at).toBeNull();
    });

    it("tira o cliente suspenso da lista de comunicados", async () => {
      const active = await seedUser({ state: "SP" });
      const banned = await seedUser({ state: "SP" });

      await setCustomerBanned(banned.id, true);

      const reachable = await listReachableUserIds();
      expect(reachable).toContain(active.id);
      expect(reachable).not.toContain(banned.id);
    });

    it("não confunde suspensão com bloqueio do bot", async () => {
      const user = await seedUser({ state: "SP" });
      await db.execute("UPDATE users SET blocked_bot = TRUE WHERE id = $1", [user.id]);

      const customer = await getCustomer(user.id);
      expect(customer.blocked_bot).toBe(true);
      expect(customer.banned_at).toBeNull();
    });

    it("recusa suspender um administrador", async () => {
      const adminId = config.admin.chatIds[0]!;
      await expect(setCustomerBanned(adminId, true)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe("Remoção", () => {
    it("cancela pedidos pendentes e devolve o estoque reservado", async () => {
      const user = await seedUser({ state: "SP" });
      const { variant } = await seedProduct({ priceCents: 5_000, stock: 4 });

      await addVariantToCart(user.id, variant.id, 3);
      await createOrderFromCart(await getFullUser(user.id), "pix");
      expect(await variantStock(variant.id)).toEqual({ stock: 4, reserved: 3 });

      const result = await removeCustomer(user.id);

      expect(result.releasedOrders).toBe(1);
      expect(await variantStock(variant.id)).toEqual({ stock: 4, reserved: 0 });
      expect(await findUserById(user.id)).toBeUndefined();
    });

    it("preserva o faturamento dos pedidos já pagos", async () => {
      const user = await seedUser({ state: "SP" });
      const { variant } = await seedProduct({ priceCents: 10_000, stock: 5 });

      await buyAndPay(user, variant.id, 1, "mp-del-1");
      const before = await getSalesReport();

      const result = await removeCustomer(user.id);
      expect(result.keptPaidOrders).toBe(1);

      const after = await getSalesReport();
      expect(after.paidOrders).toBe(before.paidOrders);
      expect(after.revenueCents).toBe(before.revenueCents);
    });

    it("apaga carrinho e sessão do cliente removido", async () => {
      const user = await seedUser({ state: "SP" });
      const { variant } = await seedProduct({ priceCents: 2_500, stock: 5 });

      await addVariantToCart(user.id, variant.id, 1);
      await db.execute("INSERT INTO sessions (key, data) VALUES ($1, '{}'::jsonb)", [
        `${user.id}:${user.id}`,
      ]);

      await removeCustomer(user.id);

      const carts = await db.query("SELECT id FROM carts WHERE user_id = $1", [user.id]);
      const sessions = await db.query("SELECT key FROM sessions WHERE key = $1", [
        `${user.id}:${user.id}`,
      ]);
      expect(carts).toHaveLength(0);
      expect(sessions).toHaveLength(0);
    });

    it("recusa remover um administrador", async () => {
      const adminId = config.admin.chatIds[0]!;
      await expect(removeCustomer(adminId)).rejects.toBeInstanceOf(ConflictError);
    });

    it("falha com NotFoundError para cliente inexistente", async () => {
      await expect(removeCustomer(123_456_789)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
