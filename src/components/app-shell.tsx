"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  CalendarDays,
  CalendarCheck,
  Calculator,
  CreditCard,
  LandPlot,
  LayoutDashboard,
  LogOut,
  LockKeyhole,
  PhoneCall,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ScrollText,
  SlidersHorizontal,
  Users,
  Webhook,
  MessagesSquare,
  PackageOpen,
  Warehouse,
  WifiOff,
} from "lucide-react";
import { clsx } from "clsx";
import { useRouter } from "next/navigation";
import type { SessionPayload } from "@/lib/session";
import { ConnectivityStatus } from "@/components/connectivity-status";
import { BrandCorner } from "@/components/brand-corner";
import { GuidedHelp } from "@/components/guided-help";
import { WorkspaceFinder } from "@/components/workspace-finder";

import { canVisit, restrictedMessage, type NavigationAccess } from "@/lib/navigation-access";

const navigation = [
  { group: "Overview", href: "/", label: "Dashboard", icon: LayoutDashboard },
  { group: "Customers & sales", href: "/tenants", label: "Customers & tenants", icon: Users },
  { group: "Administration", href: "/users", label: "Users & permissions", icon: Users },
  { group: "Customers & sales", href: "/leads", label: "Lead to lease", icon: CalendarCheck },
  { group: "Customers & sales", href: "/reservations", label: "Reservations", icon: CalendarDays },
  { group: "Customers & sales", href: "/identity", label: "Identity review", icon: ShieldCheck },
  { group: "Facility operations", href: "/units", label: "Units & rates", icon: Warehouse },
  { group: "Finance", href: "/billing", label: "Billing & payments", icon: CreditCard },
  { group: "Finance", href: "/collections", label: "Collections", icon: ShieldAlert },
  { group: "Facility operations", href: "/access", label: "Facial access", icon: ShieldCheck },
  { group: "Facility operations", href: "/operations", label: "Operations", icon: Building2 },
  { group: "Facility operations", href: "/operations/merchandise", label: "Merchandise", icon: PackageOpen },
  { group: "Finance", href: "/insurance", label: "Insurance", icon: ShieldCheck },
  { group: "Finance", href: "/adjustments", label: "Adjustments", icon: SlidersHorizontal },
  { group: "Administration", href: "/company", label: "Company & setup", icon: Settings },
  { group: "Insights", href: "/reports", label: "Reports", icon: BarChart3 },
  { group: "Insights", href: "/graphs", label: "Performance", icon: BarChart3 },
  { group: "Customers & sales", href: "/communications", label: "Communications", icon: MessagesSquare },
  { group: "Administration", href: "/integrations", label: "Integrations", icon: Webhook },
  { group: "Facility operations", href: "/calendar", label: "Calendar", icon: CalendarDays },
  { group: "Finance", href: "/prorate", label: "Prorate calculator", icon: Calculator },
  { group: "Facility operations", href: "/map", label: "Facility map", icon: LandPlot },
  { group: "Customers & sales", href: "/phone", label: "Phone integration", icon: PhoneCall },
  { group: "Administration", href: "/audit", label: "System audit", icon: ScrollText },
  { group: "Administration", href: "/audit/data-protection", label: "Data protection", icon: ShieldCheck },
  { group: "Administration", href: "/offline-workspace.html", label: "Offline workspace", icon: WifiOff },
  { group: "Administration", href: "/offline-readiness", label: "Offline readiness", icon: ShieldCheck },
];

