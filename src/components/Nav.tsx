import Link from "next/link";
import { useProfile, can } from "@/hooks/useProfile";

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
          {can.seeArchive(role) && (
            <Link href="/archive" className="hover:underline">Archiwum</Link>
          )}
          <Link href="/admin" className="hover:underline">Panel zarządu</Link>
          <span className="ml-2 px-2 py-1 rounded bg-beige-200 text-beige-900">
            {fullName || "—"}{role ? ` • ${roleLabel}` : ""}
          </span>
        </div>
      </div>
    </nav>
  );
}
