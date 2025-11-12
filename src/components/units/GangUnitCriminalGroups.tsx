import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export type CriminalGroupRecord = {
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

export type NewCriminalGroupInput = {
  name: string;
  title: string;
  colorName: string;
  colorHex: string;
  organizationType: string;
  base: string;
  operations: string;
};

function normalizeColor(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "#7c3aed";
  }
  const normalized = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : "#7c3aed";
}

export default function GangUnitCriminalGroups() {
  const [criminalGroups, setCriminalGroups] = useState<CriminalGroupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<NewCriminalGroupInput>({
    name: "",
    title: "",
    colorName: "",
    colorHex: "#7c3aed",
    organizationType: "",
    base: "",
    operations: "",
  });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!db) {
      setLoading(false);
      setError("Brak połączenia z bazą danych. Spróbuj ponownie później.");
      return;
    }

    setLoading(true);
    const groupsQuery = query(collection(db, "dossiers"), where("category", "==", "criminal-group"));
    const unsubscribe = onSnapshot(
      groupsQuery,
      (snapshot) => {
        setCriminalGroups(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })));
        setError(null);
        setLoading(false);
      },
      (err) => {
        console.error("Nie udało się pobrać grup przestępczych", err);
        setError("Nie udało się wczytać grup przestępczych. Spróbuj ponownie później.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const sortedGroups = useMemo(() => {
    return [...criminalGroups].sort((a, b) => {
      const nameA = a.group?.name || a.title || "";
      const nameB = b.group?.name || b.title || "";
      return nameA.localeCompare(nameB, "pl", { sensitivity: "base" });
    });
  }, [criminalGroups]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (saving) return;

      const name = form.name.trim();
      const title = form.title.trim();
      const colorName = form.colorName.trim();
      const colorHex = normalizeColor(form.colorHex);
      const organizationType = form.organizationType.trim();
      const base = form.base.trim();
      const operations = form.operations.trim();

      if (!name) {
        setFormError("Podaj nazwę grupy.");
        return;
      }

      if (!/^#[0-9a-fA-F]{6}$/.test(colorHex)) {
        setFormError("Kolor (HEX) musi mieć format #RRGGBB.");
        return;
      }

      if (!db) {
        setFormError("Brak konfiguracji bazy danych.");
        return;
      }

      setFormError(null);
      setSaving(true);

      try {
        const user = auth.currentUser;
        const ref = doc(collection(db, "dossiers"));
        await setDoc(ref, {
          title: title || `Organizacja ${name}`,
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

        setForm({
          name: "",
          title: "",
          colorName: "",
          colorHex,
          organizationType: "",
          base: "",
          operations: "",
        });
      } catch (err: any) {
        console.error("Nie udało się utworzyć grupy", err);
        setFormError(err?.message || "Nie udało się utworzyć grupy.");
      } finally {
        setSaving(false);
      }
    },
    [form, saving]
  );

  return (
    <div className="space-y-6">
      <div className="card bg-gradient-to-br from-fuchsia-900/85 via-indigo-900/80 to-slate-900/85 p-6 text-white shadow-xl">
        <h2 className="text-xl font-semibold">Gang Unit — rejestr organizacji</h2>
        <p className="mt-1 text-sm text-white/70">
          Zarządzaj profilami grup przestępczych obserwowanych przez GU. Dodawaj nowe wpisy i kieruj funkcjonariuszy do
          odpowiednich kart operacyjnych.
        </p>
      </div>

      <form className="card bg-white/95 p-6 text-slate-900 shadow" onSubmit={handleSubmit}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-slate-700">Nazwa grupy *</span>
            <input
              className="input bg-white"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="np. Vagos"
              required
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-slate-700">Tytuł (opcjonalnie)</span>
            <input
              className="input bg-white"
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="np. Organizacja Vagos"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-slate-700">Kolor — nazwa</span>
            <input
              className="input bg-white"
              value={form.colorName}
              onChange={(event) => setForm((prev) => ({ ...prev, colorName: event.target.value }))}
              placeholder="np. Żółta"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-slate-700">Kolor — HEX *</span>
            <div className="flex items-center gap-3">
              <input
                className="input bg-white"
                value={form.colorHex}
                onChange={(event) => setForm((prev) => ({ ...prev, colorHex: event.target.value }))}
                placeholder="#7c3aed"
                pattern="#?[0-9a-fA-F]{6}"
                required
              />
              <span className="h-10 w-10 rounded-full border border-slate-300" style={{ background: normalizeColor(form.colorHex) }} />
            </div>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-slate-700">Rodzaj organizacji</span>
            <input
              className="input bg-white"
              value={form.organizationType}
              onChange={(event) => setForm((prev) => ({ ...prev, organizationType: event.target.value }))}
              placeholder="np. Gang uliczny"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-semibold text-slate-700">Baza operacyjna</span>
            <input
              className="input bg-white"
              value={form.base}
              onChange={(event) => setForm((prev) => ({ ...prev, base: event.target.value }))}
              placeholder="np. Grove Street"
            />
          </label>
        </div>

        <label className="mt-4 grid gap-1 text-sm">
          <span className="font-semibold text-slate-700">Zakres działalności</span>
          <textarea
            className="input min-h-[120px] bg-white"
            value={form.operations}
            onChange={(event) => setForm((prev) => ({ ...prev, operations: event.target.value }))}
            placeholder="Opis działań, np. handel narkotykami, bronią, napady"
          />
        </label>

        {formError && (
          <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{formError}</div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-500">Pola oznaczone * są wymagane.</span>
          <button type="submit" className="btn bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-60" disabled={saving}>
            {saving ? "Zapisywanie..." : "Dodaj grupę"}
          </button>
        </div>
      </form>

      {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}

      {loading ? (
        <div className="card bg-white/10 p-5 text-sm text-white/70">Wczytywanie profili grup...</div>
      ) : sortedGroups.length === 0 ? (
        <div className="card bg-white/10 p-5 text-sm text-white/70">
          Brak zapisanych grup przestępczych. Dodaj pierwszą organizację, aby rozpocząć ewidencję.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sortedGroups.map((group) => {
            const rawColor = group.group?.colorHex || "#7c3aed";
            const normalizedColor = normalizeColor(rawColor);
            const organizationName = group.group?.name || group.title || group.id;
            return (
              <div
                key={group.id}
                className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-5 text-white shadow-lg"
                style={{ background: `linear-gradient(135deg, ${normalizedColor}33, rgba(15, 23, 42, 0.92))` }}
              >
                <span
                  className="pointer-events-none absolute inset-0 opacity-40"
                  style={{ background: `radial-gradient(circle at 20% 20%, ${normalizedColor}33, transparent 65%)` }}
                />
                <div className="relative flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-xl font-semibold tracking-tight">{organizationName}</h3>
                      <p className="text-xs uppercase tracking-[0.3em] text-white/70">
                        Kolorystyka: {group.group?.colorName || "—"}
                      </p>
                    </div>
                    <span className="rounded-full border border-white/30 bg-black/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                      {group.group?.organizationType || "Nieokreślono"}
                    </span>
                  </div>
                  <div className="grid gap-2 text-sm text-white/85">
                    <div className="flex items-center gap-2">
                      <span aria-hidden>📍</span>
                      <span>Baza: {group.group?.base || "—"}</span>
                    </div>
                    {group.group?.operations && (
                      <div className="flex items-start gap-2">
                        <span aria-hidden>⚔️</span>
                        <span className="leading-relaxed">Zakres działalności: {group.group.operations}</span>
                      </div>
                    )}
                  </div>
                  <Link
                    href={`/criminal-groups/${group.id}`}
                    className="mt-2 inline-flex w-max items-center gap-2 rounded-full border border-white/40 bg-white/15 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:bg-white/25"
                  >
                    Otwórz kartę
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
