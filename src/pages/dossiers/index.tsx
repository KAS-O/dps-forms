import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { CSSProperties, useEffect, useMemo, useState } from "react";
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

type CrimeGroupSeed = {
  id: string;
  displayName: string;
  category: string;
  color: string;
  organizationType: string;
  gangColor: string;
  base: string;
  operations: string[];
};

const DEFAULT_CRIME_GROUPS: CrimeGroupSeed[] = [
  {
    id: "ballas",
    displayName: "Ballas",
    category: "Grupy przestępcze",
    color: "#7c3aed",
    organizationType: "Gang uliczny",
    gangColor: "Fioletowa",
    base: "Grove Street",
    operations: [
      "Handel narkotykami",
      "Handel bronią",
      "Handel materiałami wybuchowymi",
      "Tworzenie materiałów wybuchowych",
      "Napady",
      "Wyłudzenia",
      "Porwania",
      "Strzelaniny",
      "Pranie pieniędzy",
    ],
  },
];

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace(/#/g, "");
  const bigint = Number.parseInt(raw.length === 3 ? raw.replace(/(.)/g, "$1$1") : raw, 16);
  // eslint-disable-next-line no-bitwise
  const r = (bigint >> 16) & 255;
  // eslint-disable-next-line no-bitwise
  const g = (bigint >> 8) & 255;
  // eslint-disable-next-line no-bitwise
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildGroupCardStyle(color: string): CSSProperties {
  const base = color || "#312e81";
  return {
    background: `linear-gradient(135deg, ${hexToRgba(base, 0.2)}, ${hexToRgba(base, 0.5)})`,
    borderLeft: `4px solid ${base}`,
  };
}

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
    return onSnapshot(q, (snap) => setList(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))));
  }, []);

  useEffect(() => {
    const ensureGroups = async () => {
      await Promise.all(
        DEFAULT_CRIME_GROUPS.map(async (group) => {
          const dossierRef = doc(db, "dossiers", group.id);
          await runTransaction(db, async (tx) => {
            const existing = await tx.get(dossierRef);
            if (existing.exists()) return;
            tx.set(dossierRef, {
              type: "group",
              category: group.category,
              displayName: group.displayName,
              title: `Organizacja ${group.displayName}`,
              color: group.color,
              organizationType: group.organizationType,
              gangColor: group.gangColor,
              base: group.base,
              operations: group.operations,
              createdAt: serverTimestamp(),
              createdBy: auth.currentUser?.email || "system",
              createdByUid: auth.currentUser?.uid || "system",
            });
          });
        })
      );
    };

    void ensureGroups();
  }, []);

  const filtered = useMemo(() => {
    const l = qtxt.toLowerCase();
    return list.filter((x) => {
      const title = (x.title || "").toLowerCase();
      const first = (x.first || "").toLowerCase();
      const last = (x.last || "").toLowerCase();
      const cid = (x.cid || "").toLowerCase();
      const displayName = (x.displayName || "").toLowerCase();
      return [title, first, last, cid, displayName].some((value) => value.includes(l));
    });
  }, [qtxt, list]);

  const groupDossiers = useMemo(
    () => filtered.filter((item) => item.type === "group"),
    [filtered]
  );

  const personDossiers = useMemo(
    () => filtered.filter((item) => item.type !== "group"),
    [filtered]
  );

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
              {groupDossiers.length > 0 && (
                <div className="grid gap-3 mb-6">
                  <h2 className="text-lg font-semibold">Grupy przestępcze</h2>
                  <div className="grid gap-3">
                    {groupDossiers.map((group) => (
                      <a
                        key={group.id}
                        href={`/dossiers/${group.id}`}
                        className="card p-4 text-white shadow-lg transition hover:shadow-xl"
                        style={buildGroupCardStyle(group.color || "#7c3aed")}
                        onClick={() => {
                          if (!session) return;
                          void logActivity({ type: "dossier_link_open", dossierId: group.id });
                        }}
                      >
                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="text-xs uppercase tracking-[0.3em] opacity-80">{group.category || "Organizacja"}</div>
                            <div className="text-2xl font-bold">{group.displayName || group.title || group.id}</div>
                          </div>
                          <div className="text-right text-sm opacity-80">
                            <div>Kolorystyka: {group.gangColor || "—"}</div>
                            <div>Rodzaj: {group.organizationType || "—"}</div>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-1 text-sm">
                          <div><span className="font-semibold">Baza:</span> {group.base || "Brak danych"}</div>
                          <div className="font-semibold mt-2">Zakres działalności:</div>
                          <ul className="list-disc list-inside space-y-1">
                            {(group.operations || []).map((op: string) => (
                              <li key={op}>{op}</li>
                            ))}
                          </ul>
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-2">
                {personDossiers.map((d) => (
                  <div
                    key={d.id}
                    className="card p-3 hover:shadow flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
                  >
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
                {personDossiers.length === 0 && filtered.length === 0 && <p>Brak teczek.</p>}
                {personDossiers.length === 0 && filtered.length > 0 && groupDossiers.length > 0 && (
                  <p>Brak teczek osób spełniających kryteria wyszukiwania.</p>
                )}
              </div>
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
