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

function withAlpha(hex: string | undefined, alpha: number): string {
  if (!hex) return `rgba(124, 58, 237, ${alpha})`;
  const normalized = hex.replace(/[^0-9a-f]/gi, "");
  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16);
    const g = parseInt(normalized[1] + normalized[1], 16);
    const b = parseInt(normalized[2] + normalized[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (normalized.length === 6) {
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgba(124, 58, 237, ${alpha})`;
}

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
          <div className="card p-6 space-y-5" data-section="criminal-groups">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <span className="section-chip">
                  <span className="section-chip__dot" style={{ background: "#ec4899" }} />
                  Grupy przestępcze
                </span>
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight">Rejestr organizacji przestępczych</h1>
                  <p className="text-sm text-beige-100/75">
                    Podgląd najgroźniejszych grup działających na terenie miasta. Każda karta zawiera kolorystykę,
                    zakres działań i informacje operacyjne.
                  </p>
                </div>
              </div>
              <div className="hidden md:flex items-center gap-3">
                <span className="section-chip">
                  <span className="section-chip__dot" style={{ background: "#38bdf8" }} />
                  Wydział Kryminalny
                </span>
              </div>
            </div>
            {error && <div className="card p-3 bg-red-50 text-red-700">{error}</div>}
            {loading ? (
              <p>Ładowanie...</p>
            ) : sortedGroups.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {sortedGroups.map((group) => {
                  const color = group.group?.colorHex || "#7c3aed";
                  const glow = withAlpha(color, 0.35);
                  return (
                    <a
                      key={group.id}
                      href={`/criminal-groups/${group.id}`}
                      className="card p-5 transition hover:-translate-y-1"
                      data-section="criminal-groups"
                      style={{
                        borderColor: `${color}b0`,
                        boxShadow: `0 32px 72px -32px ${color}d5`,
                        background: `linear-gradient(135deg, ${withAlpha(color, 0.55)}, rgba(10, 16, 34, 0.92))`,
                      }}
                      onClick={() => {
                        if (!session) return;
                        void logActivity({ type: "criminal_group_open", dossierId: group.id });
                      }}
                    >
                      <span
                        className="absolute inset-0 opacity-60 animate-pulse-soft"
                        style={{
                          background: `radial-gradient(circle at 20% 20%, ${glow}, transparent 55%)`,
                        }}
                      />
                      <div className="relative flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <span className="text-3xl animate-bounce-slow" aria-hidden>
                              🐍
                            </span>
                            <div>
                              <h2 className="text-xl font-semibold text-white tracking-tight">
                                {group.group?.name || group.title}
                              </h2>
                              <p className="text-xs uppercase tracking-[0.3em] text-white/70">
                                Kolorystyka: {group.group?.colorName || "—"}
                              </p>
                            </div>
                          </div>
                          <span className="section-chip hidden sm:inline-flex" style={{ borderColor: `${color}aa` }}>
                            <span className="section-chip__dot" style={{ background: color }} />
                            Profil
                          </span>
                        </div>
                        <div className="grid gap-2 text-sm text-white/85">
                          <div className="flex items-center gap-2">
                            <span aria-hidden>🏷️</span>
                            <span>Rodzaj organizacji: {group.group?.organizationType || "—"}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span aria-hidden>📍</span>
                            <span>Baza: {group.group?.base || "—"}</span>
                          </div>
                          {group.group?.operations ? (
                            <div className="flex items-start gap-2 text-sm text-white/85">
                              <span aria-hidden>⚔️</span>
                              <span className="leading-relaxed">
                                Zakres działalności: {group.group.operations}
                              </span>
                            </div>
                          ) : null}
                        </div>
                        <span className="relative inline-flex items-center justify-center mt-2 w-max px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-[0.4em] bg-white/15 text-white/90">
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
