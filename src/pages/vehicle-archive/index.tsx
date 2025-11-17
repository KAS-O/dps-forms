import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useLogWriter } from "@/hooks/useLogWriter";
import { useDialog } from "@/components/DialogProvider";
import { useSessionActivity } from "@/components/ActivityLogger";
import { getActiveVehicleFlags, getVehicleHighlightStyle } from "@/lib/vehicleFlags";
import type { VehicleFlagsState } from "@/lib/vehicleFlags";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { UnitsPanel } from "@/components/UnitsPanel";
import { AccountPanel } from "@/components/AccountPanel";

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
  const { writeLog } = useLogWriter();
  const accentColor = "#0ea5e9";
  const viewLoggedRef = useRef(false);

  useEffect(() => {
    const q = query(collection(db, "vehicleFolders"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setVehicles(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })));
    });
  }, []);

  useEffect(() => {
    if (!session || viewLoggedRef.current) return;
    viewLoggedRef.current = true;
    void logActivity({ type: "vehicle_archive_view", vehiclesTotal: vehicles.length });
  }, [session, logActivity, vehicles.length]);

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
      await writeLog({
        type: "vehicle_create",
        section: "archiwum-pojazdow",
        action: "vehicle.create",
        message: `Utworzono teczkę pojazdu ${registration} (właściciel: ${ownerName}, CID: ${ownerCid}).`,
        details: {
          rejestracja: registration,
          marka: brand,
          kolor: color,
          "imię i nazwisko właściciela": ownerName,
          "CID właściciela": ownerCid,
        },
        registration,
        ownerCid,
        brand,
        color,
        ownerName,
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
      await writeLog({
        type: "vehicle_delete",
        section: "archiwum-pojazdow",
        action: "vehicle.delete",
        message: `Usunięto teczkę pojazdu ${registration} wraz z ${notesSnap.size} notatkami.`,
        details: {
          rejestracja: registration,
          "liczba usuniętych notatek": notesSnap.size,
        },
        vehicleId,
        registration,
        removedNotes: notesSnap.size,
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
        <Nav showSidebars={false} />
        <DashboardLayout
          left={<UnitsPanel />}
          center={(
            <section className="grid gap-6" data-section="vehicle">
              <div className="card p-6 space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-2">
                    <span className="section-chip">
                      <span className="section-chip__dot" style={{ background: accentColor }} />
                      Archiwum pojazdów
                    </span>
                    <div>
                      <h1 className="text-3xl font-semibold tracking-tight">Rejestr pojazdów LSPD</h1>
                      <p className="text-sm text-beige-100/75">
                        Przeglądaj i aktualizuj teczki pojazdów zabezpieczonych podczas działań operacyjnych.
                      </p>
                    </div>
                  </div>
                  <input
                    className="input w-full md:w-72"
                    placeholder="Szukaj po numerze, właścicielu, marce..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {err && <div className="card bg-red-50 text-red-700 p-3 mb-3" data-section="vehicle">{err}</div>}
                {ok && <div className="card bg-green-50 text-green-700 p-3 mb-3" data-section="vehicle">{ok}</div>}
                <div className="grid gap-3">
                  {filtered.map((vehicle) => {
                    const highlight = getVehicleHighlightStyle(vehicle.statuses);
                    const activeFlags = highlight?.active || getActiveVehicleFlags(vehicle.statuses);
                    const defaultStyle = {
                      borderColor: `${accentColor}90`,
                      background: `linear-gradient(140deg, ${accentColor}33, rgba(7, 24, 38, 0.85))`,
                      boxShadow: `0 26px 60px -26px ${accentColor}aa`,
                    };
                    const style = highlight?.style ? { ...defaultStyle, ...highlight.style } : defaultStyle;
                    return (
                      <a
                        key={vehicle.id}
                        href={`/vehicle-archive/${vehicle.id}`}
                        className="card p-5 transition hover:-translate-y-0.5 text-white"
                        data-section="vehicle"
                        style={style}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold text-xl flex items-center gap-2">
                            <span aria-hidden>🚔</span>
                            {vehicle.registration}
                          </div>
                          <span className="text-xs uppercase tracking-[0.35em] text-white/70">
                            {vehicle.createdAt?.toDate?.()?.toLocaleDateString?.() || "—"}
                          </span>
                        </div>
                        <div className="text-sm text-white/80">
                          {vehicle.brand} • Kolor: {vehicle.color}
                        </div>
                        <div className="text-xs text-white/70">Właściciel: {vehicle.ownerName} • CID: {vehicle.ownerCid || "—"}</div>
                        {activeFlags.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {activeFlags.map((flag) => (
                              <span
                                key={flag.key}
                                className="px-2 py-1 text-xs font-semibold rounded-full border border-white/30 bg-white/10"
                              >
                                {flag.icon} {flag.label}
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="mt-4 flex justify-end">
                          <button
                            className="btn bg-red-700 text-white"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              void removeVehicle(vehicle.id, vehicle.registration);
                            }}
                            disabled={deletingId === vehicle.id}
                          >
                            {deletingId === vehicle.id ? "Usuwanie..." : "Usuń"}
                          </button>
                        </div>
                      </a>
                    );
                  })}
                  {filtered.length === 0 && (
                    <div className="card p-4 text-sm text-white/75" data-section="vehicle">
                      Brak pojazdów w archiwum spełniających kryteria.
                    </div>
                  )}
                </div>
              </div>

              <div className="card p-6 space-y-4">
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold flex items-center gap-2">
                    <span className="text-2xl" aria-hidden>🛠️</span>
                    Dodaj pojazd
                  </h2>
                  <p className="text-sm text-beige-100/70">
                    Uzupełnij dane pojazdu, aby utworzyć nową teczkę w archiwum.
                  </p>
                </div>
                <div className="grid gap-2">
                  <input
                    className="input"
                    placeholder="Numer rejestracyjny"
                    value={form.registration}
                    onChange={(e) => setForm((prev) => ({ ...prev, registration: e.target.value }))}
                  />
                  <input
                    className="input"
                    placeholder="Marka"
                    value={form.brand}
                    onChange={(e) => setForm((prev) => ({ ...prev, brand: e.target.value }))}
                  />
                  <input
                    className="input"
                    placeholder="Kolor"
                    value={form.color}
                    onChange={(e) => setForm((prev) => ({ ...prev, color: e.target.value }))}
                  />
                  <input
                    className="input"
                    placeholder="Imię i nazwisko właściciela"
                    value={form.ownerName}
                    onChange={(e) => setForm((prev) => ({ ...prev, ownerName: e.target.value }))}
                  />
                  <input
                    className="input"
                    placeholder="CID właściciela"
                    value={form.ownerCid}
                    onChange={(e) => setForm((prev) => ({ ...prev, ownerCid: e.target.value }))}
                  />
                </div>
                <button className="btn w-full md:w-auto" onClick={createVehicle} disabled={creating}>
                  {creating ? "Tworzenie..." : "Utwórz teczkę"}
                </button>
              </div>
            </section>
          )}
          right={<AccountPanel />}
        />
      </>
    </AuthGate>
  );
}
