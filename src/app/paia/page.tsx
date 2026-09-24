import Link from "next/link";
import styles from "../privacy/privacy.module.css";
export const metadata = { title: "Access to information | STOR24" };
export default function PaiaPage(){return <main className={styles.page}>
 <header><p className={styles.kicker}>STOR24 · ACCESS TO INFORMATION</p><h1>Request your records.</h1><p>For access to personal information or other records, contact our team so your request can be directed to the appropriate person.</p></header>
 <section><h2>Make a request</h2><p>Email <a href="mailto:bookings@stor24.co.za?subject=Access%20to%20information%20request">bookings@stor24.co.za</a> or call <a href="tel:+27113809400">+27 11 380 9400</a>. Describe the records you need and include a booking reference if available. Please do not attach a full ID copy or send passwords or banking credentials.</p><p>STOR24 is a trading name of Blend Property 20 (Pty) Ltd. Our address is Store 1 – Midpoint, 162 Tonetti Street, Halfway House, Midrand, 1685.</p></section>
 <section><h2>PAIA manual</h2><p>Our formal PAIA manual is being finalised and is not yet available for download. This page is a contact route, not the completed manual. Contact us for assistance with the applicable process and forms.</p><p><a href="https://inforegulator.org.za/">Visit the Information Regulator for PAIA guidance and forms →</a></p></section>
 <p><Link href="/privacy">Read our privacy notice →</Link></p>
 </main>}

