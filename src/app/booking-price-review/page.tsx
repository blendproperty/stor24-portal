import { redirect } from "next/navigation";
import { customerPriceReviewLink } from "@/lib/customer-price-review-link";
export const metadata = { title: "My STOR24 quote review", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default async function LegacyBookingPriceReview({ searchParams }: { searchParams: Promise<{ reference?: string; proposal?: string }> }) {
  const query = await searchParams;
  redirect(customerPriceReviewLink(typeof query.reference === "string" ? query.reference.slice(0, 80) : "", typeof query.proposal === "string" ? query.proposal.slice(0, 100) : ""));
}
