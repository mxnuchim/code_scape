import { listOrders } from "../../../lib/orders";

export async function GET() {
  const orders = await listOrders();
  return Response.json(orders);
}
