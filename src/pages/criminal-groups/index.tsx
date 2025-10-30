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

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean.length === 3 ? clean.repeat(2) : clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function groupTileGradient(hex: string) {
  return `linear-gradient(135deg, ${hexToRgba(hex, 0.4)}, rgba(9, 12, 24, 0.92))`;
}

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
          <div className="section-shell section-shell--criminal">
            <div className="section-shell__inner p-6 md:p-8 space-y-6">
              <div className="space-y-2">
                <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.35em] text-rose-100/80">
                  🕵️‍♂️ Rejestr organizacji
                </span>
                <h1 className="text-4xl font-black bg-gradient-to-r from-rose-200 via-white to-amber-200 bg-clip-text text-transparent drop-shadow-[0_0_25px_rgba(255,120,120,0.35)]">
                  Grupy przestępcze
                </h1>
                <p className="text-sm text-rose-100/75 max-w-3xl leading-relaxed">
                  Przegląd aktywnych kart organizacji. Sekcja oferuje szybki dostęp do najważniejszych informacji operacyjnych oraz statystyk z ostatnich działań.
                </p>
              </div>
              {error && <div className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100">{error}</div>}
              {loading ? (
                <p className="text-sm text-rose-100/70 animate-pulse">Ładowanie danych organizacji...</p>
              ) : sortedGroups.length ? (
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {sortedGroups.map((group) => {
                    const color = group.group?.colorHex || "#7c3aed";
                    const glow = hexToRgba(color, 0.45);
                    return (
                      <a
                        key={group.id}
                        href={`/criminal-groups/${group.id}`}
                        className="group relative overflow-hidden rounded-3xl border bg-black/30 p-5 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_25px_60px_rgba(0,0,0,0.45)]"
                        style={{
                          background: groupTileGradient(color),
                          borderColor: hexToRgba(color, 0.5),
                          boxShadow: `0 22px 45px ${hexToRgba(color, 0.25)}`,
                        }}
                        onClick={() => {
                          if (!session) return;
                          void logActivity({ type: "criminal_group_open", dossierId: group.id });
                        }}
                      >
                        <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: `radial-gradient(circle at 20% -10%, ${glow}, transparent 55%)` }} />
                        <div className="relative flex flex-col gap-3">
                          <div className="flex items-center gap-3">
                            <span
                              className="h-3 w-3 rounded-full border border-white/50 shadow-[0_0_15px_rgba(255,255,255,0.45)]"
                              style={{ background: color }}
                            />
                            <h2 className="text-xl font-semibold text-rose-50 flex items-center gap-2">
                              <span className="text-2xl">🔥</span> {group.group?.name || group.title}
                            </h2>
                          </div>
                          <div className="grid gap-1 text-sm text-rose-100/80">
                            <div>🎨 Kolorystyka: <span className="font-semibold text-rose-50">{group.group?.colorName || "—"}</span></div>
                            <div>🏷️ Rodzaj: <span className="font-semibold text-rose-50">{group.group?.organizationType || "—"}</span></div>
                            <div>📍 Baza: <span className="font-semibold text-rose-50">{group.group?.base || "—"}</span></div>
                          </div>
                          {group.group?.operations ? (
                            <div className="rounded-2xl border border-white/20 bg-black/30 p-3 text-xs text-rose-100/80 leading-relaxed">
                              <span className="font-semibold text-rose-50">Zakres działalności:</span> {group.group.operations}
                            </div>
                          ) : null}
                          <span className="inline-flex items-center justify-center w-max gap-2 rounded-full border border-white/40 bg-white/15 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-rose-50">
                            Zobacz kartę organizacji →
                          </span>
                        </div>
                      </a>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-rose-100/70">Brak zapisanych grup przestępczych.</p>
              )}
            </div>
          </div>
        </div>
      </>
    </AuthGate>
  );
}
