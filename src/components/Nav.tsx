import Link from "next/link";
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

        <div className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="hover:text-beige-800 transition-colors">Dokumenty</Link>
          <Link href="/dossiers" className="hover:text-beige-800 transition-colors">Teczki</Link>
          <Link href="/vehicle-archive" className="hover:text-beige-800 transition-colors">Archiwum pojazdów</Link>
          {can.seeArchive(role) && (
            <Link href="/archive" className="hover:text-beige-800 transition-colors">Archiwum</Link>
          )}
          {role === "director" && (
               <Link href="/admin" className="hover:text-beige-800 transition-colors">Panel zarządu</Link>
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
