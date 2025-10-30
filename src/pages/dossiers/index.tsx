import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
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

  const filtered = useMemo(() => {
    const l = qtxt.toLowerCase();
    return list
      .filter((x) => x.category !== "criminal-group")
      .filter((x) =>
        (x.first || "").toLowerCase().includes(l) ||
        (x.last || "").toLowerCase().includes(l) ||
        (x.cid || "").toLowerCase().includes(l) ||
        (x.title || "").toLowerCase().includes(l)
      );
  }, [qtxt, list]);

  const create = async () => {
    try {
      setErr(null);
      setOk(null);
      setCreating(true);
      const user = auth.currentUser;

      const first = form.first.trim();
      const last = form.last.trim();
      const cid = form.cid.trim();
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
        <div className="max-w-6xl mx-auto px-4 py-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-6">
            <div className="section-shell section-shell--dossiers">
              <div className="section-shell__inner p-6 md:p-8 space-y-6">
                <div className="space-y-2">
                  <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.35em] text-purple-100/80">
                    🗃️ Rejestr teczek
                  </span>
                  <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-200 via-white to-sky-200 bg-clip-text text-transparent">
                    Teczki dowodowe
                  </h1>
                  <p className="text-sm text-purple-100/80 max-w-2xl">
                    Prowadź i organizuj dokumentację operacyjną. Wyszukaj osobę po danych identyfikacyjnych, aby szybko przejść do odpowiedniej teczki.
                  </p>
                </div>
                <div className="flex flex-col md:flex-row gap-3">
                  <input className="input flex-1 bg-black/40 border-purple-200/30 focus:border-purple-100/60" placeholder="Szukaj po imieniu, nazwisku lub CID..." value={qtxt} onChange={e=>setQ(e.target.value)} />
                </div>
                {err && <div className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100">{err}</div>}
                {ok && <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 p-4 text-sm text-emerald-100">{ok}</div>}
                <div className="grid gap-4">
                  <div className="grid gap-3">
                    <h2 className="text-sm uppercase tracking-wide text-purple-100/70 flex items-center gap-2">
                      <span className="text-lg">🔎</span> Teczki osób
                    </h2>
                    {filtered.map((d) => (
                      <div
                        key={d.id}
                        className="group relative overflow-hidden rounded-2xl border border-purple-200/25 bg-gradient-to-br from-slate-950/80 via-slate-900/60 to-slate-900/40 p-4 transition-all duration-300 hover:border-purple-200/60 hover:shadow-2xl"
                      >
                        <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: "radial-gradient(circle at 15% -10%, rgba(168, 85, 247, 0.35), transparent 45%)" }} />
                        <div className="relative flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <a
                            className="flex-1"
                            href={`/dossiers/${d.id}`}
                            onClick={() => {
                              if (!session) return;
                              void logActivity({ type: "dossier_link_open", dossierId: d.id });
                            }}
                          >
                            <div className="font-semibold text-purple-50 text-lg flex items-center gap-2">
                              <span className="text-xl">📁</span> {d.title}
                            </div>
                            <div className="text-sm text-purple-100/70">CID: {d.cid}</div>
                          </a>
                          {isDirector && (
                            <button
                              className="btn bg-gradient-to-r from-rose-500 via-rose-400 to-rose-600 text-white w-full md:w-auto"
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
                      </div>
                    ))}
                    {filtered.length === 0 && (
                      <p className="rounded-2xl border border-purple-200/20 bg-black/30 p-4 text-sm text-purple-100/70">Brak wyników — spróbuj innego zapytania.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="section-shell section-shell--dossiers">
              <div className="section-shell__inner p-6 space-y-4">
                <div className="space-y-1">
                  <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.35em] text-purple-100/80">
                    🆕 Nowa teczka
                  </span>
                  <h2 className="text-xl font-semibold text-purple-50">Załóż nową teczkę</h2>
                  <p className="text-xs text-purple-100/70">
                    Uzupełnij podstawowe dane, aby automatycznie wygenerować nowy rekord osoby.
                  </p>
                </div>
                <div className="grid md:grid-cols-3 gap-3">
                  <input className="input bg-black/40 border-purple-200/30 focus:border-purple-100/60" placeholder="Imię" value={form.first} onChange={e=>setForm({...form, first:e.target.value})}/>
                  <input className="input bg-black/40 border-purple-200/30 focus:border-purple-100/60" placeholder="Nazwisko" value={form.last} onChange={e=>setForm({...form, last:e.target.value})}/>
                  <input className="input bg-black/40 border-purple-200/30 focus:border-purple-100/60" placeholder="CID" value={form.cid} onChange={e=>setForm({...form, cid:e.target.value})}/>
                </div>
                <button className="btn" onClick={create} disabled={creating}>
                  {creating ? "Tworzenie..." : "Utwórz"}
                </button>
              </div>
            </div>
          </div>
          <AnnouncementSpotlight />
        </div>
      </>
    </AuthGate>
  );
}
