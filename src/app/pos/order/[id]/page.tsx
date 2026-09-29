import { OrderScreen } from "@/components/pos/order-screen";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderScreen orderId={id} />;
}
