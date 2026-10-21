export function customerPriceReviewLink(reference: string, proposal: string) {
  return `/my/booking-price-review?${new URLSearchParams({ reference, proposal })}`;
}
