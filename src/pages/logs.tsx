import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { collection, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useEffect, useState } from "react";
import { useProfile, can } from "@/hooks/useProfile";

export default function LogsPage() {
  const { role } = useProfile();
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    if (!can.seeLogs(role)) return;
    const q = query(collection(db, "logs"), orderBy("ts", "desc"), limit(200));
    return onSnapshot(q, (snap) => setLogs(snap.docs.map(d => d.data())));
  }, [role]);

  if (!can.seeLogs(role)) return (
    <AuthGate>
      <Nav /><div className="max-w-4xl mx-auto p-6">Brak uprawnień.</div>
    </AuthGate>
  );

  return (
    <AuthGate>
      <Head><title>DPS 77RP — Logi</title></Head>
      <Nav />
      <div className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Logi</h1>
        <div className="space-y-2 text-sm">
          {logs.map((l, i) => (
            <div key={i} className="card p-3">
              <div><b>{l.type}</b> • {l.login || "-"} • {l.ts?.toDate?.().toLocaleString?.("pl-PL")} {l.error ? `• ${l.error}` : ""}</div>
            </div>
          ))}
        </div>
      </div>
    </AuthGate>
  );
}
