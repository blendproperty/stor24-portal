import { StaffArrivals } from "@/components/staff-attention-workspace";
import { southAfricaDateKey } from "@/lib/south-africa-time";
import { arrivalQuerySchema } from "@/lib/staff-attention-policy";
export const metadata = { title: "Expected arrivals" };
export default async function ArrivalsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const now = new Date(), params = await searchParams;
  const defaults = { from: southAfricaDateKey(now), to: southAfricaDateKey(new Date(now.getTime() + 6 * 86400000)) };
  const parsed = arrivalQuerySchema.safeParse({ from: params.from ?? defaults.from, to: params.to ?? defaults.to });
  const initial = parsed.success ? parsed.data : defaults;
  return <StaffArrivals initialFrom={initial.from} initialTo={initial.to}/>;
}
