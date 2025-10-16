import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  doc,
  addDoc,
} from "firebase/firestore";
import { useProfile, can } from "@/hooks/useProfile";

type Archive = {
  id: string;
  templateName: string;
  templateSlug?: string;
  createdAt?: any;
  values?: Record<string, any>;
  officers?: string[];
};

type Profile = {
  id: string;
  login: string;
  fullName?: string;
  role?: string;
  statsResetAt?: any;
};

export default function AdminPage() {
  const { role, login } = useProfile();
  const [archives, setArchives] = useState<Archive[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [period, setPeriod] = useState<"all" | "30" | "7">("all");
  const [balance, setBalance] = useState<number>(0);
  const [err, setErr] = useState<string | null>(null);

  if (!can.manageFinance(role)) {
    return (
      <AuthGate>
        <>
          <Head><title>DPS 77RP — Panel zarządu</title></Head>
          <Nav />
          <div className="max-w-4xl mx-auto px-4 py-10">
            <div className="card p-6 text-center">
              <h1 className="text-xl font-bold mb-2">Brak dostępu</h1>
              <p>Tylko Director może wejść do Panelu zarządu.</p>
            </div>
          </div>
        </>
      </AuthGate>
    );
  }

  useEffect(() => {
    (async () => {
      try {
        const qa = query(collection(db, "archives"), orderBy("createdAt", "desc"));
        const sa = await getDocs(qa);
        setArchives(sa.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch (e) { console.error(e); setErr("Błąd odczytu archiwum (uprawnienia/reguły)."); }

      try {
        const qp = query(collection(db, "profiles"));
        const sp = await getDocs(qp);
        setProfiles(sp.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch (e) { console.error(e); setErr("Błąd odczytu profili (uprawnienia/reguły)."); }

      try {
        const fb = await getDocs(query(collection(db, "finance")));
        const balanceDoc = fb.docs.find(d => d.id === "balance");
        setBalance((balanceDoc?.data()?.balance ?? 0) as number);
      } catch (e) { console.error(e); /* zostaw 0 */ }
    })();
  }, []);

  const now = new Date().getTime();
  const cutoff = useMemo(() => {
    if (period === "7") return now - 7 * 24 * 3600 * 1000;
    if (period === "30") return now - 30 * 24 * 3600 * 1000;
    return 0;
  }, [period, now]);

  const filtered = useMemo(() => {
    return archives.filter(a => {
      const t = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
      return cutoff === 0 || t >= cutoff;
    });
  }, [archives, cutoff]);

  const countBySlug = (slug: string) =>
    filtered.filter(a => (a.templateSlug || "").toLowerCase() === slug).length;

  const finesSum = useMemo(() => {
    return filtered.reduce((acc, a) => {
      if ((a.templateSlug || "").toLowerCase() === "swiadczenie-spoleczne") return acc;
      const v = a.values || {};
      const n = Number(v.kwota || v.grzywna || 0);
      return acc + (isNaN(n) ? 0 : n);
    }, 0);
  }, [filtered]);

  const officerStats = useMemo(() => {
    const map = new Map<string, { fines: number; tickets: number; lseb: number; arrests: number }>();
    filtered.forEach(a => {
      const offs = a.officers || [];
      offs.forEach(name => {
        if (!map.has(name)) map.set(name, { fines: 0, tickets: 0, lseb: 0, arrests: 0 });
        const s = map.get(name)!;
        const slug = (a.templateSlug || "").toLowerCase();
        if (slug === "bloczek-mandatowy") {
          s.tickets++;
          const n = Number(a.values?.kwota || 0);
          if (!isNaN(n)) s.fines += n;
        } else if (slug === "kontrola-lseb") {
          s.lseb++;
        } else if (slug === "protokol-aresztowania") {
          s.arrests++;
          const n = Number(a.values?.grzywna || 0);
          if (!isNaN(n)) s.fines += n;
        }
      });
    });
    return Array.from(map.entries()).map(([name, v]) => ({ name, ...v }));
  }, [filtered]);

  const setFinance = async (next: number, action: "deposit" | "withdraw" | "withdraw_all", amount?: number) => {
    await setDoc(doc(db, "finance", "balance"), { balance: next }, { merge: true });
    setBalance(next);
    await addDoc(collection(db, "logs"), {
      type: `finance_${action}`, by: login, amount: amount ?? null, newBalance: next, ts: serverTimestamp(),
    });
  };

  const deposit = async () => {
    const v = Number(prompt("Kwota wpłaty (USD):", "0") || "0");
    if (isNaN(v) || v <= 0) return;
    await setFinance(balance + v, "deposit", v);
  };

  const withdraw = async () => {
    const v = Number(prompt("Kwota wypłaty (USD):", "0") || "0");
    if (isNaN(v) || v <= 0) return;
    if (v > balance) return alert("Brak środków.");
    await setFinance(balance - v, "withdraw", v);
  };

  const withdrawAll = async () => {
    if (!confirm("Wypłacić cały stan konta?")) return;
    await setFinance(0, "withdraw_all", balance);
  };

  return (
    <AuthGate>
      <>
        <Head><title>DPS 77RP — Panel zarządu</title></Head>
        <Nav />
        <div className="max-w-6xl mx-auto px-4 py-6 grid gap-6">
          {err && <div className="card p-3 text-red-700">{err}</div>}

          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Panel zarządu</h1>
            <select className="input ml-auto w-[200px]" value={period} onChange={e=>setPeriod(e.target.value as any)}>
              <option value="all">Od początku</option>
              <option value="30">Ostatnie 30 dni</option>
              <option value="7">Ostatnie 7 dni</option>
            </select>
          </div>

          <div className="grid md:grid-cols-4 gap-3">
            <div className="card p-4"><div className="text-sm text-beige-700">Mandaty</div><div className="text-2xl font-bold">{countBySlug("bloczek-mandatowy")}</div></div>
            <div className="card p-4"><div className="text-sm text-beige-700">Kontrole LSEB</div><div className="text-2xl font-bold">{countBySlug("kontrola-lseb")}</div></div>
            <div className="card p-4"><div className="text-sm text-beige-700">Areszty</div><div className="text-2xl font-bold">{countBySlug("protokol-aresztowania")}</div></div>
            <div className="card p-4"><div className="text-sm text-beige-700">Suma grzywien (USD)</div><div className="text-2xl font-bold">${filtered.reduce((acc,a)=>acc+(Number(a.values?.kwota||a.values?.grzywna||0)||0),0)}</div></div>
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Finanse DPS</h2>
              <div className="text-xl font-bold">${balance}</div>
            </div>
            <div className="flex gap-2">
              <button className="btn" onClick={deposit}>Wpłać</button>
              <button className="btn" onClick={withdraw}>Wypłać</button>
              <button className="btn bg-red-700 text-white" onClick={withdrawAll}>Wypłać wszystko</button>
            </div>
            <p className="text-xs text-beige-700 mt-2">Dostęp: tylko Director.</p>
          </div>

          <div className="card p-4">
            <h2 className="font-semibold mb-2">Statystyki funkcjonariuszy</h2>
            <div className="grid gap-2">
              {officerStats.map(s => (
                <div key={s.name} className="card p-3 grid md:grid-cols-[1fr_auto] gap-3">
                  <div>
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-sm text-beige-700">
                      Mandaty: {s.tickets} • Kontrole: {s.lseb} • Areszty: {s.arrests} • Kwota (USD): ${s.fines}
                    </div>
                  </div>
                </div>
              ))}
              {officerStats.length === 0 && <p>Brak danych.</p>}
            </div>
          </div>
        </div>
      </>
    </AuthGate>
  );
}
