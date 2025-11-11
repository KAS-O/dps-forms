import { useRouter } from "next/router";
import Head from "next/head";
import Nav from "@/components/Nav";
import AuthGate from "@/components/AuthGate";
import { useEffect, useMemo, useState, useCallback } from "react";
import type { CSSProperties } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  increment,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useDialog } from "@/components/DialogProvider";
import { useSessionActivity } from "@/components/ActivityLogger";
import { useProfile } from "@/hooks/useProfile";
import { VEHICLE_FLAGS, getActiveVehicleFlags, getVehicleHighlightStyle } from "@/lib/vehicleFlags";
import type { VehicleFlagsState, VehicleFlagKey } from "@/lib/vehicleFlags";

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

interface VehicleNote {
  id: string;
  text: string;
  createdAt?: any;
  author?: string;
  authorUid?: string;
  templateSlug?: string;
  templateName?: string;
  archiveId?: string;
  archiveUrl?: string;
  vehicleFolderId?: string;
  paymentAmount?: number;
  paymentLabel?: string;
  paymentStatus?: "pending" | "paid" | "unpaid";
  paymentStatusMessage?: string;
  paymentResolvedAt?: any;
  paymentResolvedBy?: string;
  paymentResolvedByUid?: string;
}

const emptyForm = {
  registration: "",
  brand: "",
  color: "",
  ownerName: "",
  ownerCid: "",
};

