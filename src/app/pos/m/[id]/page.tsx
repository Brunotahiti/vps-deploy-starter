import { WaiterOrder } from "@/components/waiter/order";
export default async function WaiterOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WaiterOrder orderId={id} />;
}
