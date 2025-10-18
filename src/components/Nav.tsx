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
    <nav className="w-full border-b border-beige-300 bg-[var(--card)]">
      <div className="max-w-6xl mx-auto px-4 h-12 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="DPS" width={28} height={28} />
          <span className="font-semibold">Department of Public Safety</span>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="hover:underline">Dokumenty</Link>
          <Link href="/dossiers" className="hover:underline">Teczki</Link>
          <Link href="/vehicle-archive" className="hover:underline">Archiwum pojazdów</Link>
          {can.seeArchive(role) && (
            <Link href="/archive" className="hover:underline">Archiwum</Link>
          )}
          {role === "director" && (
              <Link href="/admin" className="hover:underline">Panel zarządu</Link>
          )}
          <span className="ml-2 px-2 py-1 rounded bg-beige-200 text-beige-900">
            {fullName || "—"}{role ? ` • ${roleLabel}` : ""}
          </span>
          <button
            onClick={logout}
            className="btn h-9 border-transparent bg-gradient-to-r from-purple-600 via-fuchsia-500 to-indigo-500 text-white text-xs font-semibold shadow-[0_0_12px_rgba(168,85,247,0.3)] hover:brightness-110"
          >
            Wyloguj
          </button>
        </div>
      </div>
    </nav>
  );
}
