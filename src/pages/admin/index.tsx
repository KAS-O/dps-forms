import Head from "next/head";
import Nav from "@/components/Nav";
import AuthGate from "@/components/AuthGate";
import { useProfile } from "@/hooks/useProfile";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  query,
  where,
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

// <<< JEŚLI WOLISZ MIEĆ KOLEKCJĘ "finance", ZMIEŃ TUTAJ >>>
const ACCOUNTS_COLL = "accounts";

// stałe slugów z templates.ts
const SLUG_FINE = "bloczek-mandatowy";
const SLUG_LSEB = "kontrola-lseb";
const SLUG_ARREST = "protokol-aresztowania";

export default function Admin() {
  const { role, login, ready } = useProfile();

  const [range, setRange] = useState<Range>("all");
  const [err, setErr] = useState<string | null>(null);

  const [mandaty, setMandaty] = useState(0);
  const [lseb, setLseb] = useState(0);
  const [areszty, setAreszty] = useState(0);

  const [balance, setBalance] = useState(0);

  const [people, setPeople] = useState<{ uid: string; displayName?: string; login?: string }[]>([]);
  const [person, setPerson] = useState<string>("");
  const [pStats, setPStats] = useState({ m: 0, k: 0, a: 0, income: 0 });

  const [amount, setAmount] = useState<string>("");

  // od kiedy (30/7 dni)
  const since: Timestamp | null = useMemo(() => {
    if (range === "all") return null;
    const days = range === "30" ? 30 : 7;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return Timestamp.fromDate(d);
  }, [range]);

  // ======= POBIERANIE DANYCH GLOBALNYCH =======
  useEffect(() => {
    if (!ready) return;
    if (role !== "director") return;

    (async () => {
      try {
        setErr(null);

        const base = collection(db, "archives");
        const time = since ? [where("createdAt", ">=", since)] : [];

        // globalne liczniki po SLUGU
        setMandaty((await getCountFromServer(query(base, where("templateSlug", "==", SLUG_FINE), ...time))).data().count);
        setLseb((await getCountFromServer(query(base, where("templateSlug", "==", SLUG_LSEB), ...time))).data().count);
        setAreszty((await getCountFromServer(query(base, where("templateSlug", "==", SLUG_ARREST), ...time))).data().count);

        // saldo DPS
        const accRef = doc(db, ACCOUNTS_COLL, "dps");
        const accSnap = await getDoc(accRef);
        setBalance((accSnap.data()?.balance || 0) as number);

        // lista funkcjonariuszy (z profiles)
        const ps = await getDocs(collection(db, "profiles"));
        const arr = ps.docs.map(d => ({ uid: d.id, ...(d.data() as any) }));
        setPeople(arr);
        if (!person && arr.length) setPerson(arr[0].uid);
      } catch (e: any) {
        setErr(e?.message || "Błąd pobierania danych");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, role, since]);

  // ======= STATYSTYKI FUNKCJONARIUSZA =======
  useEffect(() => {
    if (!ready || role !== "director" || !person) return;

    (async () => {
      try {
        setErr(null);
        const base = collection(db, "archives");
        const time = since ? [where("createdAt", ">=", since)] : [];

        // preferuj ownerUid (unikamy problemów z wielkością liter loginu)
        const ownerUid = where("ownerUid", "==", person);
        const loginStr = (people.find(p => p.uid === person)?.login || "").toLowerCase();
        const ownerLogin = where("userLogin", "==", loginStr);

        const qM1 = query(base, where("templateSlug", "==", SLUG_FINE), ownerUid, ...time);
        const qK1 = query(base, where("templateSlug", "==", SLUG_LSEB), ownerUid, ...time);
        const qA1 = query(base, where("templateSlug", "==", SLUG_ARREST), ownerUid, ...time);

        let m = (await getCountFromServer(qM1)).data().count;
        let k = (await getCountFromServer(qK1)).data().count;
        let a = (await getCountFromServer(qA1)).data().count;

        // fallback po userLogin (dla starych wpisów bez ownerUid)
        if (m + k + a === 0 && loginStr) {
          const qM2 = query(base, where("templateSlug", "==", SLUG_FINE), ownerLogin, ...time);
          const qK2 = query(base, where("templateSlug", "==", SLUG_LSEB), ownerLogin, ...time);
          const qA2 = query(base, where("templateSlug", "==", SLUG_ARREST), ownerLogin, ...time);
          m = (await getCountFromServer(qM2)).data().count;
          k = (await getCountFromServer(qK2)).data().count;
          a = (await getCountFromServer(qA2)).data().count;
        }

        // przychód z mandatów (sumujemy kwotę z values.kwota lub z pola amount)
        let income = 0;
        const qDocs = query(base, where("templateSlug", "==", SLUG_FINE), ownerUid, ...time);
        const snap = await getDocs(qDocs);
        if (snap.empty && loginStr) {
          const qDocs2 = query(base, where("templateSlug", "==", SLUG_FINE), ownerLogin, ...time);
          const snap2 = await getDocs(qDocs2);
          snap2.docs.forEach(d => {
            const data = d.data() as any;
            const val = Number(data.amount ?? data.values?.kwota ?? 0);
            if (!Number.isNaN(val)) income += val;
          });
        } else {
          snap.docs.forEach(d => {
            const data = d.data() as any;
            const val = Number(data.amount ?? data.values?.kwota ?? 0);
            if (!Number.isNaN(val)) income += val;
          });
        }

        setPStats({ m, k, a, income });
      } catch (e: any) {
        setErr(e?.message || "Błąd statystyk personelu");
      }
    })();
  }, [ready, role, person, since, people]);

  // ======= OPERACJE NA KONCIE =======
  const deposit = async (v: number) => {
    if (!Number.isFinite(v) || v <= 0) return;
    const ref = doc(db, ACCOUNTS_COLL, "dps");
    await setDoc(ref, { balance: 0, createdAt: serverTimestamp() }, { merge: true });
    await updateDoc(ref, { balance: increment(v) });
  };
  const withdraw = async (v: number) => {
    if (!Number.isFinite(v) || v <= 0) return;
    const ref = doc(db, ACCOUNTS_COLL, "dps");
    await updateDoc(ref, { balance: increment(-v) });
  };
  const withdrawAll = async () => {
    const ref = doc(db, ACCOUNTS_COLL, "dps");
    const snap = await getDoc(ref);
    const bal = (snap.data()?.balance || 0) as number;
    if (bal > 0) await updateDoc(ref, { balance: increment(-bal) });
  };

  // ======= UI =======
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

  const personName = people.find(p => p.uid === person)?.displayName || people.find(p => p.uid === person)?.login || "(brak)";

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
          <div className="flex items-center gap-2">
            <input
              className="input w-40"
              placeholder="Kwota (USD)"
              value={amount}
              onChange={e=>setAmount(e.target.value)}
            />
            <button className="btn" onClick={async ()=>{
              try {
                await deposit(Number(amount));
                setAmount("");
                const snap = await getDoc(doc(db, ACCOUNTS_COLL, "dps"));
                setBalance((snap.data()?.balance || 0) as number);
              } catch (e:any) { setErr(e?.message || "Błąd wpłaty"); }
            }}>Wpłać</button>
            <button className="btn" onClick={async ()=>{
              try {
                await withdraw(Number(amount));
                setAmount("");
                const snap = await getDoc(doc(db, ACCOUNTS_COLL, "dps"));
                setBalance((snap.data()?.balance || 0) as number);
              } catch (e:any) { setErr(e?.message || "Błąd wypłaty"); }
            }}>Wypłać</button>
            <button className="btn bg-red-700 text-white" onClick={async ()=>{
              try {
                if (confirm("Na pewno wypłacić wszystko?")) {
                  await withdrawAll();
                  const snap = await getDoc(doc(db, ACCOUNTS_COLL, "dps"));
                  setBalance((snap.data()?.balance || 0) as number);
                }
              } catch (e:any) { setErr(e?.message || "Błąd wypłaty wszystkiego"); }
            }}>Wypłać wszystko</button>
          </div>
        </div>

        {/* Personel */}
        <div className="card p-4 grid gap-3">
          <div className="flex items-center gap-2">
            <span>Funkcjonariusz:</span>
            <select className="input w-64" value={person} onChange={e=>setPerson(e.target.value)}>
              {people.map(p=><option key={p.uid} value={p.uid}>{p.displayName || p.login || p.uid}</option>)}
            </select>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm">Okres:</span>
              <select className="input" value={range} onChange={e=>setRange(e.target.value as Range)}>
                <option value="all">Cały okres</option>
                <option value="30">30 dni</option>
                <option value="7">7 dni</option>
              </select>
            </div>
            <button
              className="btn bg-red-700 text-white"
              onClick={()=>{
                alert("Reset liczników w tej wersji jest logiczny (nie usuwa archiwum). Jeśli chcesz, mogę dopisać osobną kolekcję 'resets' i odejmować wyniki od aktualnej sumy.");
              }}
            >
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
