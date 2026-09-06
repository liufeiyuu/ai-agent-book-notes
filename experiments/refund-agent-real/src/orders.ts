import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PROJECT_ROOT } from "./config";
import { record, validDate, type Order, type SearchScope } from "./types";

export async function loadOrders(): Promise<Order[]> {
  const values: unknown = JSON.parse(await readFile(resolve(PROJECT_ROOT, "fixtures/orders.json"), "utf8"));
  if (!Array.isArray(values)) throw new Error("Invalid orders fixture.");
  const ids = new Set<string>();
  for (const order of values) {
    if (!record(order)) throw new Error("Invalid order.");
    for (const key of ["id", "userId", "product", "category", "channel"]) {
      if (typeof order[key] !== "string" || !order[key]) throw new Error(`Invalid order field ${key}.`);
    }
    for (const key of ["opened", "accessoriesComplete", "damaged", "qualityIssue"]) {
      if (typeof order[key] !== "boolean") throw new Error(`Invalid order field ${key}.`);
    }
    if (!validDate(order.purchasedAt) || !validDate(order.deliveredAt) || order.deliveredAt < order.purchasedAt) throw new Error("Invalid order dates.");
    if (ids.has(order.id as string)) throw new Error("Duplicate order ID.");
    ids.add(order.id as string);
  }
  return values as Order[];
}

export function visibleOrders(orders: Order[], userId: string, orderId?: string, keyword?: string): Order[] {
  return orders.filter(order => order.userId === userId &&
    (orderId === undefined || order.id.toLowerCase() === orderId.toLowerCase()) &&
    (keyword === undefined || order.product.toLowerCase().includes(keyword.toLowerCase())));
}

export function orderFacts(order: Order, today: string) {
  if (!validDate(today) || today < order.deliveredAt) throw new Error("Business date precedes delivery or is invalid.");
  const { userId: _userId, ...facts } = order;
  return { ...facts, daysSinceDelivery: Math.round((Date.parse(today) - Date.parse(order.deliveredAt)) / 86_400_000) };
}

export function scopeForOrder(order: Order): SearchScope {
  return { category: order.category, channel: order.channel, policyDate: order.purchasedAt };
}
