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

  const navLinks = [
    { href: "/dashboard", label: "Dokumenty", color: "#38bdf8" },
    { href: "/dossiers", label: "Teczki", color: "#a855f7" },
    { href: "/criminal-groups", label: "Grupy przestępcze", color: "#f97316" },
    { href: "/vehicle-archive", label: "Archiwum pojazdów", color: "#10b981" },
  ];
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
          {navLinks.map((link) => {
            const isActive = router.pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-full border px-3 py-1.5 font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                  isActive ? "shadow-lg" : "hover:-translate-y-0.5"
                }`}
                style={{
                  borderColor: `${link.color}80`,
                  background: isActive
                    ? `linear-gradient(135deg, ${link.color}30, ${link.color}55)`
                    : `linear-gradient(135deg, ${link.color}14, transparent)`,
                  color: isActive ? "#0f172a" : link.color,
                  boxShadow: isActive ? `0 12px 32px -20px ${link.color}aa` : undefined,
                }}
              >
                {link.label}
              </Link>
            );
          })}
          {can.seeArchive(role) && (
            <Link
              href="/archive"
              className={`rounded-full border px-3 py-1.5 font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                archiveActive ? "shadow-lg" : "hover:-translate-y-0.5"
              }`}
              style={{
                borderColor: "#facc1580",
                background: archiveActive
                  ? "linear-gradient(135deg, #facc1530, #facc1555)"
                  : "linear-gradient(135deg, #facc1526, transparent)",
                color: archiveActive ? "#0f172a" : "#facc15",
                boxShadow: archiveActive ? "0 12px 32px -20px #facc15aa" : undefined,
              }}
            >
              Archiwum
            </Link>
          )}
          {role === "director" && (
               <Link
                 href="/admin"
                 className={`rounded-full border px-3 py-1.5 font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                   adminActive ? "shadow-lg" : "hover:-translate-y-0.5"
                 }`}
                 style={{
                   borderColor: "#ef444480",
                   background: adminActive
                     ? "linear-gradient(135deg, #ef444430, #ef444455)"
                     : "linear-gradient(135deg, #ef444426, transparent)",
                   color: adminActive ? "#0f172a" : "#ef4444",
                   boxShadow: adminActive ? "0 12px 32px -20px #ef4444aa" : undefined,
                 }}
               >
                 Panel zarządu
               </Link>
          )}
          <span className="ml-2 px-2 py-1 rounded bg-white/10 text-beige-900">
            {fullName || "—"}{role ? ` • ${roleLabel}` : ""}
          </span>
          <button
            onClick={logout}
           className="btn h-9 px-5 text-xs font-semibold"
          >
            Wyloguj
          </button>
        </div>
      </div>
    </nav>
  );
}
