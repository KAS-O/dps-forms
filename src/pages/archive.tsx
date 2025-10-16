import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { deleteObject, ref } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { useProfile, can } from "@/hooks/useProfile";

type ArchiveItem = {
  id: string;
  templateName: string;
  userLogin: string;
  createdAt?: any;
  imagePath: string;
  imageUrl: string;
};

export default function ArchivePage() {
  const { role } = useProfile();
  const [items, setItems] = useState<ArchiveItem[]>([]);

  useEffect(() => {
    const q = query(collection(db, "archives"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setItems(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
  }, []);

  const remove = async (id: string, path: string) => {
    if (!can.deleteArchive(role)) return;
    await deleteDoc(doc(db, "archives", id));
    await deleteObject(ref(storage, path));
  };

  return (
    <AuthGate>
      <Head><title>DPS 77RP — Archiwum</title></Head>
      <Nav />
      <div className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Archiwum dokumentów</h1>
        <div className="grid gap-4">
          {items.map(it => (
            <div key={it.id} className="card p-4">
              <div className="flex items-center gap-3">
                <img src={it.imageUrl} alt="" className="w-24 h-32 object-cover border" />
                <div className="flex-1">
                  <div className="font-semibold">{it.templateName}</div>
                  <div className="text-sm text-beige-700">
                    Wystawił: {it.userLogin} • {it.createdAt?.toDate?.().toLocaleString?.("pl-PL")}
                  </div>
                  <a className="btn mt-2" href={it.imageUrl} target="_blank" rel="noreferrer">Pobierz obraz</a>
                </div>
                {can.deleteArchive(role) && (
                  <button className="btn" onClick={() => remove(it.id, it.imagePath)}>Usuń</button>
                )}
              </div>
            </div>
          ))}
          {items.length === 0 && <p>Brak pozycji.</p>}
        </div>
      </div>
    </AuthGate>
  );
}
