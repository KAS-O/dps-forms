// src/components/Nav.tsx
import Link from "next/link";
import Image from "next/image";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useProfile, can } from "@/hooks/useProfile";

export default function Nav() {
  const { role, login } = useProfile();

  return (
    <nav className="w-full sticky top-0 z-10 bg-[var(--bg)]/85 backdrop-blur border-b border-beige-200">
      <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-4">
        <Image src="/logo.png" alt="DPS" width={32} height={32} />
        <Link href="/dashboard" className="font-semibold">Department of Public Safety</Link>
        <div className="flex-1" />
        <div className="flex items-center gap-3 text-sm">
          <Link href="/dossiers">Teczki</Link>
          {can.seeArchive(role) && <Link href="/archive">Archiwum</Link>}
          {can.seeLogs(role) && <Link href="/logs">Logi</Link>}
          <span className="text-beige-700">({login} • {role ?? "..."})</span>
          <button className="btn" onClick={() => signOut(auth)}>Wyloguj</button>
        </div>
      </div>
    </nav>
  );
}
