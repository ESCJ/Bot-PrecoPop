import { config } from "../config/env";
import { ConflictError, NotFoundError } from "../domain/errors";
import { CustomerSummary, OrderWithItems } from "../domain/types";
import { logger } from "../infra/logger";
import {
  countPaidOrdersByUser,
  findPendingOrderIdsByUser,
  listPaidOrdersByUser,
} from "../repositories/orders.repo";
import {
  CustomerFilter,
  countCustomers,
  deleteUser,
  findCustomerSummary,
  listCustomers,
  setUserBanned,
} from "../repositories/users.repo";
import { cancelPendingOrder } from "./checkout.service";

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  totalPages: number;
}

function paginate(total: number, page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  return { totalPages, safePage, offset: (safePage - 1) * pageSize };
}

export async function getCustomersPage(
  filter: CustomerFilter,
  page: number,
  pageSize: number
): Promise<Page<CustomerSummary>> {
  const total = await countCustomers(filter);
  const { totalPages, safePage, offset } = paginate(total, page, pageSize);
  const rows = total === 0 ? [] : await listCustomers(filter, pageSize, offset);
  return { rows, total, page: safePage, totalPages };
}

export async function getCustomer(id: number): Promise<CustomerSummary> {
  const customer = await findCustomerSummary(id);
  if (!customer) throw new NotFoundError("Cliente não encontrado.");
  return customer;
}

export async function getPaymentHistory(
  id: number,
  page: number,
  pageSize: number
): Promise<Page<OrderWithItems>> {
  const total = await countPaidOrdersByUser(id);
  const { totalPages, safePage, offset } = paginate(total, page, pageSize);
  const rows = total === 0 ? [] : await listPaidOrdersByUser(id, pageSize, offset);
  return { rows, total, page: safePage, totalPages };
}

/** Um administrador não pode ser suspenso nem removido pelo próprio painel. */
function assertNotAdmin(id: number, action: string): void {
  if (config.admin.chatIds.includes(id)) {
    throw new ConflictError(`Não é possível ${action} um administrador.`);
  }
}

export async function setCustomerBanned(id: number, banned: boolean): Promise<CustomerSummary> {
  if (banned) assertNotAdmin(id, "suspender");

  const updated = await setUserBanned(id, banned);
  if (!updated) throw new NotFoundError("Cliente não encontrado.");

  logger.info({ customerId: id, banned }, "Status de suspensão do cliente alterado");
  return getCustomer(id);
}

export interface RemovalResult {
  releasedOrders: number;
  keptPaidOrders: number;
}

/**
 * Remove o cadastro do cliente.
 *
 * Antes de apagar, cancela os pedidos pendentes: eles seguram estoque
 * reservado e, sem o dono, ninguém mais os pagaria — a reserva ficaria presa
 * para sempre. Pedidos pagos são preservados para não furar o faturamento.
 */
export async function removeCustomer(id: number): Promise<RemovalResult> {
  assertNotAdmin(id, "remover");

  const customer = await getCustomer(id);
  const pendingIds = await findPendingOrderIdsByUser(id);

  let releasedOrders = 0;
  for (const orderId of pendingIds) {
    try {
      await cancelPendingOrder(orderId, "cancelled");
      releasedOrders += 1;
    } catch (err) {
      logger.error({ err, orderId, customerId: id }, "Falha ao liberar pedido do cliente removido");
    }
  }

  const removed = await deleteUser(id);
  if (!removed) throw new NotFoundError("Cliente não encontrado.");

  logger.warn(
    { customerId: id, releasedOrders, keptPaidOrders: customer.paid_orders_count },
    "Cliente removido pelo administrador"
  );

  return { releasedOrders, keptPaidOrders: customer.paid_orders_count };
}
