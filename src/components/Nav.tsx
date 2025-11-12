import Link from "next/link";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import { useProfile, can } from "@/hooks/useProfile";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useDialog } from "@/components/DialogProvider";
import { useSessionActivity } from "@/components/ActivityLogger";
import { ROLE_LABELS, hasBoardAccess } from "@/lib/roles";

const BASE_NAV_LINKS: { href: string; label: string; color: string }[] = [
  { href: "/dashboard", label: "Dokumenty", color: "#38bdf8" },
  { href: "/chain-of-command", label: "Chain of Command", color: "#fb7185" },
  { href: "/dossiers", label: "Teczki", color: "#a855f7" },
  { href: "/criminal-groups", label: "Grupy przestępcze", color: "#f59e0b" },
  { href: "/vehicle-archive", label: "Archiwum pojazdów", color: "#22d3ee" },
];

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace(/[^0-9a-fA-F]/g, "");
  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16);
    const g = parseInt(normalized[1] + normalized[1], 16);
    const b = parseInt(normalized[2] + normalized[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (normalized.length === 6) {
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgba(96, 165, 250, ${alpha})`;
}

function createNavStyle(color: string, active: boolean): CSSProperties {
  return {
    borderColor: withAlpha(color, active ? 0.85 : 0.55),
    background: `linear-gradient(135deg, ${withAlpha(color, active ? 0.42 : 0.28)}, rgba(5, 10, 20, 0.78))`,
    boxShadow: active
      ? `0 18px 36px -18px ${withAlpha(color, 0.85)}`
      : `0 14px 32px -20px ${withAlpha(color, 0.7)}`,
    color: "#f8fafc",
  };
}

export default function Nav() {
  const { fullName, role, badgeNumber } = useProfile();
  const roleLabel = role ? ROLE_LABELS[role] || role : "";
  const { confirm } = useDialog();
  const { logLogout } = useSessionActivity();
  const router = useRouter();

  const logout = async () => {
    const ok = await confirm({
      title: "Wylogowanie",
      message: "Czy na pewno chcesz zakończyć sesję?",
      confirmLabel: "Wyloguj",
      cancelLabel: "Anuluj",
      tone: "danger",
    });
    if (!ok) return;
    await logLogout("logout")
    await signOut(auth);
  };

  const navItems = [
    ...BASE_NAV_LINKS,
    ...(can.seeArchive(role)
      ? [{ href: "/archive", label: "Archiwum", color: "#34d399" }]
      : []),
    ...(hasBoardAccess(role)
      ? [{ href: "/admin", label: "Panel zarządu", color: "#6366f1" }]
      : []),
  ];

  const profileSegments = [fullName || "—"];
  if (roleLabel) {
    profileSegments.push(roleLabel);
  }
  if (badgeNumber) {
    profileSegments.push(`#${badgeNumber}`);
  }

  return (
    <nav className="w-full border-b border-white/10 bg-[var(--card)]/90 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto flex flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3 min-w-[220px]">
          <img src="/logo.png" alt="LSPD" width={32} height={32} className="floating" />
          <span className="font-semibold tracking-wide text-beige-900/90">
            Los Santos Police Department
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-4 text-sm md:flex-row md:items-center md:justify-end">
          <div className="order-2 w-full md:order-1 md:max-w-3xl">
            <div className="grid w-full gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {navItems.map((link) => {
                const isActive =
                  router.pathname === link.href || router.pathname.startsWith(`${link.href}/`);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`nav-pill w-full justify-center${isActive ? " nav-pill--active" : ""}`}
                    style={createNavStyle(link.color, isActive)}
                  >
                    <span className="nav-pill__dot" style={{ background: link.color }} aria-hidden />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="order-1 flex items-center justify-end gap-2 whitespace-nowrap md:order-2">
            <span className="rounded-full bg-white/10 px-3 py-1 font-medium text-beige-900">
              {profileSegments.join(" • ")}
            </span>
            <button onClick={logout} className="btn h-9 px-5 text-xs font-semibold">
              Wyloguj
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
