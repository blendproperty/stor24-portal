import Link from "next/link";
import { privacyNoticeVersion, privacySections } from "@/lib/privacy-notice";
import styles from "../privacy/privacy.module.css";
export const metadata = { title: "Privacy and your information | STOR24" };
export default function PrivacyPage() {
 return <main className={styles.page}>
  <header><p className={styles.kicker}>STOR24 · YOUR INFORMATION</p><h1>Your information.<br/>Your choices.</h1><p>How we use your details, the choices you have and how to ask for help.</p><p>Edition: {privacyNoticeVersion}</p><a href="mailto:bookings@stor24.co.za?subject=Privacy%20request">Contact us about your information →</a></header>
  <nav aria-label="Privacy contents">{privacySections.map((section,i)=><a key={section.title} href={`#privacy-${i}`}>{section.title}</a>)}</nav>
  <article>{privacySections.map((section,i)=><section key={section.title} id={`privacy-${i}`}><h2>{section.title}</h2><p>{section.body}</p></section>)}</article>
  <p><Link href="/paia">Access to information and PAIA</Link> · <a href="https://inforegulator.org.za/">Information Regulator</a> · <a href="https://policies.google.com/privacy">Google privacy information</a></p>
 </main>;
}

