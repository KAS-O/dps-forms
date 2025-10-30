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
  const accentPalette = ["#a855f7", "#38bdf8", "#f97316", "#22c55e", "#ef4444", "#eab308"];

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
        <div className="max-w-6xl mx-auto px-4 py-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid gap-6">
            <div className="card p-6 space-y-4" data-section="dossiers">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                  <span className="section-chip">
                    <span className="section-chip__dot" style={{ background: "#a855f7" }} />
                    Teczki
                  </span>
                  <div>
                    <h1 className="text-3xl font-semibold tracking-tight">Archiwum teczek osobowych</h1>
                    <p className="text-sm text-beige-100/75">
                      Wyszukaj osobę po danych identyfikacyjnych i przejdź do jej szczegółowej dokumentacji.
                    </p>
                  </div>
                </div>
                <div className="w-full md:w-80">
                  <input
                    className="input"
                    placeholder="Szukaj po imieniu, nazwisku lub numerze CID..."
                    value={qtxt}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
              </div>
              {err && <div className="card p-3 bg-red-50 text-red-700 mb-3">{err}</div>}
              {ok && <div className="card p-3 bg-green-50 text-green-700 mb-3">{ok}</div>}
              <div className="grid gap-3">
                <h2 className="text-xs uppercase tracking-[0.3em] text-beige-100/60">Teczki osób</h2>
                {filtered.map((d, index) => {
                  const accent = accentPalette[index % accentPalette.length];
                  return (
                    <div
                      key={d.id}
                      className="card p-4 transition hover:-translate-y-0.5"
                      data-section="dossiers"
                      style={{
                        borderColor: `${accent}90`,
                        boxShadow: `0 26px 60px -28px ${accent}aa`,
                      }}
                    >
                      <a
                        className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
                        href={`/dossiers/${d.id}`}
                        onClick={() => {
                          if (!session) return;
                          void logActivity({ type: "dossier_link_open", dossierId: d.id });
                        }}
                      >
                        <div>
                          <div className="font-semibold text-lg flex items-center gap-2">
                            <span className="text-base" aria-hidden>📁</span>
                            {d.title}
                          </div>
                          <div className="text-sm text-beige-100/75">CID: {d.cid}</div>
                        </div>
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
                      </a>
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="card p-4 text-sm text-beige-100/70" data-section="dossiers">
                    Nie znaleziono teczki spełniającej kryteria wyszukiwania.
                  </div>
                )}
              </div>
            </div>

            <div className="card p-6 space-y-4" data-section="dossiers">
              <div>
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <span className="text-2xl" aria-hidden>✨</span>
                  Załóż nową teczkę
                </h2>
                <p className="text-sm text-beige-100/70">
                  Wypełnij podstawowe dane identyfikacyjne, aby rozpocząć dokumentację osoby.
                </p>
              </div>
              <div className="grid md:grid-cols-3 gap-2">
                <input
                  className="input"
                  placeholder="Imię"
                  value={form.first}
                  onChange={(e) => setForm({ ...form, first: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Nazwisko"
                  value={form.last}
                  onChange={(e) => setForm({ ...form, last: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="CID"
                  value={form.cid}
                  onChange={(e) => setForm({ ...form, cid: e.target.value })}
                />
              </div>
              <button className="btn w-full md:w-auto" onClick={create} disabled={creating}>
                {creating ? "Tworzenie..." : "Utwórz teczkę"}
              </button>
            </div>
          </div>
          <AnnouncementSpotlight />
        </div>
      </>
    </AuthGate>
  );
}
