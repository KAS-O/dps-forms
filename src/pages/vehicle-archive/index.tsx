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
            <div className="card p-4">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <h1 className="text-2xl font-bold">Archiwum pojazdów</h1>
                <input
                  className="input w-full md:w-64 ml-auto"
                  placeholder="Szukaj po numerze, właścicielu, marce..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {err && <div className="card bg-red-50 text-red-700 p-3 mb-3">{err}</div>}
              {ok && <div className="card bg-green-50 text-green-700 p-3 mb-3">{ok}</div>}
              <div className="grid gap-3">
                {filtered.map((vehicle) => {
                  const highlight = getVehicleHighlightStyle(vehicle.statuses);
                  const activeFlags = highlight?.active || getActiveVehicleFlags(vehicle.statuses);
                  return (
                    <a
                      key={vehicle.id}
                      href={`/vehicle-archive/${vehicle.id}`}
                      className={`card p-4 transition hover:shadow-xl ${highlight ? "text-white" : ""}`}
                      style={highlight?.style || undefined}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-xl font-semibold">{vehicle.registration}</h2>
                          <span className="text-sm opacity-80">{vehicle.brand}</span>
                          <span className="text-sm opacity-80">Kolor: {vehicle.color}</span>
                        </div>
                        <div className="text-sm opacity-80">
                          Właściciel: {vehicle.ownerName} • CID: {vehicle.ownerCid || "—"}
                        </div>
                        {activeFlags.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {activeFlags.map((flag) => (
                              <span
                                key={flag.key}
                                className="px-2 py-1 text-xs font-semibold rounded-full bg-black/30 border border-white/40"
                              >
                                {flag.icon} {flag.label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex justify-end">
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
                {filtered.length === 0 && <p>Brak pojazdów w archiwum.</p>}
              </div>
            </div>
          </div>

          <div className="card p-4">
            <h2 className="font-semibold mb-3">Dodaj pojazd</h2>
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
            <button className="btn mt-4" onClick={createVehicle} disabled={creating}>
              {creating ? "Tworzenie..." : "Utwórz teczkę"}
            </button>
          </div>
          <AnnouncementSpotlight />
        </div>
      </>
    </AuthGate>
  );
}
