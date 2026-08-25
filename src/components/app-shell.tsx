"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CalendarCheck,
  Calculator,
  CreditCard,
  LandPlot,
  LayoutDashboard,
  LogOut,
  PhoneCall,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ScrollText,
  SlidersHorizontal,
  Users,
  Webhook,
  MessagesSquare,
  Warehouse,
  WifiOff,
} from "lucide-react";
import { clsx } from "clsx";
import { useRouter } from "next/navigation";
import type { SessionPayload } from "@/lib/session";
import { ConnectivityStatus } from "@/components/connectivity-status";

const navigation = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tenants", label: "Tenants", icon: Users },
  { href: "/users", label: "Users & permissions", icon: Users },
  { href: "/leads", label: "Lead to lease", icon: CalendarCheck },
  { href: "/reservations", label: "Reservations", icon: CalendarDays },
  { href: "/units", label: "Units & rates", icon: Warehouse },
  { href: "/billing", label: "Billing & payments", icon: CreditCard },
  { href: "/collections", label: "Collections", icon: ShieldAlert },
  { href: "/access", label: "Facial access", icon: ShieldCheck },
  { href: "/operations", label: "Operations", icon: Building2 },
  { href: "/adjustments", label: "Adjustments", icon: SlidersHorizontal },
  { href: "/company", label: "Company & setup", icon: Settings },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/graphs", label: "Graphs", icon: BarChart3 },
  { href: "/communications", label: "Communications", icon: MessagesSquare },
  { href: "/integrations", label: "Integrations", icon: Webhook },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/prorate", label: "Prorate calculator", icon: Calculator },
  { href: "/map", label: "Facility map", icon: LandPlot },
  { href: "/phone", label: "Phone integration", icon: PhoneCall },
  { href: "/audit", label: "Security audit", icon: ScrollText },
  { href: "/offline-workspace.html", label: "Offline workspace", icon: WifiOff },
  { href: "/offline-readiness", label: "Offline readiness", icon: ShieldCheck },
];

export function AppShell({ children, session }: { children: React.ReactNode; session: SessionPayload | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const publicPage = pathname === "/login" || pathname === "/forgot-password" || pathname.startsWith("/reset-password/") || pathname.startsWith("/invite/") || pathname.startsWith("/setup/");
  if (publicPage) return children;

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const initials = session?.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "ST";

  return (
    <div className="app-shell">
      <ConnectivityStatus />
      <aside className="sidebar">
        <Link className="brand" href="/">
          <Image
            alt="Stor24"
            className="brand-logo"
            height={40}
            priority
            src="/brand/stor24-logo-white.svg"
            unoptimized
            width={153}
          />
        </Link>
        <nav className="nav" aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navigation.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                className={clsx("nav-link", active && "nav-link-active")}
                href={item.href}
                key={item.href}
              >
                <item.icon size={18} />
                {item.label}
              </Link>
            );
          })}
          <p className="nav-label">System</p>
          <Link
            className={clsx(
              "nav-link",
              pathname.startsWith("/settings") && "nav-link-active",
            )}
            href="/settings"
          >
            <Settings size={18} />
            Settings
          </Link>
        </nav>
        <div className="sidebar-footer">
          <div className="facility-card">
            <div>
              <strong>Stor24 Randburg</strong>
              <ConnectivityStatus compact />
            </div>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <label className="search">
            <Search size={18} />
            <input
              aria-label="Global search"
              placeholder="Search tenants, units, leads or invoices…"
            />
          </label>
          <div className="top-actions">
            <button className="icon-button" type="button" aria-label="Notifications">
              <Bell size={18} />
            </button>
            <div className="profile">
              <span className="avatar">{initials}</span>
              <div>
                <strong>{session?.name ?? "Stor24 user"}</strong>
                <small>{session?.role ?? "Secure workspace"}</small>
              </div>
            </div>
            <button className="icon-button" type="button" aria-label="Sign out" title="Sign out" onClick={signOut}>
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