export default function VehicleFolderPage() {
  const router = useRouter();
  const { id } = router.query as { id: string };
  const { confirm, prompt, alert } = useDialog();
  const { session, logActivity } = useSessionActivity();
  const { login: profileLogin, fullName: profileFullName } = useProfile();

  const buildActor = useCallback(
    () => ({
      author: auth.currentUser?.email || "",
      authorUid: auth.currentUser?.uid || "",
      authorLogin: profileLogin || "",
      authorFullName: profileFullName || "",
    }),
    [profileFullName, profileLogin]
  );

  const [vehicle, setVehicle] = useState<VehicleFolder | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [notes, setNotes] = useState<VehicleNote[]>([]);
  const [noteText, setNoteText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [ownerDossierId, setOwnerDossierId] = useState<string | null>(null);
  const [paymentProcessingId, setPaymentProcessingId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const ref = doc(db, "vehicleFolders", id);
    return onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        setVehicle(null);
        setErr("Teczka pojazdu nie istnieje.");
        return;
      }
      const data = snap.data() as any;
      setVehicle({ id: snap.id, ...(data as VehicleFolder) });
      setForm({
        registration: data.registration || "",
        brand: data.brand || "",
        color: data.color || "",
        ownerName: data.ownerName || "",
        ownerCid: data.ownerCid || "",
      });
      setErr(null);
    });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const q = query(collection(db, "vehicleFolders", id, "notes"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setNotes(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })));
    });
  }, [id]);

  useEffect(() => {
    if (!vehicle?.ownerCidNormalized) {
      setOwnerDossierId(null);
      return;
    }
    (async () => {
      const dossierRef = doc(db, "dossiers", vehicle.ownerCidNormalized);
      const dossierSnap = await getDoc(dossierRef);
      setOwnerDossierId(dossierSnap.exists() ? dossierSnap.id : null);
    })();
  }, [vehicle?.ownerCidNormalized]);

  useEffect(() => {
    if (!id || !session) return;
    void logActivity({ type: "vehicle_folder_view", vehicleId: id });
  }, [id, session, logActivity]);

  const highlight = useMemo(() => getVehicleHighlightStyle(vehicle?.statuses), [vehicle?.statuses]);
  const activeFlags = highlight?.active || getActiveVehicleFlags(vehicle?.statuses);
  const accentColor = useMemo(() => {
    const border = (highlight?.style as CSSProperties | undefined)?.borderColor;
    if (typeof border === "string" && border.trim().length > 0) {
      return border;
    }
    return "#0ea5e9";
  }, [highlight?.style]);
  const baseHeaderStyle = useMemo(
    () => ({
      borderColor: `${accentColor}90`,
      background: `linear-gradient(135deg, ${accentColor}33, rgba(7, 18, 34, 0.92))`,
      boxShadow: `0 32px 70px -26px ${accentColor}aa`,
    }),
    [accentColor]
  );
  const headerStyle = useMemo(
    () => (highlight?.style ? { ...baseHeaderStyle, ...highlight.style } : baseHeaderStyle),
    [baseHeaderStyle, highlight]
  );

  const saveDetails = async () => {
    if (!id) return;
    try {
      setErr(null);
      setOk(null);
      setSaving(true);
      const registration = form.registration.trim().toUpperCase();
      const brand = form.brand.trim();
      const color = form.color.trim();
      const ownerName = form.ownerName.trim();
      const ownerCid = form.ownerCid.trim();
      if (!registration || !brand || !color || !ownerName || !ownerCid) {
        setErr("Uzupełnij wszystkie pola przed zapisaniem.");
        return;
      }
      const registrationNormalized = registration.replace(/\s+/g, "");
      const ownerCidNormalized = ownerCid.toLowerCase();
      const changes: Record<string, { before: string; after: string }> = {};
      const current = vehicle || ({} as VehicleFolder);
      const nextValues: Record<string, string> = { registration, brand, color, ownerName, ownerCid };
      (Object.keys(nextValues) as (keyof typeof nextValues)[]).forEach((key) => {
        const after = nextValues[key];
        const before = (current as any)?.[key] || "";
        if (before !== after) {
          changes[key] = { before, after };
        }
      });

      await updateDoc(doc(db, "vehicleFolders", id), {
        registration,
        registrationNormalized,
        brand,
        color,
        ownerName,
        ownerCid,
        ownerCidNormalized,
        updatedAt: serverTimestamp(),
      });
      await addDoc(collection(db, "logs"), {
        type: "vehicle_update",
        vehicleId: id,
        registration,
        ownerCid,
        ownerName,
        brand,
        color,
        changes,
        ...buildActor(),
        ts: serverTimestamp(),
      });
      setOk("Zapisano zmiany w teczce pojazdu.");
    } catch (e: any) {
      setErr(e?.message || "Nie udało się zapisać zmian.");
    } finally {
      setSaving(false);
    }
  };

  const deleteVehicle = async () => {
    if (!id) return;
    const okDialog = await confirm({
      title: "Usuń teczkę pojazdu",
      message: "Czy na pewno chcesz usunąć teczkę tego pojazdu wraz z notatkami?",
      confirmLabel: "Usuń",
      tone: "danger",
    });
    if (!okDialog) return;
    try {
      setErr(null);
      setDeleting(true);
      const notesSnap = await getDocs(collection(db, "vehicleFolders", id, "notes"));
      const batch = writeBatch(db);
      notesSnap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
      batch.delete(doc(db, "vehicleFolders", id));
      await batch.commit();
      await addDoc(collection(db, "logs"), {
        type: "vehicle_delete",
        vehicleId: id,
        registration: vehicle?.registration || "",
        brand: vehicle?.brand || "",
        ownerName: vehicle?.ownerName || "",
        ownerCid: vehicle?.ownerCid || "",
        ...buildActor(),
        ts: serverTimestamp(),
      });
      await router.replace("/vehicle-archive");
    } catch (e: any) {
      setErr(e?.message || "Nie udało się usunąć teczki.");
    } finally {
      setDeleting(false);
    }
  };

  const toggleFlag = async (flagKey: VehicleFlagKey) => {
    if (!id) return;
    try {
      setErr(null);
      const current = !!vehicle?.statuses?.[flagKey];
      await updateDoc(doc(db, "vehicleFolders", id), {
        [`statuses.${flagKey}`]: !current,
        updatedAt: serverTimestamp(),
      });
      await addDoc(collection(db, "logs"), {
        type: "vehicle_flag_update",
        vehicleId: id,
        flag: flagKey,
        value: !current,
        flagLabel: VEHICLE_FLAGS[flagKey]?.label || flagKey,
        ...buildActor(),
        ts: serverTimestamp(),
      });
    } catch (e: any) {
      setErr(e?.message || "Nie udało się zmienić oznaczenia.");
    }
  };

  const addNote = async () => {
    if (!id) return;
    if (!noteText.trim()) {
      setErr("Notatka nie może być pusta.");
      return;
    }
    try {
      setErr(null);
      setNoteSaving(true);
      await addDoc(collection(db, "vehicleFolders", id, "notes"), {
        text: noteText.trim(),
        createdAt: serverTimestamp(),
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
      });
      await addDoc(collection(db, "logs"), {
        type: "vehicle_note_add",
        vehicleId: id,
        notePreview: noteText.trim(),
        ...buildActor(),
        ts: serverTimestamp(),
      });
      setNoteText("");
    } catch (e: any) {
      setErr(e?.message || "Nie udało się dodać notatki.");
    } finally {
      setNoteSaving(false);
    }
  };

  const editNote = async (noteId: string, currentText: string) => {
    const newText = await prompt({
      title: "Edytuj notatkę",
      message: "Zaktualizuj treść notatki pojazdu.",
      defaultValue: currentText,
      multiline: true,
      confirmLabel: "Zapisz",
    });
    if (newText == null) return;
    if (!newText.trim()) {
      await alert({
        title: "Pusta notatka",
        message: "Treść notatki nie może być pusta.",
        tone: "info",
      });
      return;
    }
    if (!id) return;
    try {
      setErr(null);
      await updateDoc(doc(db, "vehicleFolders", id, "notes", noteId), {
        text: newText.trim(),
      });
      await addDoc(collection(db, "logs"), {
        type: "vehicle_note_edit",
        vehicleId: id,
        noteId,
        previousText: currentText,
        nextText: newText.trim(),
        notePreview: newText.trim(),
        ...buildActor(),
        ts: serverTimestamp(),
      });
    } catch (e: any) {
      setErr(e?.message || "Nie udało się zaktualizować notatki.");
    }
  };

  const removeNote = async (noteId: string) => {
    const okDialog = await confirm({
      title: "Usuń notatkę",
      message: "Czy na pewno chcesz usunąć tę notatkę?",
      confirmLabel: "Usuń",
      tone: "danger",
    });
    if (!okDialog || !id) return;
    try {
      setErr(null);
      const existing = notes.find((n) => n.id === noteId);
      await deleteDoc(doc(db, "vehicleFolders", id, "notes", noteId));
      await addDoc(collection(db, "logs"), {
        type: "vehicle_note_delete",
        vehicleId: id,
        noteId,
        notePreview: existing?.text || "",
        ...buildActor(),
        ts: serverTimestamp(),
      });
    } catch (e: any) {
      setErr(e?.message || "Nie udało się usunąć notatki.");
    }
  };

  const handlePaymentStatus = async (note: VehicleNote, status: "paid" | "unpaid") => {
    if (!id) return;
    try {
      setErr(null);
      setOk(null);
      setPaymentProcessingId(note.id);

      const amount = Number(note.paymentAmount || 0);
      if (status === "paid" && amount > 0) {
        const accRef = doc(db, "accounts", "dps");
        await setDoc(accRef, { manualDelta: 0, createdAt: serverTimestamp() }, { merge: true });
        await updateDoc(accRef, { manualDelta: increment(amount) });
      }

      const updates: Record<string, any> = {
        paymentStatus: status,
        paymentResolvedAt: serverTimestamp(),
        paymentResolvedBy: auth.currentUser?.email || "",
        paymentResolvedByUid: auth.currentUser?.uid || "",
      };
      updates.paymentStatusMessage =
        status === "paid"
          ? "Status płatności: mandat/grzywna opłacona."
          : "Status płatności: nie uregulowano spłaty grzywny.";
      updates.paymentCredited = status === "paid" && amount > 0;

      await updateDoc(doc(db, "vehicleFolders", id, "notes", note.id), updates);
      await addDoc(collection(db, "logs"), {
        type: "vehicle_note_payment",
        vehicleId: id,
        noteId: note.id,
        status,
        amount: Number.isFinite(amount) ? amount : 0,
        ...buildActor(),
        ts: serverTimestamp(),
      });

      setOk(
        status === "paid"
          ? "Zaksięgowano spłatę grzywny na koncie LSPD."
          : "Zapisano informację o braku spłaty grzywny."
      );
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Nie udało się zaktualizować statusu płatności.");
    } finally {
      setPaymentProcessingId(null);
    }
  };

  const title = vehicle ? `Pojazd ${vehicle.registration}` : "Teczka pojazdu";

  return (
    <AuthGate>
      <>
        <Head><title>LSPD 77RP — {title}</title></Head>
        <Nav />
        <div className="max-w-5xl mx-auto px-4 py-6 grid gap-4">
          {err && <div className="card p-3 bg-red-50 text-red-700" data-section="vehicle">{err}</div>}
          {ok && <div className="card p-3 bg-green-50 text-green-700" data-section="vehicle">{ok}</div>}

          <div
            className="card p-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between text-white"
            data-section="vehicle"
            style={headerStyle}
          >
            <div className="space-y-3">
              <span className="section-chip">
                <span className="section-chip__dot" style={{ background: accentColor }} />
                Teczka pojazdu
              </span>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
                  <span aria-hidden>🚔</span>
                  {vehicle?.registration || "Teczka pojazdu"}
                </h1>
                <div className="text-sm text-white/75">
                  Aktualizacja: {vehicle?.updatedAt?.toDate?.()?.toLocaleString?.() || vehicle?.createdAt?.toDate?.()?.toLocaleString?.() || "—"}
                </div>
                {ownerDossierId && (
                  <div className="mt-1 text-sm text-white/70">
                    Powiązana teczka osoby:{" "}
                    <a className="underline" href={`/dossiers/${ownerDossierId}`}>
                      zobacz dossier
                    </a>
                  </div>
                )}
              </div>
              {activeFlags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {activeFlags.map((flag) => (
                    <span key={flag.key} className="px-2 py-1 text-xs font-semibold rounded-full border border-white/40 bg-white/10">
                      {flag.icon} {flag.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button className="btn bg-red-700 text-white" onClick={deleteVehicle} disabled={deleting}>
              {deleting ? "Usuwanie..." : "Usuń teczkę"}
            </button>
          </div>

          <div className="card p-6 grid gap-4" data-section="vehicle">
            <div>
              <h2 className="text-2xl font-semibold flex items-center gap-2">
                <span aria-hidden>📑</span>
                Dane pojazdu
              </h2>
              <p className="text-sm text-beige-100/70">Zaktualizuj informacje identyfikacyjne pojazdu.</p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-1">
                <label className="label">Numer rejestracyjny</label>
                <input className="input" value={form.registration} onChange={(e) => setForm((prev) => ({ ...prev, registration: e.target.value }))} />
              </div>
              <div className="grid gap-1">
                <label className="label">Marka</label>
                <input className="input" value={form.brand} onChange={(e) => setForm((prev) => ({ ...prev, brand: e.target.value }))} />
              </div>
              <div className="grid gap-1">
                <label className="label">Kolor</label>
                <input className="input" value={form.color} onChange={(e) => setForm((prev) => ({ ...prev, color: e.target.value }))} />
              </div>
              <div className="grid gap-1">
                <label className="label">Właściciel</label>
                <input className="input" value={form.ownerName} onChange={(e) => setForm((prev) => ({ ...prev, ownerName: e.target.value }))} />
              </div>
              <div className="grid gap-1">
                <label className="label">CID właściciela</label>
                <input className="input" value={form.ownerCid} onChange={(e) => setForm((prev) => ({ ...prev, ownerCid: e.target.value }))} />
              </div>
            </div>
            <button className="btn w-full md:w-auto" onClick={saveDetails} disabled={saving}>
              {saving ? "Zapisywanie..." : "Zapisz dane"}
            </button>
          </div>

          <div className="card p-6 grid gap-4" data-section="vehicle">
            <div>
              <h2 className="text-2xl font-semibold flex items-center gap-2">
                <span aria-hidden>🚨</span>
                Oznaczenia
              </h2>
              <p className="text-sm text-beige-100/70">Zaznacz statusy przypisane do pojazdu.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {VEHICLE_FLAGS.map((flag) => {
                const active = !!vehicle?.statuses?.[flag.key];
                return (
                  <button
                    key={flag.key}
                    className={`btn w-full flex flex-col items-start gap-1 text-left ${active ? "text-white" : ""}`}
                    style={active ? { background: flag.color, borderColor: flag.color } : undefined}
                    onClick={() => toggleFlag(flag.key)}
                  >
                    <span className="font-semibold text-base">{flag.icon} {flag.label}</span>
                    <span className="text-xs opacity-80">{flag.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="card p-6 grid gap-4" data-section="vehicle">
            <div>
              <h2 className="text-2xl font-semibold flex items-center gap-2">
                <span aria-hidden>📝</span>
                Dodaj notatkę
              </h2>
              <p className="text-sm text-beige-100/70">Utrwal obserwacje funkcjonariuszy dotyczące pojazdu.</p>
            </div>
            <textarea
              className="input h-28"
              placeholder="Opis sytuacji, ustalenia..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <button className="btn" onClick={addNote} disabled={noteSaving}>
                {noteSaving ? "Dodawanie..." : "Dodaj notatkę"}
              </button>
              <button className="btn" onClick={() => setNoteText("")}>Wyczyść</button>
            </div>
          </div>

          <div className="grid gap-2">
           {notes.map((note) => {
              const createdLabel = note.createdAt?.toDate?.()?.toLocaleString?.() || "—";
              const resolvedLabel = note.paymentResolvedAt?.toDate?.()?.toLocaleString?.();
              const hasAmount = typeof note.paymentAmount === "number" && !Number.isNaN(note.paymentAmount);
              const amountLabel = hasAmount ? `$${note.paymentAmount.toFixed(2)}` : null;
              const paymentMessage =
                note.paymentStatusMessage ||
                (note.paymentStatus === "pending"
                  ? "Status płatności: oczekuje na rozliczenie."
                  : note.paymentStatus === "paid"
                  ? "Status płatności: mandat/grzywna opłacona."
                  : note.paymentStatus === "unpaid"
                  ? "Status płatności: nie uregulowano spłaty grzywny."
                  : null);

              return (
                <div key={note.id} className="card p-4" data-section="vehicle">
                  <div className="text-sm text-white/80 mb-1">
                    {createdLabel} • {note.author || note.authorUid || ""}
                  </div>
                  <div className="whitespace-pre-wrap mb-2 text-white/90">{note.text}</div>
                  {note.paymentStatus && paymentMessage && (
                    <div className="mb-2 text-sm font-semibold text-white">
                      {paymentMessage}
                      {amountLabel && (
                        <span className="font-normal text-white/80"> {" "}• {note.paymentLabel || "Kwota"}: {amountLabel}</span>
                      )}
                    </div>
                  )}
                  {note.paymentStatus && note.paymentStatus !== "pending" && resolvedLabel && (
                    <div className="mb-2 text-xs text-white/70">
                      Zaktualizowano {resolvedLabel} przez {note.paymentResolvedBy || note.paymentResolvedByUid || "—"}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {note.paymentStatus === "pending" && (
                      <>
                        <button
                          className="btn bg-green-700 text-white"
                          onClick={() => handlePaymentStatus(note, "paid")}
                          disabled={paymentProcessingId === note.id}
                        >
                          {paymentProcessingId === note.id ? "Przetwarzanie..." : "Mandat/Grzywnę opłacono"}
                        </button>
                        <button
                          className="btn bg-red-700 text-white"
                          onClick={() => handlePaymentStatus(note, "unpaid")}
                          disabled={paymentProcessingId === note.id}
                        >
                          {paymentProcessingId === note.id ? "Przetwarzanie..." : "Nie uregulowano zapłaty"}
                        </button>
                      </>
                    )}
                    <button className="btn" onClick={() => editNote(note.id, note.text)}>Edytuj</button>
                    <button className="btn bg-red-700 text-white" onClick={() => removeNote(note.id)}>Usuń</button>
                  </div>
                </div>
               );
            })}
            {notes.length === 0 && <div className="card p-3">Brak notatek.</div>}
          </div>
        </div>
      </>
    </AuthGate>
  );
}
