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
} from "firebase/firestore";
import { db } from "@/lib/firebase";

type Range = "all" | "30" | "7";

export default function Admin() {
  const { role, login, ready } = useProfile();
  const [range, setRange] = useState<Range>("all");

  const [err, setErr] = useState<string | null>(null);
  const [mandaty, setMandaty] = useState(0);
  const [lseb, setLseb] = useState(0);
  const [areszty, setAreszty] = useState(0);

  // Finanse
  const [finesTotal, setFinesTotal] = useState(0);
  const [manualAdj, setManualAdj] = useState(0);
  const displayBalance = (finesTotal + manualAdj);

  // Personel
  const [people, setPeople] = useState<{ uid: string; fullName?: string; login?: string; statsResetAt?: any }[]>([]);
  const [person, setPerson] = useState<string>("");
  const [pStats, setPStats] = useState({ m: 0, k: 0, a: 0, income: 0 });
  const [amount, setAmount] = useState<string>("");

  // od kiedy (zakres)
  const since: Timestamp | null = useMemo(() => {
    if (range === "all") return null;
    const days = range === "30" ? 30 : 7;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return Timestamp.fromDate(d);
  }, [range]);

  const archivesCol = collection(db, "archives");

  // Liczenie globalne (z fallbackiem bez indeksów)
  const countBy = async (slug: string, sinceTs: Timestamp | null) => {
    try {
      const parts = [where("templateSlug", "==", slug)];
      if (sinceTs) parts.push(where("createdAt", ">=", sinceTs));
      const qMain = query(archivesCol, ...parts);
      const cnt = await getCountFromServer(qMain);
      return cnt.data().count;
    } catch {
      const snap = await getDocs(query(archivesCol, where("templateSlug", "==", slug)));
      return snap.docs.filter((d) => {
        if (!sinceTs) return true;
        const ts: any = d.data().createdAt;
        const date = ts?.toDate?.() || null;
        return date ? date >= sinceTs.toDate() : false;
      }).length;
    }
  };

  // Liczenie dla wybranego funkcjonariusza (od effectiveSince = max(since, statsResetAt))
  const countByOwner = async (slug: string, ownerLogin: string, effectiveSince: Timestamp | null) => {
    try {
      const parts = [where("templateSlug", "==", slug), where("userLogin", "==", ownerLogin)];
      if (effectiveSince) parts.push(where("createdAt", ">=", effectiveSince));
      const qMain = query(archivesCol, ...parts);
      const cnt = await getCountFromServer(qMain);
      return cnt.data().count;
    } catch {
      const snap = await getDocs(query(archivesCol, where("templateSlug", "==", slug)));
      return snap.docs.filter((d) => {
        const data: any = d.data();
        if ((data.userLogin || "").toLowerCase() !== ownerLogin) return false;
        if (!effectiveSince) return true;
        const date = data.createdAt?.toDate?.() || null;
        return !!date && date >= effectiveSince.toDate();
      }).length;
    }
  };

  // Suma kwot (mandaty + areszty) – BEZ zakresu (od początku)
  const calcFinesTotal = async () => {
    let sum = 0;
    const addFrom = async (slug: string) => {
      const snap = await getDocs(query(archivesCol, where("templateSlug", "==", slug)));
      snap.docs.forEach((d) => {
        const data: any = d.data();
        const num = Number((data.values || {}).kwota || 0);
        if (!Number.isNaN(num)) sum += num;
      });
    };
    await addFrom("bloczek-mandatowy");
    await addFrom("protokol-aresztowania");
    setFinesTotal(sum);
  };

  // Load global + people + manualAdj
  useEffect(() => {
    if (!ready || role !== "director") return;
    (async () => {
      try {
        setErr(null);

        // Globalne liczniki wg zakresu
        setMandaty(await countBy("bloczek-mandatowy", since));
        setLseb(await countBy("kontrola-lseb", since));
        setAreszty(await countBy("protokol-aresztowania", since));

        // Finanse: manualAdj + finesTotal
        const accRef = doc(db, "accounts", "dps");
        const accSnap = await getDoc(accRef);
        setManualAdj(Number(accSnap.data()?.manualAdj || 0));
        await calcFinesTotal();

        // Personel
        const ps = await getDocs(collection(db, "profiles"));
        const arr = ps.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
        setPeople(arr);
        if (!person && arr.length) setPerson(arr[0].uid);
      } catch (e: any) {
        setErr(e?.message || "Błąd pobierania danych");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, role, since]);

  // Statystyki personelu (z resetem)
  useEffect(() => {
    if (!ready || role !== "director" || !person) return;
    (async () => {
      try {
        setErr(null);
        const p = people.find((x) => x.uid === person);
        const personLogin = (p?.login || "").toLowerCase();
        const resetAt: Timestamp | null = p?.statsResetAt || null;
        const effectiveSince =
          since && resetAt ? (since.toDate() > resetAt.toDate() ? since : resetAt) :
          (since || resetAt || null);

        const m = await countByOwner("bloczek-mandatowy", personLogin, effectiveSince);
        const k = await countByOwner("kontrola-lseb", personLogin, effectiveSince);
        const a = await countByOwner("protokol-aresztowania", personLogin, effectiveSince);

        // przychód tego funkcjonariusza od effectiveSince
        let income = 0;
        const pull = async () => {
          const qs = await getDocs(query(archivesCol, where("userLogin", "==", personLogin)));
          qs.docs.forEach((d) => {
            const data: any = d.data();
            if (!["bloczek-mandatowy", "protokol-aresztowania"].includes(data.templateSlug)) return;
            if (effectiveSince) {
              const date = data.createdAt?.toDate?.() || null;
              if (!date || date < effectiveSince.toDate()) return;
            }
            const val = Number((data.values || {}).kwota || 0);
            if (!Number.isNaN(val)) income += val;
          });
        };
        await pull();

       
