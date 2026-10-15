import { prisma } from "./db";

export async function listOrders() {
  return prisma.order.findMany();
}
