import { useEffect, useMemo, useState } from "react";
import { useSessionActivity } from "@/components/ActivityLogger";
import { auth, db } from "@/lib/firebase";
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

export type CriminalGroup = {
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

type CriminalGroupsSectionProps = {
  variant?: "page" | "embedded";
  allowCreate?: boolean;
};

type GroupFormState = {
  name: string;
  colorName: string;
  colorHex: string;
  organizationType: string;
  base: string;
  operations: string;
};

const INITIAL_GROUP: GroupFormState = {
  name: "",
  colorName: "",
  colorHex: "#7c3aed",
  organizationType: "",
  base: "",
  operations: "",
};

const BALLAS_INFO: NonNullable<CriminalGroup["group"]> = {
  name: "Ballas",
  colorName: "Fioletowa",
  colorHex: "#7c3aed",
  organizationType: "Gang uliczny",
  base: "Grove Street",
  operations:
    "Handel narkotykami, handel bronią, handel materiałami wybuchowymi, tworzenie materiałów wybuchowych, napady, wyłudzenia, porwania, strzelaniny, pranie pieniędzy",
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

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase();
}

export function CriminalGroupsSection({ variant = "embedded", allowCreate = false }: CriminalGroupsSectionProps) {
  const [groups, setGroups] = useState<CriminalGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<GroupFormState>(INITIAL_GROUP);
  const [saving, setSaving] = useState(false);
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

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!allowCreate) return;
    const name = form.name.trim();
    const colorName = form.colorName.trim();
    const colorHex = form.colorHex.trim();
    const organizationType = form.organizationType.trim();
    const base = form.base.trim();
    const operations = form.operations.trim();

    if (!name || !colorName || !colorHex || !organizationType || !base || !operations) {
      setError("Uzupełnij wszystkie pola przed zapisaniem nowej grupy.");
      return;
    }

    const slug = slugify(name);
    const dossierId = slug ? `group-${slug}` : `group-${Date.now()}`;

    try {
      setSaving(true);
      setError(null);
      const user = auth.currentUser;
      await setDoc(doc(db, "dossiers", dossierId), {
        title: `Organizacja ${name}`,
        category: "criminal-group",
        group: {
          name,
          colorName,
          colorHex,
          organizationType,
          base,
          operations,
        },
        createdAt: serverTimestamp(),
        createdBy: user?.email || "",
        createdByUid: user?.uid || "",
      });
      setForm(INITIAL_GROUP);
    } catch (e: any) {
      setError(e?.message || "Nie udało się zapisać nowej grupy.");
    } finally {
      setSaving(false);
    }
  };

  const headingVariant = variant === "page" ? "text-3xl" : "text-2xl";
  const descriptionVariant = variant === "page" ? "text-sm" : "text-xs";

  return (
    <div className="grid gap-5" data-section="criminal-groups">
      <div className="card p-6 space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <span className="section-chip">
              <span className="section-chip__dot" style={{ background: "#ec4899" }} />
              Grupy przestępcze
            </span>
            <div>
              <h2 className={`${headingVariant} font-semibold tracking-tight`}>
                Rejestr organizacji przestępczych
              </h2>
              <p className={`${descriptionVariant} text-beige-100/75`}>
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
              const glow = withAlpha(color, 0.28);
              return (
                <a
                  key={group.id}
                  href={`/criminal-groups/${group.id}`}
                  className="card relative overflow-hidden p-5 transition hover:-translate-y-1"
                  style={{
                    borderColor: withAlpha(color, 0.55),
                    boxShadow: `0 26px 60px -30px ${withAlpha(color, 0.7)}`,
                    background: `linear-gradient(135deg, ${withAlpha(color, 0.4)}, rgba(10, 16, 34, 0.95))`,
                  }}
                  onClick={() => {
                    if (!session) return;
                    void logActivity({ type: "criminal_group_open", dossierId: group.id });
                  }}
                >
                  <span
                    className="pointer-events-none absolute inset-0 opacity-60 animate-pulse-soft"
                    style={{ background: `radial-gradient(circle at 20% 20%, ${glow}, transparent 55%)` }}
                  />
                  <div className="relative flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="text-3xl animate-bounce-slow" aria-hidden>
                          🐍
                        </span>
                        <div>
                          <h3 className="text-xl font-semibold text-white tracking-tight">
                            {group.group?.name || group.title}
                          </h3>
                          <p className="text-xs uppercase tracking-[0.3em] text-white/70">
                            Kolorystyka: {group.group?.colorName || "—"}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-2 text-sm text-white/80">
                      <span>Rodzaj organizacji: {group.group?.organizationType || "—"}</span>
                      <span>Główna baza: {group.group?.base || "—"}</span>
                      <span>Zakres działalności: {group.group?.operations || "—"}</span>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        ) : (
          <p>Brak zapisanych grup przestępczych.</p>
        )}
      </div>

      {allowCreate && (
        <form
          className="card space-y-4 p-6"
          onSubmit={handleSubmit}
          aria-label="Dodaj nową grupę przestępczą"
        >
          <div className="space-y-1">
            <h3 className="text-xl font-semibold">Dodaj nową grupę</h3>
            <p className="text-sm text-white/70">
              Wprowadź wszystkie informacje operacyjne. Formularz utworzy nową teczkę organizacji w bazie danych.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium text-white/80">
              Nazwa grupy
              <input
                className="input mt-1 bg-white text-black placeholder:text-slate-500"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="np. Vagos"
              />
            </label>
            <label className="text-sm font-medium text-white/80">
              Kolorystyka
              <input
                className="input mt-1 bg-white text-black placeholder:text-slate-500"
                value={form.colorName}
                onChange={(e) => setForm((prev) => ({ ...prev, colorName: e.target.value }))}
                placeholder="np. Żółta"
              />
            </label>
            <label className="text-sm font-medium text-white/80">
              Kod koloru (HEX)
              <input
                className="input mt-1 bg-white text-black placeholder:text-slate-500"
                value={form.colorHex}
                onChange={(e) => setForm((prev) => ({ ...prev, colorHex: e.target.value }))}
                placeholder="#facc15"
              />
            </label>
            <label className="text-sm font-medium text-white/80">
              Rodzaj organizacji
              <input
                className="input mt-1 bg-white text-black placeholder:text-slate-500"
                value={form.organizationType}
                onChange={(e) => setForm((prev) => ({ ...prev, organizationType: e.target.value }))}
                placeholder="np. Kartel"
              />
            </label>
            <label className="md:col-span-2 text-sm font-medium text-white/80">
              Baza operacyjna
              <input
                className="input mt-1 bg-white text-black placeholder:text-slate-500"
                value={form.base}
                onChange={(e) => setForm((prev) => ({ ...prev, base: e.target.value }))}
                placeholder="np. Little Seoul"
              />
            </label>
            <label className="md:col-span-2 text-sm font-medium text-white/80">
              Zakres działalności
              <textarea
                className="input mt-1 h-32 bg-white text-black placeholder:text-slate-500"
                value={form.operations}
                onChange={(e) => setForm((prev) => ({ ...prev, operations: e.target.value }))}
                placeholder="Opisz działania przestępcze, sposoby operowania, powiązania..."
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn bg-emerald-500 text-white hover:bg-emerald-400" disabled={saving} type="submit">
              {saving ? "Zapisywanie..." : "Dodaj grupę"}
            </button>
            <button
              type="button"
              className="btn bg-white/10 text-white hover:bg-white/20"
              onClick={() => setForm(INITIAL_GROUP)}
              disabled={saving}
            >
              Wyczyść formularz
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default CriminalGroupsSection;