export function AppShell({ children, session, facilityLabel = "Your facilities", access = { owner: false, permissions: [] } }: { children: React.ReactNode; session: SessionPayload | null; access?: NavigationAccess; facilityLabel?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const publicPage = pathname === "/login" || pathname === "/forgot-password" || pathname.startsWith("/reset-password/") || pathname.startsWith("/invite/") || pathname.startsWith("/setup/");
  if (publicPage || pathname === "/privacy" || pathname === "/paia" || pathname === "/my" || pathname.startsWith("/my/")) return children;

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

  const current = [...navigation].sort((a, b) => b.href.length - a.href.length).find(item => pathname === item.href || (item.href !== "/" && pathname.startsWith(`${item.href}/`)));
  const sections = ["Overview", "Customers & sales", "Facility operations", "Finance", "Insights", "Administration"];

  return (
    <div className="app-shell" data-workspace={pathname} data-section={current?.group ?? "Administration"}>
      <a className="skip-to-workspace" href="#workspace-content">Skip to workspace</a>
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
        <nav className="nav" aria-label="Primary navigation" data-guide="workspace-navigation">
          {sections.map(group => <section className="nav-section" key={group}>
          <p className="nav-label">{group}</p>
          {navigation.filter(item => item.group === group).map((item) => {
            const active = current?.href === item.href;
            if (!canVisit(item.href, access)) return <span key={item.href} className="nav-link nav-link-restricted" role="link" aria-disabled="true" tabIndex={0} title={restrictedMessage}>
              <item.icon size={18} /><span>{item.label}<small>{restrictedMessage}</small></span><LockKeyhole size={14} aria-hidden="true" />
            </span>;
            return (
              <Link
                className={clsx("nav-link", active && "nav-link-active")}
                href={item.href}
                aria-current={active ? "page" : undefined}
                key={item.href}
              >
                <item.icon size={18} />
                {item.label}
              </Link>
            );
          })}</section>)}
          <p className="nav-label">Personal</p>
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
              <small>Facility access</small>
              <strong>{facilityLabel}</strong>
              <ConnectivityStatus compact training={pathname === "/operations/move-in/training"} />
            </div>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <details key={pathname} className="staff-mobile-nav"><summary>Menu</summary><nav aria-label="Mobile navigation">{sections.map(group => <section key={group}><p className="nav-label">{group}</p>{navigation.filter(item => item.group === group).map(item => !canVisit(item.href, access) ? <span key={item.href} className="nav-link-restricted" role="link" aria-disabled="true" tabIndex={0} title={restrictedMessage}><item.icon size={17} /><span>{item.label}<small>{restrictedMessage}</small></span><LockKeyhole size={14} /></span> : <Link href={item.href} key={item.href} aria-current={current?.href === item.href ? "page" : undefined}><item.icon size={17} />{item.label}</Link>)}</section>)}<Link href="/settings"><Settings size={17} />Settings</Link></nav></details>
          <div className="workspace-context"><span>{pathname.startsWith("/settings") ? "Personal" : current?.group ?? "Workspace"}</span><strong>{pathname.startsWith("/settings") ? "Settings" : current?.label ?? "Workspace"}</strong></div>
          <WorkspaceFinder access={access} items={[...navigation, {href:"/settings",label:"Settings",group:"Personal"}, {href:"/operations/move-in",label:"New move-in",group:"Facility operations"}, {href:"/operations/accounts",label:"Customer accounts & payments",group:"Finance"}, {href:"/billing/monthly",label:"Monthly billing",group:"Finance"}, {href:"/billing/settlements",label:"Settlement reconciliation",group:"Finance"}, {href:"/billing/debit-orders",label:"Debit-order runs",group:"Finance"}, {href:"/billing/mri",label:"MRI accounting",group:"Finance"}, {href:"/billing/netcash",label:"Netcash payments",group:"Finance"}]} />
          <div className="top-actions">
            {session && <GuidedHelp key={session.userId} userId={session.userId} />}
            {canVisit("/calendar", access) && <Link className="icon-button" href="/calendar" aria-label="Scheduled work" title="Scheduled work"><CalendarDays size={18} /></Link>}
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
        <main className="content" id="workspace-content" tabIndex={-1}>{children}</main>
        <BrandCorner key={pathname} pathname={pathname} />
      </div>
    </div>
  );
}
