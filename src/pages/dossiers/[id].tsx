import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useRouter } from "next/router";
import { addDoc, collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { db, storage } from "@/lib/firebase";
import { useEffect, useState } from "react";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export default function DossierDetail() {
  const r = useRouter();
  const { id } = r.query;
  const [dossier, setDossier] = useState<any>(null);
  const [evid, setEvid] = useState<any[]>([]);
  const [form, setForm] = useState({ date: "", time: "", desc: "" });
  const [files, setFiles] = useState<FileList | null>(null);

  useEffect(() => {
    if (!id) return;
    const dref = doc(db, "dossiers", String(id));
    const unsub1 = onSnapshot(dref, (s) => setDossier({ id: s.id, ...(s.data() as any) }));
    const q = query(collection(dref, "evidence"), orderBy("createdAt", "desc"));
    const unsub2 = onSnapshot(q, (snap)=> setEvid(snap.docs.map(d=>({ id: d.id, ...(d.data() as any) }))));
    return () => { unsub1(); unsub2(); }
  }, [id]);

  const add = async () => {
    const dref = doc(db, "dossiers", String(id));
    const evRef = collection(dref, "evidence");

    // upload obrazów
    const urls: string[] = [];
    if (files && files.length) {
      for (const f of Array.from(files)) {
        const path = `dossiers/${id}/${Date.now()}-${f.name}`;
        const sref = ref(storage, path);
        await uploadBytes(sref, f);
        const url = await getDownloadURL(sref);
        urls.push(url);
      }
    }

    await addDoc(evRef, {
      date: form.date, time: form.time, desc: form.desc,
      images: urls,
      createdAt: new Date()
    });

    setForm({ date: "", time: "", desc: "" });
    setFiles(null);
  };

  if (!dossier) return <AuthGate><Nav /><div className="max-w-4xl mx-auto p-6">Ładowanie...</div></AuthGate>;

  return (
    <AuthGate>
      <Head><title>DPS 77RP — {dossier.title}</title></Head>
      <Nav />
      <div className="max-w-5xl mx-auto px-4 py-6 grid gap-6">
        <div className="card p-4">
          <h1 className="text-xl font-bold mb-2">{dossier.title}</h1>
          <div className="grid gap-2">
            {evid.map(e => (
              <div key={e.id} className="card p-3">
                <div className="text-sm text-beige-700">{e.date} {e.time}</div>
                <div className="whitespace-pre-wrap">{e.desc}</div>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {(e.images||[]).map((u:string,i:number)=> <a key={i} href={u} target="_blank" className="border block"><img src={u} alt="" className="w-28 h-28 object-cover"/></a>)}
                </div>
              </div>
            ))}
            {evid.length===0 && <p>Brak dowodów.</p>}
          </div>
        </div>

        <div className="card p-4">
          <h2 className="font-semibold mb-2">Dodaj dowód</h2>
          <div className="grid md:grid-cols-2 gap-2">
            <input className="input" placeholder="Data" type="date" value={form.date} onChange={e=>setForm({...form, date:e.target.value})}/>
            <input className="input" placeholder="Godzina" type="time" value={form.time} onChange={e=>setForm({...form, time:e.target.value})}/>
          </div>
          <textarea className="input h-32 mt-2" placeholder="Okoliczności zdarzenia" value={form.desc} onChange={e=>setForm({...form, desc:e.target.value})}/>
          <input className="mt-2" type="file" multiple onChange={e=>setFiles(e.target.files)} />
          <button className="btn mt-3" onClick={add}>Dodaj</button>
        </div>
      </div>
    </AuthGate>
  );
}
