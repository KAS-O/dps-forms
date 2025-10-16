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
  runTransaction,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useProfile } from "@/hooks/useProfile";

type Period = "all" | "30d" | "7d";

type IndexHint = {
  text: string;
  url: string;
};

// Szablony -> nazwy w archiwum
const TEMPLATE_MANDAT = "Bloczek mandatowy";
const TEMPLATE_LSEB = "Kontrola LSEB";
const TEMPLATE_ARESZT = "Protokół osadzenia / aresztowania";

// z jakich pól bierzemy kwoty do "przychodu"
function revenueFromArchive(a: any): number {
  try {
    const t = (a?.templateName || "") as string;
    const v = (a?.values || {}) as Record<string, any>;
    if (t === TEMPLATE_MANDAT) return Number(v.kwota || 0);
    if (t === TEMPLATE_ARESZT) return Number(v.grzywna || 0);
    // inne szablony z grzywną dopisuj tutaj:
    return 0;
  } catch {
    return 0;
  }
}

export default function AdminPage() {
  const { role, ready, login } = useProfile();

  // ------- UI state -------
  const [period, setPeriod] = useState<Period>("all");
  const [err, setErr] = useState<string | null>(null);
  const [indexHints, setIndexHints] = useState<IndexHint[]>([]);

  const [counts, setCounts] = useState({ mandaty: 0, lseb: 0, areszty: 0 });
  const [balance, setBalance] = useState<number>(0);

  // Finansowy formularz
  const [amount, setAmount] = useState<string>("");

  // Funkcjonariusze / statystyki osobowe
  const [officers, setOfficers] = useState<{ login: string; fullName?: string }[]>([]);
  const [officer, setOfficer] = useState<string>("");
  const [officerPeriod, setOfficerPeriod] = useState<Period>("all");
  const [officerStats, setOfficerStats] = useState({
    mandaty: 0,
    lseb: 0,
    areszty: 0,
    revenue: 0,
  });

  // reset licznika funkcjonariusza
  const [officerResetAt, setOfficerResetAt] = useState<Timestamp | null>(null);

  // ------- time boundary -------
  const tsFrom = useMemo(() => {
    if (period === "all") return null;
    const now = new Date();
    const days = period === "30d" ? 30 : 7;
    const d = new Date(now.getTime() - days * 86400 * 1000);
    return Timestamp.fromDate(d);
  }, [period]);

  const tsFromOfficer = useMemo(() => {
    if (officerPeriod === "all") return null;
    const now = new Date();
    const days = officerPeriod === "30d" ? 30 : 7;
    const d = new Date(now.getTime() - days * 86400 * 1000);
    return Timestamp.fromDate(d);
  }, [officerPeriod]);

  // ------- utils: bezpieczne pobieranie archiwów -------
  async function safeListArchives(filters: {
    templateName?: string;
    userLogin?: string;
    from?: Timestamp | null;
    order?: boolean;
  }) {
    const base = collection(db, "archives");
    try {
      // próbujemy „idealną” kwerendę (może wymagać indeksu)
      const qParts: any[] = [];
      if (filters.templateName) qParts.push(where("templateName", "==", filters.templateName));
      if (filters.userLogin) qParts.push(where("userLogin", "==", filters.userLogin));
      if (filters.from) qParts.push(where("createdAt", ">=", filters.from));
      if (filters.order) qParts.push(orderBy("createdAt", "desc"));
      const qIdeal = query(base, ...qParts);
      const snap = await getDocs(qIdeal);
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    } catch (e: any) {
      // Jeżeli to błąd braku indeksu — pokaż link i zrób fallback
      if (e?.code === "failed-precondition" && e?.message?.includes("create an index")) {
        const m = e.message.match(/https:\/\/console\.firebase\.google\.com\/v1\/r\/project\/[^ ]+/i);
        if (m) {
          setIndexHints((old) => {
            const already = old.find((x) => x.url === m[0]);
            return already ? old : [...old, { text: "Utwórz brakujący indeks", url: m[0] }];
          });
        }
      }
      // fallback: weź mniej selektywną kwerendę i przefiltruj w pamięci
      const qSimple = filters.userLogin
        ? query(base, where("userLogin", "==", filters.userLogin))
        : filters.templateName
        ? query(base, where("templateName", "==", filters.templateName))
        : base;

      const snap2 = await getDocs(qSimple);
      let rows = snap2.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      if (filters.from) rows = rows.filter((r) => r.createdAt && r.createdAt >= filters.from);
      // posortuj lokalnie po createdAt malejąco
      rows.sort((a, b) =>
        (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)
      );
      return rows;
    }
  }

  // ------- load headers: officers + balance -------
  useEffect(() => {
    if (!ready || role !== "director") return;

    (async () => {
      setErr(null);
      try {
        // Stan finansów
        const fSnap = await getDoc(doc(db, "finance", "state"));
        setBalance(Number(fSnap.data()?.balance || 0));

        // Lista funkcjonariuszy
        const pSnap = await getDocs(collection(db, "profiles"));
        const arr = pSnap.docs.map((d) => {
          const data = d.data() as any;
          return { login: data.login || "", fullName: data.fullName || "" };
        });
        // posortuj po fullName->login
        arr.sort((a, b) => (a.fullName || a.login).localeCompare(b.fullName || b.login));
        setOfficers(arr);
        if (!officer && arr.length) setOfficer(arr[0].login);

        // ResetAt dla domyślnego wybranego
        if (arr.length) {
          const rs = await getDoc(doc(db, "person_stats", arr[0].login));
          setOfficerResetAt((rs.data()?.resetAt as Timestamp) || null);
        }
      } catch (e: any) {
        setErr(e?.message || "Błąd odczytu nagłówków.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, role]);

  // ------- global stats -------
  useEffect(() => {
    if (!ready || role !== "director") return;

    (async () => {
      setErr(null);
      try {
        const [mand, lseb, arre] = await Promise.all([
          safeListArchives({ templateName: TEMPLATE_MANDAT, from: tsFrom, order: true }).then(
            (r) => r.length
          ),
          safeListArchives({ templateName: TEMPLATE_LSEB, from: tsFrom, order: true }).then(
            (r) => r.length
          ),
          safeListArchives({ templateName: TEMPLATE_ARESZT, from: tsFrom, order: true }).then(
            (r) => r.length
          ),
        ]);
        setCounts({ mandaty: mand, lseb, areszty: arre });
      } catch (e: any) {
        setErr(e?.message || "Błąd odczytu statystyk.");
      }
    })();
  }, [ready, role, tsFrom]);

  // ------- officer stats -------
  useEffect(() => {
    if (!ready || role !== "director" || !officer) return;

    (async () => {
      setErr(null);
      try {
        // pobierz resetAt
        const rs = await getDoc(doc(db, "person_stats", officer));
        const resetAt = (rs.data()?.resetAt as Timestamp) || null;
        setOfficerResetAt(resetAt);

        const from = tsFromOfficer && resetAt
          ? (tsFromOfficer.toMillis() > resetAt.toMillis() ? tsFromOfficer : resetAt)
          : (tsFromOfficer || resetAt || null);

        const rows = await safeListArchives({
          userLogin: officer,
          from,
          order: true,
        });

        const mand = rows.filter((r) => r.templateName === TEMPLATE_MANDAT).length;
        const lseb = rows.filter((r) => r.templateName === TEMPLATE_LSEB).length;
        const arre = rows.filter((r) => r.templateName === TEMPLATE_ARESZT).length;
        const rev = rows.reduce((sum, r) => sum + revenueFromArchive(r), 0);

        setOfficerStats({ mandaty: mand, lseb, areszty: arre, revenue: rev });
      } catch (e: any) {
        setErr(e?.message || "Błąd odczytu statystyk funkcjonariusza.");
      }
    })();
  }, [ready, role, officer, tsFromOfficer]);

  // ------- finanse -------
  async function deposit() {
    const val = Number(amount);
    if (!Number.isFinite(val) || val <= 0) return alert("Podaj prawidłową kwotę > 0");
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "finance", "state");
      const snap = await tx.get(ref);
      const cur = Number(snap.data()?.balance || 0);
      const next = cur + val;
      tx.set(ref, { balance: next }, { merge: true });
      await addDoc(collection(db, "finance", "state", "transactions"), {
        type: "deposit",
        amount: val,
        by: login,
        ts: serverTimestamp(),
      });
      await addDoc(collection(db, "logs"), {
        type: "finance_deposit",
        amount: val,
        by: login,
        ts: serverTimestamp(),
      });
      setBalance(next);
    });
    setAmount("");
  }

  async function withdraw(all = false) {
    const val = all ? balance : Number(amount);
    if (!Number.isFinite(val) || val <= 0) return alert("Podaj prawidłową kwotę > 0");
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "finance", "state");
      const snap = await tx.get(ref);
      const cur = Number(snap.data()?.balance || 0);
      const take = Math.min(cur, val);
      const next = cur - take;
      tx.set(ref, { balance: next }, { merge: true });
      await addDoc(collection(db, "finance", "state", "transactions"), {
        type: all ? "withdraw_all" : "withdraw",
        amount: take,
        by: login,
        ts: serverTimestamp(),
      });
      await addDoc(collection(db, "logs"), {
        type: all ? "finance_withdraw_all" : "finance_withdraw",
        amount: take,
        by: login,
        ts: serverTimestamp(),
      });
      setBalance(next);
    });
    setAmount("");
  }

  // ------- reset statystyk funkcjonariusza -------
  async function resetOfficerStats() {
    if (!officer) return;
    if (!confirm("Wyzerować licznik od teraz dla wybranego funkcjonariusza?")) return;
    await runTransaction(db, async (tx) => {
      tx.set(doc(db, "person_stats", officer), { resetAt: serverTimestamp() }, { merge: true });
    });
    await addDoc(collection(db, "logs"), {
      type: "person_reset_stats",
      login: officer,
      by: login,
      ts: serverTimestamp(),
    });
    // odśwież natychmiast
    const rs = await getDoc(doc(db, "person_stats", officer));
    setOfficerResetAt((rs.data()?.resetAt as Timestamp) || null);
  }

  // ------- widoki -------
  const Loading = (
    <div className="min-h-screen flex items-center justify-center">
      <div className="card p-6 text-center">Ładowanie…</div>
    </div>
  );

  const NoAccess = (
    <>
      <Head><title>DPS 77RP — Panel zarządu</title></Head>
      <Nav />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="card p-6 text-center">
          <h1 className="text-xl font-bold mb-2">Brak dostępu</h1>
          <p>Tylko <b>Director</b> może otworzyć Panel zarządu.</p>
        </div>
      </div>
    </>
  );

  const Content = (
    <>
      <Head><title>DPS 77RP — Panel zarządu</title></Head>
      <Nav />
      <div className="max-w-6xl mx-auto px-4 py-6 grid gap-6">
        {/* indeksy */}
        {indexHints.length > 0 && (
          <div className="card p-3 text-sm text-red-700">
            <div className="font-semibold mb-1">Brakuje indeksów dla Firestore (aplikacja działa w trybie awaryjnym). Kliknij, aby utworzyć:</div>
            <ul className="list-disc pl-5 space-y-1">
              {indexHints.map((h, i) => (
                <li key={i}>
                  <a className="underline" href={h.url} target="_blank" rel="noreferrer">{h.text}</a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {err && <div className="card p-3 text-red-700">{err}</div>}

        {/* nagłówek */}
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Panel zarządu</h1>
          <span className="text-sm text-beige-700">Zalogowany: {login}</span>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-sm">Okres:</label>
            <select className="input" value={period} onChange={(e)=>setPeriod(e.target.value as Period)}>
              <option value="all">Od początku</option>
              <option value="30d">Ostatnie 30 dni</option>
              <option value="7d">Ostatnie 7 dni</option>
            </select>
          </div>
        </div>

        {/* statystyki globalne */}
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

        {/* finanse */}
        <div className="card p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-beige-700">Stan konta DPS</div>
              <div className="text-3xl font-bold">${balance.toFixed(2)}</div>
            </div>
            <div className="flex items-center gap-2">
              <input
                className="input w-40"
                placeholder="Kwota (USD)"
                value={amount}
                onChange={(e)=>setAmount(e.target.value)}
              />
              <button className="btn" onClick={deposit}>Wpłać</button>
              <button className="btn" onClick={()=>withdraw(false)}>Wypłać</button>
              <button className="btn bg-red-700 text-white" onClick={()=>withdraw(true)}>Wypłać wszystko</button>
            </div>
          </div>
        </div>

        {/* statystyki funkcjonariusza */}
        <div className="card p-4 grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm">Funkcjonariusz:</span>
              <select className="input" value={officer} onChange={(e)=>setOfficer(e.target.value)}>
                {officers.map(o => (
                  <option key={o.login} value={o.login}>
                    {(o.fullName || o.login) + ` [${o.login}]`}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">Okres:</span>
              <select className="input" value={officerPeriod} onChange={(e)=>setOfficerPeriod(e.target.value as Period)}>
                <option value="all">Cały okres</option>
                <option value="30d">Ostatnie 30 dni</option>
                <option value="7d">Ostatnie 7 dni</option>
              </select>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button className="btn bg-red-700 text-white" onClick={resetOfficerStats}>
                Wyzeruj licznik tego funkcjonariusza
              </button>
              {officerResetAt && (
                <span className="text-xs text-beige-700">
                  Liczymy od: {new Date(officerResetAt.toMillis()).toLocaleString()}
                </span>
              )}
            </div>
          </div>

          <div className="grid md:grid-cols-4 gap-4">
            <div className="card p-4">
              <div className="text-sm text-beige-700">Mandaty</div>
              <div className="text-2xl font-bold">{officerStats.mandaty}</div>
            </div>
            <div className="card p-4">
              <div className="text-sm text-beige-700">Kontrole LSEB</div>
              <div className="text-2xl font-bold">{officerStats.lseb}</div>
            </div>
            <div className="card p-4">
              <div className="text-sm text-beige-700">Areszty</div>
              <div className="text-2xl font-bold">{officerStats.areszty}</div>
            </div>
            <div className="card p-4">
              <div className="text-sm text-beige-700">Przychód dla DPS</div>
              <div className="text-2xl font-bold">${officerStats.revenue.toFixed(2)}</div>
            </div>
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
