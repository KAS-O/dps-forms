// src/pages/admin/index.tsx
import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { useProfile } from "@/hooks/useProfile";

type Period = "all" | "30d" | "7d";

export default function AdminPage() {
  const { role, ready, login } = useProfile();
  const [period, setPeriod] = useState<Period>("all");
  const [err, setErr] = useState<string | null>(null);

  const [counts, setCounts] = useState({
    mandaty: 0,
    lseb: 0,
    areszty: 0,
  });

  const [balance, setBalance] = useState<number>(0);

  // Granica czasu dla filtrów
  const tsFrom = useMemo(() => {
    if (period === "all") return null;
    const now = new Date();
    const d = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - (period === "30d" ? 30 : 7),
      now.getHours(),
      now.getMinutes(),
      now.getSeconds()
    );
    return Timestamp.fromDate(d);
  }, [period]);

  useEffect(() => {
    setErr(null);
    // KLUCZOWE: nie rób nic dopóki profil się nie załaduje
    if (!ready) return;
    // Jeśli nie Director – nie odpalamy żadnych zapytań
    if (role !== "director") return;

    (async () => {
      try {
        // Statystyki z "archives"
        const countByTemplate = async (templateName: string) => {
          const base = collection(db, "archives");
          const q = tsFrom
            ? query(
                base,
                where("templateName", "==", templateName),
                where("createdAt", ">=", tsFrom),
                orderBy("createdAt", "desc")
              )
            : query(
                base,
                where("templateName", "==", templateName),
                orderBy("createdAt", "desc")
              );
          const snap = await getDocs(q);
          return snap.size;
        };

        const [mand, lseb, arre] = await Promise.all([
          countByTemplate("Bloczek mandatowy"),
          countByTemplate("Kontrola LSEB"),
          countByTemplate("Protokół osadzenia / aresztowania"),
        ]);
        setCounts({ mandaty: mand, lseb, areszty: arre });

        // Saldo finansów (tylko dla Director)
        const fSnap = await getDoc(doc(db, "finance", "state"));
        setBalance(Number(fSnap.data()?.balance || 0));
      } catch (e: any) {
        console.error(e);
        setErr(e?.message || "Błąd odczytu danych.");
      }
    })();
  }, [ready, role, tsFrom]);

  // Widoki
  const Loading = (
    <div className="min-h-screen flex items-center justify-center">
      <div className="card p-6 text-center">Ładowanie…</div>
    </div>
  );

  const NoAccess = (
    <>
      <Head>
        <title>DPS 77RP — Panel zarządu</title>
      </Head>
      <Nav />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="card p-6 text-center">
          <h1 className="text-xl font-bold mb-2">Brak dostępu</h1>
          <p>
            Tylko <b>Director</b> może otworzyć Panel zarządu.
          </p>
        </div>
      </div>
    </>
  );

  const Content = (
    <>
      <Head>
        <title>DPS 77RP — Panel zarządu</title>
      </Head>
      <Nav />
      <div className="max-w-6xl mx-auto px-4 py-6 grid gap-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Panel zarządu</h1>
          <span className="text-sm text-beige-700">Zalogowany: {login}</span>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-sm">Okres:</label>
            <select
              className="input"
              value={period}
              onChange={(e) => setPeriod(e.target.value as Period)}
            >
              <option value="all">Od początku</option>
              <option value="30d">Ostatnie 30 dni</option>
              <option value="7d">Ostatnie 7 dni</option>
            </select>
          </div>
        </div>

        {err && <div className="card p-4 text-red-700">{err}</div>}

        <div className="grid md:grid-cols-3 gap-4">
          <div className="card p-4">
            <div className="text-sm text-beige-700">Liczba mandatów</div>
            <div className="text-3xl font-bold">{counts.mandaty}</div>
          </div>
          <div className="card p-4">
            <div className="text-sm text-beige-700">Kontrole LSEB</div>
            <div className="text-3xl font-bold">{counts.lseb}</div>
          </div>
          <div className="card p-4">
            <div className="text-sm text-beige-700">Areszty</div>
            <div className="text-3xl font-bold">{counts.areszty}</div>
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-beige-700">Stan konta DPS</div>
              <div className="text-3xl font-bold">${balance.toFixed(2)}</div>
            </div>
            {/* przyciski finansów — logika wypłać/wpłać zostaje u Ciebie */}
          </div>
        </div>
      </div>
    </>
  );

  return (
    <AuthGate>
      {!ready ? Loading : role !== "director" ? NoAccess : Content}
    </AuthGate>
  );
}
