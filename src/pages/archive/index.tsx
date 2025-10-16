import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, writeBatch } from "firebase/firestore";
import { useProfile, can } from "@/hooks/useProfile";

type Archive = {
  id: string;
  templateName: string;
  templateSlug?: string;
  userLogin?: string;
  imageUrl?: string;
  dossierId?: string | null;
  createdAt?: any;
  officers?: string[];
};

export default function ArchivePage() {
  const { role, login } = useProfile();
  const [items, setItems] = useState<Archive[]>([]);
  const [qtxt, setQ] = useState("");
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const qa = query(collection(db, "archives"), orderBy("createdAt", "desc"));
        const sa = await getDocs(qa);
        setItems(sa.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      } catch (e) {
        console.error(e);
        alert("Brak uprawnień lub błąd wczytania archiwum.");
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const l = qtxt.toLowerCase();
    return items.filter(i =>
      (i.templateName || "").toLowerCase().includes(l) ||
      (i.userLogin || "").toLowerCase().includes(l) ||
      (i.officers || []).join(", ").toLowerCase().includes(l)
    );
  }, [items, qtxt]);

  const remove = async (id: string) => {
    if (!can.deleteArchive(role)) return alert("Brak uprawnień.");
    if (!confirm("Usunąć wpis z archiwum?")) return;
    await deleteDoc(doc(db, "archives", id));
    await addDoc(collection(db, "logs"), { type: "archive_delete", id, by: login, ts: serverTimestamp() });
    setItems(prev => prev.filter(x => x.id !== id));
  };

  const clearAll = async () => {
    if (!can.deleteArchive(role)) return alert("Brak uprawnień.");
    if (!confirm("Na pewno chcesz usunąć całe archiwum?")) return;
    try {
      setClearing(true);
      const snap = await getDocs(collection(db, "archives"));
      let batch = writeBatch(db);
      const commits: Promise<void>[] = [];
      let counter = 0;
      snap.docs.forEach((docSnap, idx) => {
        batch.delete(docSnap.ref);
        counter += 1;
        if (counter === 400 || idx === snap.docs.length - 1) {
          commits.push(batch.commit());
          batch = writeBatch(db);
          counter = 0;
        }
      });
      await Promise.all(commits);
      await addDoc(collection(db, "logs"), {
        type: "archive_clear",
        by: login,
        removed: snap.size,
        ts: serverTimestamp(),
      });
      setItems([]);
    } catch (e) {
      console.error(e);
      alert("Nie udało się wyczyścić archiwum.");
    } finally {
      setClearing(false);
    }
  };


  if (!can.seeArchive(role)) {
    return (
      <AuthGate>
        <>
          <Head><title>DPS 77RP — Archiwum</title></Head>
          <Nav />
          <div className="max-w-4xl mx-auto px-4 py-10">
            <div className="card p-6 text-center">Brak dostępu do archiwum.</div>
          </div>
        </>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <>
        <Head><title>DPS 77RP — Archiwum</title></Head>
        <Nav />
        <div className="max-w-6xl mx-auto px-4 py-6 grid gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">Archiwum</h1>
            <div className="ml-auto flex items-center gap-2">
              <input className="input w-[220px] sm:w-[280px]" placeholder="Szukaj..." value={qtxt} onChange={e=>setQ(e.target.value)} />
              {can.deleteArchive(role) && (
                <button className="btn bg-red-700 text-white" onClick={clearAll} disabled={clearing}>
                  {clearing ? "Czyszczenie..." : "Wyczyść archiwum"}
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-2">
            {filtered.map(it => (
              <div key={it.id} className="card p-4 grid md:grid-cols-[1fr_auto] gap-3">
                <div>
                  <div className="font-semibold">{it.templateName}</div>
                  <div className="text-sm text-beige-700">
                    Autor (login): {it.userLogin || "—"} • Funkcjonariusze: {(it.officers || []).join(", ") || "—"}
                  </div>
                  <div className="text-sm text-beige-700">
                    {it.createdAt?.toDate ? it.createdAt.toDate().toLocaleString() : "—"}
                    {it.dossierId && <> • <a className="underline" href={`/dossiers/${it.dossierId}`}>Zobacz teczkę</a></>}
                  </div>
                  {it.imageUrl && <div className="mt-1"><a className="text-blue-700 underline" href={it.imageUrl} target="_blank">Otwórz obraz</a></div>}
                </div>
                <div className="flex items-center justify-end gap-2">
                  {can.deleteArchive(role) && (
                    <button className="btn bg-red-700 text-white" onClick={()=>remove(it.id)}>Usuń</button>
                  )}
                </div>
              </div>
            ))}
            {filtered.length === 0 && <p>Brak wpisów.</p>}
          </div>
        </div>
      </>
    </AuthGate>
  );
}
