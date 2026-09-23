import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { restrictedMessage } from "@/lib/navigation-access";
export const metadata = { title: "Access restricted" };
export default function AccessRestrictedPage() {
  return <section className="panel panel-spacious restricted-page">
    <LockKeyhole size={32} aria-hidden="true" />
    <h1>Access restricted</h1>
    <p>Your account does not have permission to view this section.</p>
    <p>{restrictedMessage}</p>
    <Link className="button button-primary" href="/">Return to dashboard</Link>
  </section>;
}
