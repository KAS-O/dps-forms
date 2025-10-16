import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, onSnapshot, orderBy, query, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export default function Dossiers() {
  const [list, setList] = useState<any[]>([]);
  const [qtxt, setQ] = useState("");
  const [form, setForm] = useState({ first: "", last: "", cid: "" });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, "dossiers"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => setList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))));
  }, []);

  const filtered = useMemo(() => {
    const l = qtxt.toLowerCase();
    return list.filter(x =>
      (x.first||"").toLowerCase().includes(l) ||
      (x.last||"").toLowerCase().includes(l) ||
      (x.cid||"").toLowerCase().includes(l) ||
      (x.title||"").toLowerCase().includes(l)
    );
  }, [qtxt, list]);

  const create = async () => {
    try {
      setErr(null);
      const first = form.first.trim();
      const last  = form.last.trim();
      const cid   = form.cid.trim();
      if (!first || !last || !cid) {
        setErr("Uzupełnij imię, nazwisko i CID.");
        return;
      }
      const title = `Akta ${first} ${last} CID:${cid}`;
      await addDoc(collection(db, "dossiers"), {
        first, last, cid, title,
        createdAt: serverTimestamp(),
      });
      setForm({ first: "", last: "", cid: "" });
    } catch (e: any) {
      setErr(e?.message || "Nie udało się utworzyć teczki");
    }
  };

  return (
    <AuthGate>
      <>
        <Head><title>DPS 77RP — Teczki</title></Head>
        <Nav />
        <div className="max-w-5xl mx-auto px-4 py-6 grid gap-6">
          <div className="card p-4">
            <h1 className="text-xl font-bold mb-2">Teczki dowodowe</h1>
            <div className="flex gap-2 mb-3">
              <input className="input flex-1" placeholder="Szukaj po imieniu/nazwisku/CID..." value={qtxt} onChange={e=>setQ(e.target.value)} />
            </div>
            {err && <div className="card p-3 bg-red-50 text-red-700 mb-3">{err}</div>}
            <div className="grid gap-2">
              {filtered.map(d => (
                <a key={d.id} className="card p-3 hover:shadow" href={`/dossiers/${d.id}`}>
                  <div className="font-semibold">{d.title}</div>
                  <div className="text-sm text-beige-700">CID: {d.cid}</div>
                </a>
              ))}
              {filtered.length===0 && <p>Brak teczek.</p>}
            </div>
          </div>

          <div className="card p-4">
            <h2 className="font-semibold mb-2">Załóż nową teczkę</h2>
            <div className="grid md:grid-cols-3 gap-2">
              <input className="input" placeholder="Imię" value={form.first} onChange={e=>setForm({...form, first:e.target.value})}/>
              <input className="input" placeholder="Nazwisko" value={form.last} onChange={e=>setForm({...form, last:e.target.value})}/>
              <input className="input" placeholder="CID" value={form.cid} onChange={e=>setForm({...form, cid:e.target.value})}/>
            </div>
            <button className="btn mt-3" onClick={create}>Utwórz</button>
          </div>
        </div>
      </>
    </AuthGate>
  );
}
