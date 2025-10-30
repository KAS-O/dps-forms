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

  const heroSummary = useMemo(() => {
    const colorLabels = new Set<string>();
    const organizationTypes = new Set<string>();
    const operations = new Set<string>();

    sortedGroups.forEach((group) => {
      if (group.group?.colorName) {
        colorLabels.add(group.group.colorName);
      } else if (group.group?.colorHex) {
        colorLabels.add(group.group.colorHex.toUpperCase());
      }
      if (group.group?.organizationType) {
        organizationTypes.add(group.group.organizationType);
      }
      if (group.group?.operations) {
        group.group.operations
          .split(/[,•]/)
          .map((part) => part.trim())
          .filter(Boolean)
          .forEach((part) => operations.add(part));
      }
    });

    const colorPreview = Array.from(colorLabels).slice(0, 4);
    const organizationPreview = Array.from(organizationTypes).slice(0, 3);
    const operationsPreview = Array.from(operations).slice(0, 6);

    return {
      totalGroups: sortedGroups.length,
      colorCount: colorLabels.size,
      organizationCount: organizationTypes.size,
      operationCount: operations.size,
      colorPreview,
      organizationPreview,
      operationsPreview,
    };
  }, [sortedGroups]);

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Grupy przestępcze</title>
        </Head>
        <Nav />
        <div className="max-w-6xl mx-auto px-4 py-6 grid gap-6">
          <div
            className="relative overflow-hidden rounded-3xl border-2 border-white/10 bg-gradient-to-br from-slate-900/70 via-indigo-900/60 to-black/70 p-6 shadow-[0_30px_60px_-25px_rgba(76,29,149,0.65)]"
          >
            <div
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{
                background:
                  "radial-gradient(120% 120% at 50% -10%, rgba(168,85,247,0.55), transparent 70%), radial-gradient(90% 90% at 10% 110%, rgba(14,165,233,0.4), transparent 70%)",
                filter: "blur(2px)",
              }}
            />
            <div className="relative z-10 flex flex-col gap-6">
              <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.2em] text-white/70">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 font-semibold">
                  🌐 Rejestr organizacji
                </span>
                <span className="text-[11px] font-semibold text-white/60">
                  Aktualizowany w czasie rzeczywistym
                </span>
              </div>
              <div className="space-y-3">
                <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white drop-shadow-lg">
                  Grupy przestępcze
                </h1>
                <p className="max-w-3xl text-sm leading-relaxed text-white/80">
                  Oddzielny rejestr zorganizowanej przestępczości na terenie Los Santos. Każda karta to dedykowana, rozbudowana teczka operacyjna pełna statystyk, powiązań i materiałów.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 shadow-[0_18px_40px_-24px_rgba(59,130,246,0.65)] backdrop-blur">
                  <span className="text-xs font-semibold uppercase tracking-wide text-white/70">Aktywne grupy</span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-white">{heroSummary.totalGroups}</span>
                    <span className="text-[11px] text-white/70">w systemie</span>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 shadow-[0_18px_40px_-24px_rgba(168,85,247,0.65)] backdrop-blur">
                  <span className="text-xs font-semibold uppercase tracking-wide text-white/70">Typy organizacji</span>
                  <div className="mt-1 flex flex-col gap-1 text-sm text-white/80">
                    <span className="text-2xl font-bold text-white">{heroSummary.organizationCount}</span>
                    {heroSummary.organizationPreview.length ? (
                      <span className="text-[11px] uppercase tracking-wide text-white/60">
                        {heroSummary.organizationPreview.join(" • ")}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 shadow-[0_18px_40px_-24px_rgba(245,158,11,0.6)] backdrop-blur">
                  <span className="text-xs font-semibold uppercase tracking-wide text-white/70">Zakres działań</span>
                  <div className="mt-1 flex flex-col gap-1 text-sm text-white/80">
                    <span className="text-2xl font-bold text-white">{heroSummary.operationCount}</span>
                    {heroSummary.operationsPreview.length ? (
                      <span className="text-[11px] uppercase tracking-wide text-white/60">
                        {heroSummary.operationsPreview.join(" • ")}
                      </span>
                    ) : (
                      <span className="text-[11px] uppercase tracking-wide text-white/60">Brak danych</span>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 shadow-[0_18px_40px_-24px_rgba(45,212,191,0.55)] backdrop-blur">
                  <span className="text-xs font-semibold uppercase tracking-wide text-white/70">Dominujące barwy</span>
                  <div className="mt-1 flex flex-col gap-2">
                    <span className="text-2xl font-bold text-white">{heroSummary.colorCount}</span>
                    {heroSummary.colorPreview.length ? (
                      <div className="flex flex-wrap gap-2">
                        {heroSummary.colorPreview.map((color) => (
                          <span
                            key={color}
                            className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white"
                          >
                            🎨 {color}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100 shadow-[0_18px_40px_-24px_rgba(248,113,113,0.35)]">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80">
              <span className="animate-spin text-lg">🔄</span>
              <span>Ładowanie danych organizacji...</span>
            </div>
          ) : sortedGroups.length ? (
            <div className="grid gap-5 md:grid-cols-2">
              {sortedGroups.map((group, index) => {
                const color = group.group?.colorHex || "#7c3aed";
                const tintedBorder = `${color}66`;
                const cardBackground = `linear-gradient(140deg, ${color}2b, rgba(7, 17, 35, 0.92) 65%)`;
                const cardGlow = `0 28px 60px -32px ${color}aa`;
                const operations = group.group?.operations
                  ?.split(/[,•]/)
                  .map((part) => part.trim())
                  .filter(Boolean)
                  .slice(0, 4);
                return (
                  <a
                    key={group.id}
                    href={`/criminal-groups/${group.id}`}
                    className="group relative overflow-hidden rounded-3xl border-2 p-6 transition-transform duration-300 hover:-translate-y-1 hover:shadow-2xl"
                    style={{
                      background: cardBackground,
                      borderColor: tintedBorder,
                      boxShadow: cardGlow,
                    }}
                    onClick={() => {
                      if (!session) return;
                      void logActivity({ type: "criminal_group_open", dossierId: group.id });
                    }}
                  >
                    <div
                      className="pointer-events-none absolute inset-0 opacity-40"
                      style={{
                        background: `radial-gradient(120% 120% at 50% -20%, ${color}50, transparent 70%)`,
                        filter: "blur(1px)",
                      }}
                    />
                    <div className="relative z-10 flex h-full flex-col gap-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-black/30 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/80">
                          {group.group?.organizationType || "Organizacja"}
                        </span>
                        <span className="text-sm font-semibold text-white/70">#{String(index + 1).padStart(2, "0")}</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <span
                            className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/30 bg-black/40 text-lg"
                            style={{ color }}
                          >
                            🔥
                          </span>
                          <h2 className="text-2xl font-bold tracking-tight text-white drop-shadow">
                            {group.group?.name || group.title}
                          </h2>
                        </div>
                        <div className="grid gap-1 text-sm text-white/80">
                          <span>Kolorystyka: <strong className="text-white">{group.group?.colorName || "—"}</strong></span>
                          <span>Baza: <strong className="text-white">{group.group?.base || "—"}</strong></span>
                        </div>
                        {operations?.length ? (
                          <div className="mt-1 flex flex-wrap gap-2">
                            {operations.map((operation) => (
                              <span
                                key={operation}
                                className="inline-flex items-center gap-1 rounded-full border border-white/30 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/90"
                              >
                                ⚔️ {operation}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-white/70">Zakres działalności: {group.group?.operations || "Brak informacji"}</p>
                        )}
                      </div>
                      <span className="mt-auto inline-flex items-center gap-2 self-start rounded-full border border-white/30 bg-white/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-white transition-transform duration-300 group-hover:translate-x-1">
                        Otwórz kartę organizacji <span>➡️</span>
                      </span>
                    </div>
                  </a>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/15 bg-white/5 px-4 py-5 text-sm text-white/70">
              Brak zapisanych grup przestępczych. Dodaj pierwszą organizację, aby rozpocząć budowę rejestru.
            </div>
          )}
        </div>
      </>
    </AuthGate>
  );
}
