import Link from "next/link";

export default function Nav() {
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
          <Link href="/admin" className="hover:underline">Panel zarządu</Link>
        </div>
      </div>
    </nav>
  );
}
