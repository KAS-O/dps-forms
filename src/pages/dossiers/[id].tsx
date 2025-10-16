import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";
import { db, storage } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useProfile, can } from "@/hooks/useProfile";

type RecordItem = {
  id: string;
  text?: string;
  imageUrl?: string;
  createdAt?: any;
  author?: string;
  type?: string;
};

export default function DossierDetailPage() {
  const { role, login } = useProfile();
  const router = useRouter();
  const id = router.query.id as string | undefined;

  const [title, setTitle] = useState("");
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    getDoc(doc(db, "dossiers", id)).then((snap) => {
      const d = snap.data() as any;
      setTitle(d?.title || "Teczka");
    });
    const q = query(collection(db, "dossiers", id, "records"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) =>
      setRecords(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })))
    );
  }, [id]);

  const addRecord = async () => {
    if (!id) return;
    let imageUrl = "";

    const file = fileRef.current?.files?.[0];
    if (file) {
      const sref = ref(storage, `dossiers/${id}/evidence/${Date.now()}-${file.name}`);
      await uploadBytes(sref, file);
      imageUrl = await getDownloadURL(sref);
    }

    const rec = {
      text: text.trim(),
      imageUrl: imageUrl || undefined,
      createdAt: serverTimestamp(),
      author: login || "nieznany",
      type: "note",
    };

    const r = await addDoc(collection(db, "dossiers", id, "records"), rec);
    await addDoc(collection(db, "logs"), {
      type: "dossier_record_add", dossierId: id, recordId: r.id, by: login, ts: serverTimestamp(),
    });

    setText("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const editRecord = async (r: RecordItem) => {
    if (!can.editRecords(role)) return alert("Brak uprawnień.");
    const nt = prompt("Edytuj wpis:", r.text || "") ?? "";
    if (!id || nt === null) return;
    await updateDoc(doc(db, "dossiers", id, "records", r.id), { text: nt });
    await addDoc(collection(db, "logs"), {
      type: "dossier_record_edit", dossierId: id, recordId: r.id, by: login, ts: serverTimestamp(),
    });
  };

  const removeRecord = async (r: RecordItem) => {
    if (!can.editRecords(role)) return alert("Brak uprawnień.");
    if (!id) return;
    if (!confirm("Usunąć wpis z teczki?")) return;
    await deleteDoc(doc(db, "dossiers", id, "records", r.id));
    await addDoc(collection(db, "logs"), {
      type: "dossier_record_delete", dossierId: id, recordId: r.id, by: login, ts: serverTimestamp(),
    });
  };

  return (
    <AuthGate>
      <>
        <Head><title>DPS 77RP — {title}</title></Head>
        <Nav />
        <div className="max-w-5xl mx-auto px-4 py-6 grid gap-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">{title}</h1>
            <a className="btn" href="/dossiers">← Wróć do listy</a>
          </div>

          <div className="card p-4 grid gap-3">
            <h2 className="font-semibold">Dodaj wpis</h2>
            <textarea className="input h-28" placeholder="Opis / okoliczności / skrót..." value={text} onChange={(e)=>setText(e.target.value)} />
            <input ref={fileRef} type="file" accept="image/*" className="input" />
            <button className="btn w-max" onClick={addRecord}>Dodaj</button>
          </div>

          <div className="grid gap-2">
            {records.map(r => (
              <div key={r.id} className="card p-3">
                <div className="text-sm text-beige-700 mb-1">
                  {r.author} • {r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString() : "—"}
                </div>
                {r.text && <div className="whitespace-pre-wrap mb-2">{r.text}</div>}
                {r.imageUrl && (
                  <a href={r.imageUrl} target="_blank" className="text-blue-700 underline">Zobacz zdjęcie dowodu</a>
                )}
                {can.editRecords(role) && (
                  <div className="mt-2 flex gap-2">
                    <button className="btn" onClick={()=>editRecord(r)}>Edytuj</button>
                    <button className="btn bg-red-700 text-white" onClick={()=>removeRecord(r)}>Usuń</button>
                  </div>
                )}
              </div>
            ))}
            {records.length===0 && <p>Brak wpisów.</p>}
          </div>
        </div>
      </>
    </AuthGate>
  );
}
