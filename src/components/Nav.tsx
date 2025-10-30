import Link from "next/link";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import { useProfile, can } from "@/hooks/useProfile";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useDialog } from "@/components/DialogProvider";
import { useSessionActivity } from "@/components/ActivityLogger";

const ROLE_LABELS: Record<string, string> = {
  director: "Director",
  chief: "Chief Agent",
  senior: "Senior Agent",
  agent: "Agent",
  rookie: "Rookie",
};

const NAV_LINKS: { href: string; label: string; color: string }[] = [
  { href: "/dashboard", label: "Dokumenty", color: "#38bdf8" },
  { href: "/dossiers", label: "Teczki", color: "#818cf8" },
  { href: "/criminal-groups", label: "Grupy przestępcze", color: "#f472b6" },
  { href: "/vehicle-archive", label: "Archiwum pojazdów", color: "#34d399" },
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
  const { fullName, role } = useProfile();
  const roleLabel = role ? (ROLE_LABELS[role] || role) : "";
  const { confirm } = useDialog();
  const { logLogout } = useSessionActivity();
  const router = useRouter();
  const archiveActive = router.pathname.startsWith("/archive");
  const adminActive = router.pathname.startsWith("/admin");

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


  return (
    <nav className="w-full border-b border-white/10 bg-[var(--card)]/90 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="LSPD" width={32} height={32} className="floating" />
          <span className="font-semibold tracking-wide text-beige-900/90">
            Los Santos Police Department
          </span>
        </div>

        <div className="flex items-center gap-3 text-sm">
          {NAV_LINKS.map((link) => {
            const isActive = router.pathname === link.href || router.pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`nav-pill${isActive ? " nav-pill--active" : ""}`}
                style={createNavStyle(link.color, isActive)}
              >
                <span className="nav-pill__dot" style={{ background: link.color }} aria-hidden />
                {link.label}
              </Link>
            );
          })}
          {can.seeArchive(role) && (
            <Link
              href="/archive"
              className={`nav-pill${archiveActive ? " nav-pill--active" : ""}`}
              style={createNavStyle("#fbbf24", archiveActive)}
            >
              <span className="nav-pill__dot" style={{ background: "#fbbf24" }} aria-hidden />
              Archiwum
            </Link>
          )}
          {role === "director" && (
            <Link
              href="/admin"
              className={`nav-pill${adminActive ? " nav-pill--active" : ""}`}
              style={{ ...createNavStyle("#eab308", adminActive), color: "#fefce8" }}
            >
              <span className="nav-pill__dot" style={{ background: "#eab308" }} aria-hidden />
              Panel zarządu
            </Link>
          )}
          <span className="ml-2 px-2 py-1 rounded bg-white/10 text-beige-900">
            {fullName || "—"}{role ? ` • ${roleLabel}` : ""}
          </span>
          <button onClick={logout} className="btn h-9 px-5 text-xs font-semibold">
            Wyloguj
          </button>
        </div>
      </div>
    </nav>
  );
}
