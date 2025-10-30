import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useProfile } from "@/hooks/useProfile";
import AnnouncementSpotlight from "@/components/AnnouncementSpotlight";
import { useDialog } from "@/components/DialogProvider";
import { useSessionActivity } from "@/components/ActivityLogger";

export default function Dossiers() {
  const [list, setList] = useState<any[]>([]);
  const [qtxt, setQ] = useState("");
  const [form, setForm] = useState({ first: "", last: "", cid: "" });
  const [groups, setGroups] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { role } = useProfile();
  const isDirector = role === "director";
  const { confirm, alert } = useDialog();
  const { logActivity, session } = useSessionActivity();

  useEffect(() => {
    const q = query(collection(db, "dossiers"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => setList(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))));
  }, []);

  useEffect(() => {
    const q = query(collection(db, "criminalGroups"), orderBy("name"));
    return onSnapshot(q, (snap) => setGroups(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))));
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
      setOk(null);
      setCreating(true);
      const first = form.first.trim();
      const last  = form.last.trim();
      const cid   = form.cid.trim();
      if (!first || !last || !cid) {
        setErr("Uzupełnij imię, nazwisko i CID.");
        return;
      }
      const normalizedCid = cid.toLowerCase();
      if (list.some((d) => (d.cid || "").toString().toLowerCase() === normalizedCid)) {
        setErr("Teczka z tym CID już istnieje.");
        return;
      }
      const title = `Akta ${first} ${last} CID:${cid}`;
      const user = auth.currentUser;
      const dossierId = normalizedCid;
      const dossierRef = doc(db, "dossiers", dossierId);
      await runTransaction(db, async (tx) => {
        const existing = await tx.get(dossierRef);
        if (existing.exists()) {
          throw new Error("Teczka z tym CID już istnieje.");
        }
        tx.set(dossierRef, {
          first,
          last,
          cid,
          title,
          createdAt: serverTimestamp(),
          createdBy: user?.email || "",
          createdByUid: user?.uid || "",
        });
      });
      const timestamp = serverTimestamp();
      await addDoc(collection(db, "logs"), {
        type: "dossier_create",
        first,
        last,
        cid,
        createdAt: timestamp,
        ts: timestamp,
        author: user?.email || "",
        authorUid: user?.uid || "",
      });
      setForm({ first: "", last: "", cid: "" });
      setOk("Teczka została utworzona.");
    } catch (e: any) {
      setErr(e?.message || "Nie udało się utworzyć teczki");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (dossierId: string) => {
   if (!isDirector) {
      await alert({
        title: "Brak uprawnień",
        message: "Tylko Director może usuwać teczki.",
        tone: "info",
      });
      return;
    }
    const ok = await confirm({
      title: "Usuń teczkę",
      message: "Czy na pewno chcesz usunąć tę teczkę wraz ze wszystkimi wpisami?",
      confirmLabel: "Usuń",
      tone: "danger",
    });
    if (!ok) return;
    try {
      setErr(null);
      setOk(null);
      setDeletingId(dossierId);
      const recordsSnap = await getDocs(collection(db, "dossiers", dossierId, "records"));
      const batch = writeBatch(db);
      recordsSnap.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      batch.delete(doc(db, "dossiers", dossierId));
      await batch.commit();
      const user = auth.currentUser;
      await addDoc(collection(db, "logs"), {
        type: "dossier_delete",
        dossierId,
        author: user?.email || "",
        authorUid: user?.uid || "",
        ts: serverTimestamp(),
      });
      setOk("Teczka została usunięta.");
    } catch (e: any) {
      setErr(e?.message || "Nie udało się usunąć teczki.");
    } finally {
      setDeletingId(null);
    }
  };


  return (
    <AuthGate>
      <>
        <Head><title>LSPD 77RP — Teczki</title></Head>
        <Nav />
        <div className="max-w-6xl mx-auto px-4 py-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid gap-6">
            <div className="card p-4">
              <h1 className="text-xl font-bold mb-2">Teczki dowodowe</h1>
              <div className="flex gap-2 mb-3">
                <input className="input flex-1" placeholder="Szukaj po imieniu/nazwisku/CID..." value={qtxt} onChange={e=>setQ(e.target.value)} />
              </div>
              {err && <div className="card p-3 bg-red-50 text-red-700 mb-3">{err}</div>}
              {ok && <div className="card p-3 bg-green-50 text-green-700 mb-3">{ok}</div>}
              <div className="grid gap-2">
                {filtered.map(d => (
                  <div key={d.id} className="card p-3 hover:shadow flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                   <a
                      className="flex-1"
                      href={`/dossiers/${d.id}`}
                      onClick={() => {
                        if (!session) return;
                        void logActivity({ type: "dossier_link_open", dossierId: d.id });
                      }}
                    >
                      <div className="font-semibold">{d.title}</div>
                      <div className="text-sm text-beige-700">CID: {d.cid}</div>
                    </a>
                    {isDirector && (
                      <button
                        className="btn bg-red-700 text-white w-full md:w-auto"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          remove(d.id);
                        }}
                        disabled={deletingId === d.id}
                      >
                        {deletingId === d.id ? "Usuwanie..." : "Usuń"}
                      </button>
                    )}
                  </div>
                ))}
                {filtered.length===0 && <p>Brak teczek.</p>}
              </div>
            </div>

            <div className="card p-4">
              <h2 className="text-xl font-bold mb-2">Grupy przestępcze</h2>
              <p className="text-sm text-beige-700 mb-3">
                Zobacz teczki operacyjne organizacji — członków, zasoby i zebrane dowody.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                  {groups.map((group) => {
                    const color = group.colorHex || "#6d28d9";
                    return (
                      <Link
                        key={group.id}
                        href={`/criminal-groups/${group.id}`}
                        className="card p-4 text-white transition hover:shadow-xl"
                        style={{
                          backgroundImage: `linear-gradient(135deg, ${color}dd, ${color}aa)`,
                          borderColor: `${color}aa`,
                          boxShadow: `0 20px 45px -30px ${color}`,
                        }}
                        onClick={() => {
                          if (!session) return;
                          void logActivity({ type: "criminal_group_from_dossiers_open", groupId: group.id });
                        }}
                      >
                        <div className="text-sm uppercase tracking-[0.3em] opacity-80">
                          {group.colorLabel || "Organizacja"}
                        </div>
                        <div className="text-xl font-semibold">{group.name}</div>
                        {group.base && <div className="text-sm opacity-80">Baza: {group.base}</div>}
                        {group.organizationType && (
                          <div className="mt-1 text-xs uppercase tracking-widest bg-black/30 px-2 py-1 rounded-full inline-block">
                            {group.organizationType}
                          </div>
                        )}
                      </Link>
                    );
                  })}
              </div>
              {groups.length === 0 && (
                <p className="text-sm text-beige-700">Brak zdefiniowanych grup. Utwórz je w sekcji Grupy przestępcze.</p>
              )}
            </div>


          <div className="card p-4">
              <h2 className="font-semibold mb-2">Załóż nową teczkę</h2>
              <div className="grid md:grid-cols-3 gap-2">
                <input className="input" placeholder="Imię" value={form.first} onChange={e=>setForm({...form, first:e.target.value})}/>
                <input className="input" placeholder="Nazwisko" value={form.last} onChange={e=>setForm({...form, last:e.target.value})}/>
                <input className="input" placeholder="CID" value={form.cid} onChange={e=>setForm({...form, cid:e.target.value})}/>
              </div>
              <button className="btn mt-3" onClick={create} disabled={creating}>
                {creating ? "Tworzenie..." : "Utwórz"}
              </button>
            </div>
          </div>
          <AnnouncementSpotlight />
        </div>
      </>
    </AuthGate>
  );
}
