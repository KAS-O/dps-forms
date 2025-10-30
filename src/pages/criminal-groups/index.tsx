import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useSessionActivity } from "@/components/ActivityLogger";

type CriminalGroup = {
  id: string;
  title?: string;
  group?: {
    name?: string;
    colorName?: string;
    colorHex?: string;
    organizationType?: string;
    base?: string;
    operations?: string;
  } | null;
};

const BALLAS_INFO = {
  name: "Ballas",
  colorName: "Fioletowa",
  colorHex: "#7c3aed",
  organizationType: "Gang uliczny",
  base: "Grove Street",
  operations:
    "Handel narkotykami, handel bronią, handel materiałami wybuchowymi, tworzenie materiałów wybuchowych, napady, wyłudzenia, porwania, strzelaniny, pranie pieniędzy",
};

export default function CriminalGroupsPage() {
  const [groups, setGroups] = useState<CriminalGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { session, logActivity } = useSessionActivity();

  useEffect(() => {
    const ensureBallasExists = async () => {
      try {
        const dossierId = "group-ballas";
        const dossierRef = doc(db, "dossiers", dossierId);
        const snap = await getDoc(dossierRef);
        if (!snap.exists()) {
          const user = auth.currentUser;
          await setDoc(dossierRef, {
            title: "Organizacja Ballas",
            category: "criminal-group",
            group: BALLAS_INFO,
            createdAt: serverTimestamp(),
            createdBy: user?.email || "",
            createdByUid: user?.uid || "",
          });
        } else {
          const currentGroup = snap.data()?.group || {};
          const updatedGroup = { ...BALLAS_INFO, ...currentGroup };
          await setDoc(
            dossierRef,
            {
              title: "Organizacja Ballas",
              category: "criminal-group",
              group: updatedGroup,
            },
            { merge: true }
          );
        }
      } catch (e: any) {
        setError(e?.message || "Nie udało się przygotować danych grupy.");
      }
    };

    void ensureBallasExists();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "dossiers"), where("category", "==", "criminal-group"));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        setGroups(snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) })));
        setLoading(false);
      },
      (err) => {
        setError(err.message || "Nie udało się pobrać grup przestępczych.");
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => {
      const nameA = a.group?.name || a.title || "";
      const nameB = b.group?.name || b.title || "";
      return nameA.localeCompare(nameB, "pl");
    });
  }, [groups]);

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Grupy przestępcze</title>
        </Head>
        <Nav />
        <div className="max-w-6xl mx-auto px-4 py-6 grid gap-6">
          <div className="card p-4 flex flex-col gap-3">
            <div>
              <h1 className="text-xl font-bold">Grupy przestępcze</h1>
              <p className="text-sm text-beige-700">
                Oddzielny rejestr grup przestępczych. Obecnie dostępna jest jedna organizacja — Ballas.
              </p>
            </div>
            {error && <div className="card p-3 bg-red-50 text-red-700">{error}</div>}
            {loading ? (
              <p>Ładowanie...</p>
            ) : sortedGroups.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {sortedGroups.map((group) => {
                  const color = group.group?.colorHex || "#7c3aed";
                  return (
                    <a
                      key={group.id}
                      href={`/criminal-groups/${group.id}`}
                      className="rounded-2xl border border-white/10 bg-black/30 p-5 hover:border-white/30 transition"
                      style={{ boxShadow: `0 10px 35px ${color}1a` }}
                      onClick={() => {
                        if (!session) return;
                        void logActivity({ type: "criminal_group_open", dossierId: group.id });
                      }}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-3">
                          <span
                            className="w-3 h-3 rounded-full border border-white/40"
                            style={{ background: color }}
                          />
                          <h2 className="text-lg font-semibold">{group.group?.name || group.title}</h2>
                        </div>
                        <div className="text-sm text-beige-200/80">
                          Kolorystyka: {group.group?.colorName || "—"}
                        </div>
                        <div className="text-sm text-beige-200/80">
                          Rodzaj organizacji: {group.group?.organizationType || "—"}
                        </div>
                        <div className="text-sm text-beige-200/80">
                          Baza: {group.group?.base || "—"}
                        </div>
                        {group.group?.operations ? (
                          <div className="text-xs text-beige-100/70 leading-relaxed">
                            Zakres działalności: {group.group.operations}
                          </div>
                        ) : null}
                        <span className="inline-flex items-center justify-center mt-2 w-max px-3 py-1 rounded-full bg-white/10 text-xs uppercase tracking-wide">
                          Otwórz kartę organizacji
                        </span>
                      </div>
                    </a>
                  );
                })}
              </div>
            ) : (
              <p>Brak zapisanych grup przestępczych.</p>
            )}
          </div>
        </div>
      </>
    </AuthGate>
  );
}
