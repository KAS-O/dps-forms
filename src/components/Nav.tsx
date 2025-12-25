import Link from "next/link";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import { useProfile, can } from "@/hooks/useProfile";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useDialog } from "@/components/DialogProvider";
import { useSessionActivity } from "@/components/ActivityLogger";
import { UNIT_SECTIONS, unitHasAccess } from "@/lib/internalUnits";
import UnitSidebar from "@/components/UnitSidebar";

const NAV_LINKS: { href: string; label: string; color: string }[] = [
  { href: "/dashboard", label: "Dokumenty", color: "#60a5fa" },
  { href: "/chain-of-command", label: "Chain of Command", color: "#f97316" },
  { href: "/dossiers", label: "Teczki", color: "#8b5cf6" },
  { href: "/vehicle-archive", label: "Archiwum pojazdów", color: "#34d399" },
  { href: "/pwc", label: "PWC", color: "#06b6d4" },
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

type NavProps = {
  showSidebars?: boolean;
};

export default function Nav({ showSidebars = true }: NavProps) {
  const { role, units, additionalRanks, adminPrivileges } = useProfile();
  const { confirm } = useDialog();
  const { logLogout } = useSessionActivity();
  const router = useRouter();
  const archiveActive = router.pathname.startsWith("/archive");
  const adminActive = router.pathname.startsWith("/admin");
  const currentPath = router.asPath;
  const unitLinks = UNIT_SECTIONS.filter((section) =>
    unitHasAccess(section.unit, additionalRanks, role, units, adminPrivileges)
  );

  const logout = async () => {
    const ok = await confirm({
      title: "Wylogowanie",
      message: "Czy na pewno chcesz zakończyć sesję?",
      confirmLabel: "Wyloguj",
      cancelLabel: "Anuluj",
      tone: "danger",
    });
    if (!ok) return;
    await logLogout();
    await signOut(auth);
  };

  return (
    <>
      <nav className="w-full border-b border-white/10 bg-[var(--card)]/90 backdrop-blur-xl">
        <div className="nav-shell">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 min-w-[220px]">
              <img src="/logo.png" alt="LSPD" width={32} height={32} className="floating" />
              <span className="font-semibold tracking-wide text-beige-900/90">
                Los Santos Police Department
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex-1 overflow-x-auto pb-1">
              <div className="flex min-w-max items-center gap-2 text-sm">
                {NAV_LINKS.map((link) => {
                  const isActive = router.pathname === link.href || router.pathname.startsWith(`${link.href}/`);
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`nav-pill shrink-0${isActive ? " nav-pill--active" : ""}`}
                      style={createNavStyle(link.color, isActive)}
                    >
                      <span className="nav-pill__dot" style={{ background: link.color }} aria-hidden />
                      {link.label}
                    </Link>
                  );
                })}
                <div className="flex items-center gap-2 lg:hidden">
                  {unitLinks.map((section) => {
                    const isActive = currentPath === section.href || currentPath.startsWith(`${section.href}/`);
                    return (
                      <Link
                        key={section.href}
                        href={section.href}
                        className={`nav-pill shrink-0${isActive ? " nav-pill--active" : ""}`}
                        style={createNavStyle(section.navColor, isActive)}
                      >
                        <span className="nav-pill__dot" style={{ background: section.navColor }} aria-hidden />
                        {section.shortLabel}
                      </Link>
                    );
                  })}
                </div>
                {can.seeArchive(role, adminPrivileges) && (
                  <Link
                    href="/archive"
                    className={`nav-pill shrink-0${archiveActive ? " nav-pill--active" : ""}`}
                    style={createNavStyle("#facc15", archiveActive)}
                  >
                    <span className="nav-pill__dot" style={{ background: "#facc15" }} aria-hidden />
                    Archiwum
                  </Link>
                )}
                {can.manageRoles(role, adminPrivileges) && (
                  <Link
                    href="/admin"
                    className={`nav-pill shrink-0${adminActive ? " nav-pill--active" : ""}`}
                    style={createNavStyle("#0ea5e9", adminActive)}
                  >
                    <span className="nav-pill__dot" style={{ background: "#0ea5e9" }} aria-hidden />
                    Panel zarządu
                  </Link>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 whitespace-nowrap text-sm sm:text-base">
              <button
                onClick={logout}
                className="btn w-full px-6 py-2.5 text-sm font-semibold tracking-wide shadow-lg sm:w-auto sm:min-h-[3rem]"
              >
                Wyloguj
              </button>
            </div>
          </div>
        </div>
      </nav>
      {showSidebars && <UnitSidebar />}
    </>
  );
}
