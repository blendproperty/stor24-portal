import { additionalPhotoHandoff } from "@/lib/additional-access-people";
import { getSession } from "@/lib/session";
import { AdditionalPhotoCapture } from "@/components/additional-photo-capture";

export const dynamic = "force-dynamic";
export const metadata = { title: "Access photograph", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function CapturePage({ params }: { params: Promise<{ token: string }> }) {
  if (await getSession()) return <main className="tenant-card"><h1>Use a customer tablet</h1><p>This capture link cannot open in a staff session. Open it on a separate tablet or private browser, then hand that device to the person.</p></main>;
  const { token } = await params;
  let details: Awaited<ReturnType<typeof additionalPhotoHandoff>> | null = null;
  try {
    details = await additionalPhotoHandoff(token);
  } catch { /* Invalid and expired links share one response. */ }
  return details ? <AdditionalPhotoCapture token={token} details={details} /> : <main className="tenant-card"><h1>Capture link unavailable</h1><p>Ask staff for a new link. Links expire after five minutes or after a photo is submitted.</p></main>;
}
