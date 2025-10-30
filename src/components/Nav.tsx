import Link from "next/link";
import { useRouter } from "next/router";
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

export default function Nav() {
  const { fullName, role } = useProfile();
  const roleLabel = role ? (ROLE_LABELS[role] || role) : "";
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
    await logLogout("logout");
    await signOut(auth);
  };

  const links = [
    {
      href: "/dashboard",
      match: "/dashboard",
      label: "Dokumenty",
      icon: "📄",
      gradient: "linear-gradient(135deg, rgba(56,189,248,0.55), rgba(129,140,248,0.65))",
      border: "rgba(94,234,212,0.4)",
      shadow: "0 18px 40px -18px rgba(56,189,248,0.65)",
    },
    {
      href: "/dossiers",
      match: "/dossiers",
      label: "Teczki",
      icon: "🗂️",
      gradient: "linear-gradient(135deg, rgba(99,102,241,0.5), rgba(168,85,247,0.6))",
      border: "rgba(129,140,248,0.45)",
      shadow: "0 18px 40px -18px rgba(129,140,248,0.55)",
    },
    {
      href: "/criminal-groups",
      match: "/criminal-groups",
      label: "Grupy przestępcze",
      icon: "🦹",
      gradient: "linear-gradient(135deg, rgba(245,158,11,0.45), rgba(249,115,22,0.55))",
      border: "rgba(253,186,116,0.5)",
      shadow: "0 18px 40px -18px rgba(249,115,22,0.55)",
    },
    {
      href: "/vehicle-archive",
      match: "/vehicle-archive",
      label: "Archiwum pojazdów",
      icon: "🚔",
      gradient: "linear-gradient(135deg, rgba(14,165,233,0.5), rgba(34,197,94,0.55))",
      border: "rgba(125,211,252,0.5)",
      shadow: "0 18px 40px -18px rgba(14,165,233,0.6)",
    },
  ];

  const linkBaseClass =
    "group relative inline-flex items-center gap-2 rounded-full border px-3 py-1.5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg";

  
  return (
    <nav className="w-full border-b border-white/10 bg-[var(--card)]/90 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="LSPD" width={32} height={32} className="floating" />
          <span className="font-semibold tracking-wide text-beige-900/90">
            Los Santos Police Department
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 text-xs font-semibold uppercase tracking-wide">
          {links.map((link) => {
            const active = router.pathname.startsWith(link.match);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={linkBaseClass}
                style={{
                  background: active
                    ? link.gradient
                    : "linear-gradient(135deg, rgba(12,24,48,0.85), rgba(12,24,48,0.6))",
                  borderColor: active ? link.border : "rgba(148, 163, 184, 0.35)",
                  boxShadow: active ? link.shadow : "0 15px 35px -20px rgba(15, 23, 42, 0.65)",
                }}
              >
                <span className="text-base leading-none drop-shadow-sm">{link.icon}</span>
                <span className="tracking-wide text-white/90">{link.label}</span>
              </Link>
            );
          })}
          {can.seeArchive(role) && (
            <Link
              href="/archive"
              className={`${linkBaseClass} border-white/20 text-white/80`}
              style={{
                background: "linear-gradient(135deg, rgba(15,23,42,0.85), rgba(30,41,59,0.65))",
                boxShadow: "0 15px 30px -20px rgba(59,130,246,0.35)",
              }}
            >
              <span className="text-base leading-none">🗄️</span>
              <span>Archiwum</span>
            </Link>
          )}
          {role === "director" && (
            <Link
              href="/admin"
              className={`${linkBaseClass} border-white/20 text-white/80`}
              style={{
                background: "linear-gradient(135deg, rgba(30,64,175,0.75), rgba(30,64,175,0.55))",
                boxShadow: "0 18px 40px -18px rgba(30,64,175,0.55)",
              }}
            >
              <span className="text-base leading-none">🛡️</span>
              <span>Panel zarządu</span>
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
