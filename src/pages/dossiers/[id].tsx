import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, updateDoc } from "firebase/firestore";
import { useProfile, can } from "@/hooks/useProfile";

export default function DossierDetail() {
  const { role, login } = useProfile();
  const router = useRouter();
  const id = useMemo(() => router.query.id as string, [router.query.id]);

  const [title, setTitle] = useState("");
  const [records, setRecords] = useState<any[]>([]);

  const load = async () => {
    if (!id) return;
    const meta = await getDoc(doc(db, "dossiers", id));
    setTitle((meta.data()?.title as string) || "");
    const snap = await getDocs(query(collection(db, "dossiers", id, "records"), orderBy("createdAt","desc")));
    setRecords(snap.docs.map(d=>({ id: d.id, ...(d.data() as any) })));
  };

  useEffect(()=>{ load(); },[id]);

  const rename = async () => {
    const t = prompt("Nowy tytuł", title);
    if (!t) return;
    await updateDoc(doc(db, "dossiers", id), { title: t });
    await addDoc(collection(db,"logs"), { type:"dossier_edit", id, title:t, login, ts:serverTimestamp() });
    setTitle(t);
  };

  const addRecord = async () => {
    const text = prompt("Dodaj notatkę (data/godzina/okoliczności/itp.)");
    if (!text) return;
    await addDoc(collection(db, "dossiers", id, "records"), { text, createdAt: serverTimestamp(), author: login });
    await addDoc(collection(db,"logs"), { type:"dossier_record_add", id, login, ts:serverTimestamp() });
    load();
  };

  const editRecord = async (r: any) => {
    const text = prompt("Edytuj wpis", r.text || "");
    if (text == null) return;
    await updateDoc(doc(db, "dossiers", id, "records", r.id), { text });
    await addDoc(collection(db,"logs"), { type:"dossier_record_edit", id, recordId:r.id, login, ts:serverTimestamp() });
    load();
  };

  const removeRecord = async (r: any) => {
    if (!confirm("Usunąć wpis?")) return;
    await deleteDoc(doc(db, "dossiers", id, "records", r.id));
    await addDoc(collection(db,"logs"), { type:"dossier_record_delete", id, recordId:r.id, login, ts:serverTimestamp() });
    load();
  };

  return (
    <AuthGate>
      <>
        <Head><title>DPS 77RP — Teczka</title></Head>
        <Nav />
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-4">
            <button className="btn" onClick={()=>history.back()}>← Wróć</button>
            <h1 className="text-2xl font-bold">{title || "Teczka"}</h1>
            {can.manageRoles(role) && <button className="btn" onClick={rename}>Zmień nazwę</button>}
            <button className="btn" onClick={addRecord}>+ Dodaj wpis</button>
          </div>

          <div className="grid gap-2">
            {records.map(r => (
              <div key={r.id} className="card p-3">
                <div className="text-sm text-beige-700 mb-1">
                  {r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString() : ""} • {r.author || "-"}
                </div>
                <div className="whitespace-pre-wrap">{r.text}</div>
                <div className="mt-2 flex items-center gap-2">
                  <button className="btn" onClick={()=>editRecord(r)}>Edytuj</button>
                  <button className="btn bg-red-700 text-white" onClick={()=>removeRecord(r)}>Usuń</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    </AuthGate>
  );
}
