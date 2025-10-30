import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import AnnouncementSpotlight from "@/components/AnnouncementSpotlight";
import { useDialog } from "@/components/DialogProvider";
import { useSessionActivity } from "@/components/ActivityLogger";
import { getActiveVehicleFlags, getVehicleHighlightStyle } from "@/lib/vehicleFlags";
import type { VehicleFlagsState } from "@/lib/vehicleFlags";

interface VehicleFolder {
  id: string;
  registration: string;
  registrationNormalized: string;
  brand: string;
  color: string;
  ownerName: string;
  ownerCid: string;
  ownerCidNormalized: string;
  statuses?: VehicleFlagsState;
  createdAt?: any;
  updatedAt?: any;
}

const emptyForm = {
  registration: "",
  brand: "",
  color: "",
  ownerName: "",
  ownerCid: "",
};

export default function VehicleArchivePage() {
  const [vehicles, setVehicles] = useState<VehicleFolder[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { confirm } = useDialog();
  const { session, logActivity } = useSessionActivity();

  useEffect(() => {
    const q = query(collection(db, "vehicleFolders"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setVehicles(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })));
    });
  }, []);

  useEffect(() => {
    if (!session) return;
    void logActivity({ type: "vehicle_archive_view" });
  }, [session, logActivity]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return vehicles;
    return vehicles.filter((vehicle) =>
      [
        vehicle.registration,
        vehicle.brand,
        vehicle.color,
        vehicle.ownerName,
        vehicle.ownerCid,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle))
    );
  }, [vehicles, search]);

  const resetForm = () => setForm(emptyForm);

  const createVehicle = async () => {
    try {
      setErr(null);
      setOk(null);
      setCreating(true);
      const registration = form.registration.trim().toUpperCase();
      const brand = form.brand.trim();
      const color = form.color.trim();
      const ownerName = form.ownerName.trim();
      const ownerCid = form.ownerCid.trim();
      if (!registration || !brand || !color || !ownerName || !ownerCid) {
        setErr("Uzupełnij wszystkie pola pojazdu.");
        return;
      }
      const registrationNormalized = registration.replace(/\s+/g, "");
      const ownerCidNormalized = ownerCid.toLowerCase();
      if (vehicles.some((v) => v.registrationNormalized === registrationNormalized)) {
        setErr("Pojazd z takim numerem rejestracyjnym już istnieje.");
        return;
      }
      const payload = {
        registration,
        registrationNormalized,
        brand,
        color,
        ownerName,
        ownerCid,
        ownerCidNormalized,
        statuses: {},
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email || "",
        createdByUid: auth.currentUser?.uid || "",
      };
      await addDoc(collection(db, "vehicleFolders"), payload);
      await addDoc(collection(db, "logs"), {
        type: "vehicle_create",
        registration,
        ownerCid,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      resetForm();
      setOk("Teczka pojazdu została utworzona.");
    } catch (e: any) {
      setErr(e?.message || "Nie udało się utworzyć teczki pojazdu.");
    } finally {
      setCreating(false);
    }
  };

  const removeVehicle = async (vehicleId: string, registration: string) => {
    const okDialog = await confirm({
      title: "Usuń teczkę pojazdu",
      message: "Czy na pewno chcesz usunąć teczkę tego pojazdu wraz z notatkami?",
      confirmLabel: "Usuń",
      tone: "danger",
    });
    if (!okDialog) return;
    try {
      setErr(null);
      setOk(null);
      setDeletingId(vehicleId);
      const notesSnap = await getDocs(collection(db, "vehicleFolders", vehicleId, "notes"));
      const batch = writeBatch(db);
      notesSnap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
      batch.delete(doc(db, "vehicleFolders", vehicleId));
      await batch.commit();
      await addDoc(collection(db, "logs"), {
        type: "vehicle_delete",
        vehicleId,
        registration,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setOk("Teczka pojazdu została usunięta.");
    } catch (e: any) {
      setErr(e?.message || "Nie udało się usunąć teczki pojazdu.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AuthGate>
      <>
        <Head><title>LSPD 77RP — Archiwum pojazdów</title></Head>
        <Nav />
        <div className="max-w-6xl mx-auto px-4 py-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-6">
            <div className="section-shell section-shell--vehicles">
              <div className="section-shell__inner p-6 md:p-8 space-y-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <div className="space-y-1 flex-1">
                    <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.35em] text-emerald-100/80">
                      🚓 Archiwum pojazdów
                    </span>
                    <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-200 via-white to-sky-200 bg-clip-text text-transparent">
                      Pojazdy w ewidencji
                    </h1>
                    <p className="text-sm text-emerald-100/70 max-w-2xl">
                      Odnajdź pojazd po numerze rejestracyjnym, właścicielu lub stanie flag, aby przejść do szczegółowej karty.
                    </p>
                  </div>
                  <input
                    className="input w-full md:w-72 bg-black/40 border-emerald-200/40 focus:border-emerald-100/70"
                    placeholder="Szukaj po numerze, właścicielu, marce..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {err && <div className="rounded-2xl border border-red-400/40 bg-red-500/10 p-4 text-sm text-red-100">{err}</div>}
                {ok && <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 p-4 text-sm text-emerald-100">{ok}</div>}
                <div className="grid gap-3">
                  {filtered.map((vehicle) => {
                    const highlight = getVehicleHighlightStyle(vehicle.statuses);
                    const activeFlags = highlight?.active || getActiveVehicleFlags(vehicle.statuses);
                    return (
                      <a
                        key={vehicle.id}
                        href={`/vehicle-archive/${vehicle.id}`}
                        className={`group relative overflow-hidden rounded-2xl border border-emerald-200/25 bg-gradient-to-br from-slate-950/80 via-slate-900/60 to-slate-900/40 p-5 transition-all duration-300 hover:border-emerald-200/55 hover:shadow-2xl ${highlight ? "text-white" : "text-emerald-50"}`}
                        style={highlight?.style || undefined}
                      >
                        <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: "radial-gradient(circle at 80% -10%, rgba(56, 189, 248, 0.28), transparent 45%)" }} />
                        <div className="relative space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-semibold text-lg flex items-center gap-2">
                              <span className="text-xl">🚘</span> {vehicle.registration}
                            </div>
                            <span className="rounded-full border border-white/30 bg-white/10 px-3 py-0.5 text-xs font-semibold uppercase tracking-wide">
                              karta pojazdu
                            </span>
                          </div>
                          <div className="text-sm text-emerald-100/80">
                            {vehicle.brand || "—"} • Kolor: {vehicle.color || "—"}
                          </div>
                          <div className="text-xs text-emerald-100/70">Właściciel: {vehicle.ownerName || "—"} • CID: {vehicle.ownerCid || "—"}</div>
                          {activeFlags.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {activeFlags.map((flag) => (
                                <span
                                  key={flag.key}
                                  className="px-2.5 py-1 text-[11px] font-semibold rounded-full border border-emerald-200/50 bg-black/40 backdrop-blur"
                                >
                                  {flag.icon} {flag.label}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </a>
                    );
                  })}
                  {filtered.length === 0 && (
                    <div className="rounded-2xl border border-emerald-200/20 bg-black/30 p-5 text-sm text-emerald-100/70">
                      Brak pojazdów spełniających kryteria.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="section-shell section-shell--vehicles">
              <div className="section-shell__inner p-6 space-y-4">
                <div className="space-y-1">
                  <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.35em] text-emerald-100/80">
                    ➕ Nowy pojazd
                  </span>
                  <h2 className="text-xl font-semibold text-emerald-50">Dodaj pojazd</h2>
                  <p className="text-xs text-emerald-100/70">Wprowadź wszystkie pola, aby zarejestrować nowy pojazd w archiwum.</p>
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  <input className="input bg-black/40 border-emerald-200/40 focus:border-emerald-100/70" placeholder="Numer rejestracyjny" value={form.registration} onChange={(e) => setForm((prev) => ({ ...prev, registration: e.target.value }))} />
                  <input className="input bg-black/40 border-emerald-200/40 focus:border-emerald-100/70" placeholder="Marka" value={form.brand} onChange={(e) => setForm((prev) => ({ ...prev, brand: e.target.value }))} />
                  <input className="input bg-black/40 border-emerald-200/40 focus:border-emerald-100/70" placeholder="Kolor" value={form.color} onChange={(e) => setForm((prev) => ({ ...prev, color: e.target.value }))} />
                  <input className="input bg-black/40 border-emerald-200/40 focus:border-emerald-100/70" placeholder="Imię i nazwisko właściciela" value={form.ownerName} onChange={(e) => setForm((prev) => ({ ...prev, ownerName: e.target.value }))} />
                  <input className="input bg-black/40 border-emerald-200/40 focus:border-emerald-100/70" placeholder="CID właściciela" value={form.ownerCid} onChange={(e) => setForm((prev) => ({ ...prev, ownerCid: e.target.value }))} />
                </div>
                <div className="flex flex-wrap gap-3">
                  <button className="btn" onClick={createVehicle} disabled={creating}>
                    {creating ? "Tworzenie..." : "Dodaj"}
                  </button>
                  <button className="btn" onClick={resetForm} type="button">
                    Wyczyść
                  </button>
                </div>
              </div>
            </div>
          </div>
          <AnnouncementSpotlight />
        </div>
      </>
    </AuthGate>
  );
}
