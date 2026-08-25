import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/session";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import "./globals.css";
import "../styles/stor24-brand.css";

const satoshi = localFont({
  src: "../../public/brand/Satoshi-Variable.ttf",
  variable: "--font-satoshi",
  display: "swap",
  weight: "300 900",
});

export const metadata: Metadata = {
  title: {
    default: "Stor24 CRM",
    template: "%s | Stor24 CRM",
  },
  description: "Cloud operations platform for Stor24 self-storage facilities.",
  applicationName: "STOR 24 Operations",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "STOR 24",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#071411",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getSession();
  return (
    <html lang="en" className={`${satoshi.variable} h-full antialiased`}>
      <body className="min-h-full">
        <ServiceWorkerRegistration />
        <AppShell session={session}>{children}</AppShell>
      </body>
    </html>
  );
}
