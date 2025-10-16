import Head from "next/head";
import Nav from "@/components/Nav";
import AuthGate from "@/components/AuthGate";
import { useProfile } from "@/hooks/useProfile";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  getCountFromServer,
  getDoc,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  increment,
  Timestamp,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

type Range = "all" | "30" | "7";
type Person = { uid: string; fullName?: string; login?: string };

export default function Admin() {
  const { role, login, ready } = useProfile();

  const [range, setRange] = useState<Range>("all");
  const [err, setErr] = useState<string | null>(null);

  // ogólne
  const [mandaty, setMandaty] = useState(0);
  const [lseb, setLseb] = useState(0);
  const [areszty, setAreszty] = useState(0);

  // saldo
  const [baseTotal, setBaseTotal] = useState(0);
  const [manualDelta, setManualDelta] = useState(0);
  const balance = useMemo(() => baseTotal + manualDelta, [baseTotal, manualDelta]);

  // personel
  const [people, setPeople] = useState<Person[]>([]);
  const [person, setPerson] = useState<string>(""); // uid
  const [pStats, setPStats] = useState({ m: 0, k: 0, a: 0, income: 0 });

  // okres
  const since: Timestamp | null = useMemo(() => {
    if (range === "all") return null;
    const days = range === "30" ? 30 : 7;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return Timestamp.fromDate(d);
  }, [range]);

  // które szablony mają kary pieniężne
  const FINE_TEMPLATES: { name: string; field: string }[] = [
    { name: "Bloczek mandatowy", field: "kwota" },
    { name: "Protokół aresztowania", field: "grzywna" },
  ];

  // ===== ogólne + saldo + personel
  const recalcAll = async () => {
    try {
      setErr(null);

      const archives = collection(db, "archives");
      const time = since ? [where("createdAt", ">=", since)] : [];

      // ogólne liczniki
      const qM = query(archives, where("templateName", "==", "Bloczek mandatowy"), ...time);
      const qK = query(archives, where("templateName", "==", "Kontrola LSEB"), ...time);
      const qA = query(archives, where("templateName", "==", "Protokół aresztowania"), ...time);

      setMandaty((await getCountFromServer(qM)).data().count);
      setLseb((await getCountFromServer(qK)).data().count);
      setAreszty((await getCountFromServer(qA)).data().count);

      // suma kar z archiwum
      let base = 0;
      for (const t of FINE_TEMPLATES) {
        const qF = query(archives, where("templateName", "==", t.name), ...time);
        const sF = await getDocs(qF);
        sF.docs.forEach((d) => {
          const val = (d.data()?.values || {}) as any;
          const n = Number(val[t.field] || 0);
          if (!Number.isNaN(n)) base += n;
        });
      }
      setBaseTotal(base);

      // manualDelta
      const accRef = doc(db, "accounts", "dps");
      const accSnap = await getDoc(accRef);
      setManualDelta(Number(accSnap.data()?.manualDelta || 0));

      // lista funkcjonariuszy
      const ps = await getDocs(collection(db, "profiles"));
      const arr = ps.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
      setPeople(arr);
      if (!person && arr.length) setPerson(arr[0].uid);
    } catch (e: any) {
      setErr(e?.message || "Błąd pobierania danych");
    }
  };

  // ===== statystyki personalne (po UID)
  const recalcPerson = async () => {
    if (!person) return;
    try {
      setErr(null);

      // efektywny start: max(since, lastResetAt)
      const resetRef = doc(db, "profiles", person, "counters", "personal");
      const rSnap = await getDoc(resetRef);
      const lastResetAt = (rSnap.data()?.lastResetAt || null) as Timestamp | null;
      const effSince =
        since && lastResetAt
          ? (since.toMillis() > lastResetAt.toMillis() ? since : lastResetAt)
          : since || lastResetAt || null;

      const archives = collection(db, "archives");
      const snap = await getDocs(query(archives, where("officersUid", "array-contains", person)));

      const cutoff = effSince ? effSince.toMillis() : null;
      let m = 0;
      let k = 0;
      let a = 0;
      let income = 0;

      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() as any;
        const createdAt: Timestamp | null = (data?.createdAt as Timestamp) || null;
        if (cutoff) {
          if (!createdAt) return;
          if (createdAt.toMillis() < cutoff) return;
        }

        const template = data?.templateName as string | undefined;
        if (template === "Bloczek mandatowy") {
          m += 1;
          const val = (data?.values || {}) as any;
          const n = Number(val.kwota || 0);
          if (!Number.isNaN(n)) income += n;
        } else if (template === "Kontrola LSEB") {
          k += 1;
        } else if (template === "Protokół aresztowania") {
          a += 1;
          const val = (data?.values || {}) as any;
          const n = Number(val.grzywna || 0);
          if (!Number.isNaN(n)) income += n;
        }
      });

      setPStats({ m, k, a, income });
    } catch (e: any) {
      setErr(e?.message || "Błąd statystyk personelu");
    }
  };

  // lifecycle
  useEffect(() => {
    if (!ready || role !== "director") return;
    recalcAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, role, since]);

  useEffect(() => {
    if (!ready || role !== "director" || !person) return;
    recalcPerson();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, role, person, since, people]);

  // operacje finansowe
  const deposit = async (v: number) => {
    if (v <= 0) return;
    const ref = doc(db, "accounts", "dps");
    await setDoc(ref, { manualDelta: 0, createdAt: serverTimestamp() }, { merge: true });
    await updateDoc(ref, { manualDelta: increment(v) });
    await recalcAll();
  };
  const withdraw = async (v: number) => {
    if (v <= 0) return;
    const ref = doc(db, "accounts", "dps");
    await setDoc(ref, { manualDelta: 0, createdAt: serverTimestamp() }, { merge: true });
    await updateDoc(ref, { manualDelta: increment(-v) });
    await recalcAll();
  };
  const withdrawAll = async () => {
    const ref = doc(db, "accounts", "dps");
    await setDoc(ref, { manualDelta: 0, createdAt: serverTimestamp() }, { merge: true });
    await updateDoc(ref, { manualDelta: -baseTotal });
    await recalcAll();
  };

  const resetPerson = async () => {
    if (!person) return;
    const p = people.find((x) => x.uid === person);
    const label = p?.fullName || p?.login || person;
    if (!confirm(`Wyzerować licznik dla ${label}? (nie wpływa na ogólne)`)) return;
    await setDoc(doc(db, "profiles", person, "counters", "personal"), { lastResetAt: serverTimestamp() }, { merge: true });
    await recalcPerson();
  };

  // UI
  if (!ready) {
    return (
      <AuthGate>
        <Head><title>DPS 77RP — Panel zarządu</title></Head>
        <Nav />
        <div className="max-w-6xl mx-auto px-4 py-8"><div className="card p-6">Ładowanie…</div></div>
      </AuthGate>
    );
  }
  if (role !== "director") {
    return (
      <AuthGate>
        <Head><title>DPS 77RP — Panel zarządu</title></Head>
        <Nav />
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="card p-6 text-center">Brak dostępu. Tylko <b>Director</b> może otworzyć Panel zarządu.</div>
        </div>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <Head><title>DPS 77RP — Panel zarządu</title></Head>
      <Nav />

      <div className="max-w-6xl mx-auto px-4 py-6 grid gap-4">
        {err && <div className="card p-3 bg-red-50 text-red-700">{err}</div>}

        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">Panel zarządu</h1>
          <span className="text-sm text-beige-700">Zalogowany: {login}</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm">Okres:</span>
            <select className="input" value={range} onChange={e=>setRange(e.target.value as Range)}>
              <option value="all">Od początku</option>
              <option value="30">Ostatnie 30 dni</option>
              <option value="7">Ostatnie 7 dni</option>
            </select>
          </div>
        </div>

        {/* Kafle globalne */}
        <div className="grid md:grid-cols-3 gap-4">
          <div className="card p-4">
            <div className="text-sm text-beige-700">Liczba mandatów</div>
            <div className="text-2xl font-bold">{mandaty}</div>
          </div>
          <div className="card p-4">
            <div className="text-sm text-beige-700">Kontrole LSEB</div>
            <div className="text-2xl font-bold">{lseb}</div>
          </div>
          <div className="card p-4">
            <div className="text-sm text-beige-700">Areszty</div>
            <div className="text-2xl font-bold">{areszty}</div>
          </div>
        </div>

        {/* Finanse */}
        <div className="card p-4 grid gap-3">
          <div className="text-sm text-beige-700">Stan konta DPS</div>
          <div className="text-3xl font-bold">${balance.toFixed(2)}</div>
          <div className="text-xs text-beige-700">
            (Z archiwum: ${baseTotal.toFixed(2)} + ręczne operacje: ${manualDelta.toFixed(2)})
          </div>
          <div className="flex items-center gap-2">
            <input id="kw" className="input w-40" placeholder="Kwota (USD)" />
            <button className="btn" onClick={()=>{
              const v = Number((document.getElementById("kw") as HTMLInputElement)?.value || 0);
              deposit(v).catch(e=>setErr(e.message));
            }}>Wpłać</button>
            <button className="btn" onClick={()=>{
              const v = Number((document.getElementById("kw") as HTMLInputElement)?.value || 0);
              withdraw(v).catch(e=>setErr(e.message));
            }}>Wypłać</button>
            <button className="btn bg-red-700 text-white" onClick={()=>{
              if (confirm("Na pewno wypłacić wszystko?")) withdrawAll().catch(e=>setErr(e.message));
            }}>Wypłać wszystko</button>
          </div>
        </div>

        {/* Personel */}
        <div className="card p-4 grid gap-3">
          <div className="flex items-center gap-2">
            <span>Funkcjonariusz:</span>
            <select className="input w-64" value={person} onChange={e=>setPerson(e.target.value)}>
              {people.map(p=>(
                <option key={p.uid} value={p.uid}>{p.fullName || p.login || p.uid}</option>
              ))}
            </select>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm">Okres:</span>
              <select className="input" value={range} onChange={e=>setRange(e.target.value as Range)}>
                <option value="all">Cały okres</option>
                <option value="30">30 dni</option>
                <option value="7">7 dni</option>
              </select>
            </div>
            <button className="btn bg-red-700 text-white" onClick={resetPerson}>
              Wyzeruj licznik tego funkcjonariusza
            </button>
          </div>

          <div className="grid md:grid-cols-4 gap-4">
            <div className="card p-3">
              <div className="text-sm text-beige-700">Mandaty</div>
              <div className="text-2xl font-bold">{pStats.m}</div>
            </div>
            <div className="card p-3">
              <div className="text-sm text-beige-700">Kontrole LSEB</div>
              <div className="text-2xl font-bold">{pStats.k}</div>
            </div>
            <div className="card p-3">
              <div className="text-sm text-beige-700">Areszty</div>
              <div className="text-2xl font-bold">{pStats.a}</div>
            </div>
            <div className="card p-3">
              <div className="text-sm text-beige-700">Przychód dla DPS</div>
              <div className="text-2xl font-bold">${pStats.income.toFixed(2)}</div>
            </div>
          </div>
        </div>
      </div>
    </AuthGate>
  );
}
