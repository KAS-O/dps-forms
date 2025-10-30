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
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useSessionActivity } from "@/components/ActivityLogger";

interface CriminalGroup {
  id: string;
  name: string;
  colorHex: string;
  colorLabel?: string;
  organizationType?: string;
  base?: string;
  operations?: string;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
}

const defaultOperations =
  "Handel narkotykami, handel bronią, handel materiałami wybuchowymi, tworzenie materiałów wybuchowych, napady, wyłudzenia, porwania, strzelaniny, pranie pieniędzy";

const emptyForm = {
  name: "Ballas",
  colorHex: "#6d28d9",
  colorLabel: "Fioletowa",
  organizationType: "Gang uliczny",
  base: "Grove Street",
  operations: defaultOperations,
};

function normalizeId(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function CriminalGroupsPage() {
  const [groups, setGroups] = useState<CriminalGroup[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { session, logActivity } = useSessionActivity();

  useEffect(() => {
    const q = query(collection(db, "criminalGroups"), orderBy("name"));
    return onSnapshot(q, (snap) => {
      setGroups(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })));
    });
  }, []);

  useEffect(() => {
    if (!session) return;
    void logActivity({ type: "criminal_groups_view" });
  }, [session, logActivity]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter((group) =>
      [
        group.name,
        group.colorLabel,
        group.organizationType,
        group.base,
        group.operations,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle))
    );
  }, [groups, search]);

  const createGroup = async () => {
    try {
      setErr(null);
      setOk(null);
      setCreating(true);
      const name = form.name.trim();
      if (!name) {
        setErr("Podaj nazwę grupy.");
        return;
      }
      const colorHex = form.colorHex.trim();
      if (!/^#?[0-9a-fA-F]{6}$/.test(colorHex)) {
        setErr("Podaj prawidłowy kolor w formacie HEX (np. #6d28d9).");
        return;
      }
      const id = normalizeId(name);
      if (!id) {
        setErr("Nie udało się wygenerować identyfikatora grupy.");
        return;
      }
      if (groups.some((g) => g.id === id)) {
        setErr("Grupa o tej nazwie już istnieje.");
        return;
      }
      const payload = {
        name,
        colorHex: colorHex.startsWith("#") ? colorHex : `#${colorHex}`,
        colorLabel: form.colorLabel.trim() || undefined,
        organizationType: form.organizationType.trim() || undefined,
        base: form.base.trim() || undefined,
        operations: form.operations.trim() || undefined,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email || "",
        createdByUid: auth.currentUser?.uid || "",
      };
      await setDoc(doc(db, "criminalGroups", id), payload);
      await addDoc(collection(db, "logs"), {
        type: "criminal_group_create",
        groupId: id,
        name,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setForm(emptyForm);
      setOk("Grupa została utworzona.");
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Nie udało się utworzyć grupy.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Grupy przestępcze</title>
        </Head>
        <Nav />
        <div className="max-w-6xl mx-auto px-4 py-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-6">
            <div className="card p-5">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
                <h1 className="text-2xl font-bold">Grupy przestępcze</h1>
                <input
                  className="input md:w-72"
                  placeholder="Szukaj po nazwie, bazie, działalności..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {err && <div className="card bg-red-100 text-red-800 p-3 mb-3">{err}</div>}
              {ok && <div className="card bg-green-100 text-green-800 p-3 mb-3">{ok}</div>}
              <div className="grid gap-4">
                {filtered.map((group) => {
                  const gradient = `linear-gradient(135deg, ${group.colorHex}cc, ${group.colorHex}99)`;
                  return (
                    <Link
                      key={group.id}
                      href={`/criminal-groups/${group.id}`}
                      className="card p-4 text-white shadow-lg hover:shadow-2xl transition"
                      style={{
                        backgroundImage: gradient,
                        borderColor: `${group.colorHex}aa`,
                        boxShadow: `0 15px 40px -25px ${group.colorHex}`,
                      }}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm uppercase tracking-widest opacity-80">{group.colorLabel}</span>
                          {group.organizationType && (
                            <span className="px-2 py-1 text-[11px] uppercase tracking-wide bg-black/30 rounded-full border border-white/20">
                              {group.organizationType}
                            </span>
                          )}
                        </div>
                        <h2 className="text-xl font-bold drop-shadow">{group.name}</h2>
                        {group.base && (
                          <p className="text-sm opacity-90">Baza: {group.base}</p>
                        )}
                        {group.operations && (
                          <p className="text-sm opacity-80">Zakres działalności: {group.operations}</p>
                        )}
                      </div>
                    </Link>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="card p-4 text-sm text-beige-800 bg-white/60">
                    Brak wyników. Spróbuj innej frazy lub dodaj nową grupę poniżej.
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="card p-4 bg-[var(--card)]/80 border border-white/10">
            <h2 className="text-lg font-semibold mb-3">Dodaj nową grupę</h2>
            <p className="text-sm text-beige-700 mb-3">
              Utwórz teczkę grupy przestępczej. Domyślnie wypełniono dane gangu Ballas — możesz je
              zostawić lub zmodyfikować.
            </p>
            <div className="grid gap-3">
              <div>
                <label className="label">Nazwa</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Kolor HEX</label>
                <input
                  className="input"
                  value={form.colorHex}
                  onChange={(e) => setForm((prev) => ({ ...prev, colorHex: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Kolorystyka</label>
                <input
                  className="input"
                  value={form.colorLabel}
                  onChange={(e) => setForm((prev) => ({ ...prev, colorLabel: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Rodzaj organizacji</label>
                <input
                  className="input"
                  value={form.organizationType}
                  onChange={(e) => setForm((prev) => ({ ...prev, organizationType: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Baza grupy</label>
                <input
                  className="input"
                  value={form.base}
                  onChange={(e) => setForm((prev) => ({ ...prev, base: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Zakres działalności</label>
                <textarea
                  className="input h-28"
                  value={form.operations}
                  onChange={(e) => setForm((prev) => ({ ...prev, operations: e.target.value }))}
                />
              </div>
              <button className="btn" onClick={createGroup} disabled={creating}>
                {creating ? "Zapisywanie..." : "Utwórz grupę"}
              </button>
              <p className="text-xs text-beige-700/80">
                Po utworzeniu teczki możesz przypisywać członków, pojazdy oraz prowadzić notatki operacyjne.
              </p>
            </div>
          </div>
        </div>
      </>
    </AuthGate>
  );
}
