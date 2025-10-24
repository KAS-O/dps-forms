import { useRouter } from "next/router";
import Head from "next/head";
import Nav from "@/components/Nav";
import AuthGate from "@/components/AuthGate";
import { useEffect, useMemo, useState } from "react";
import { auth, db, storage } from "@/lib/firebase";
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
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useProfile } from "@/hooks/useProfile";
import { useDialog } from "@/components/DialogProvider";
import { useSessionActivity } from "@/components/ActivityLogger";
import { getActiveVehicleFlags, getVehicleHighlightStyle } from "@/lib/vehicleFlags";

export default function DossierPage() {
  const router = useRouter();
  const { id } = router.query as { id: string };
  const { role } = useProfile();

  const [title, setTitle] = useState<string>("");
  const [info, setInfo] = useState<{ first?: string; last?: string; cid?: string }>({});
  const [records, setRecords] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [txt, setTxt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { confirm, prompt, alert } = useDialog();
  const { logActivity, session } = useSessionActivity();

  // uprawnienia do edycji wpisu: Director/Chief lub autor wpisu
 const canDeleteDossier = role === "director";
  const canEditRecord = (r: any) => {
    const me = auth.currentUser?.uid;
    return (role === "director" || role === "chief" || (!!me && r.authorUid === me));
  };

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const refDoc = doc(db, "dossiers", id);
        const snap = await getDoc(refDoc);
        const data = (snap.data() || {}) as any;
        setTitle((data.title || "") as string);
        setInfo({ first: data.first, last: data.last, cid: data.cid });
      } catch (e: any) {
        setErr(e.message || "Błąd teczki");
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const q = query(collection(db, "dossiers", id, "records"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setRecords(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    });
  }, [id]);
  
  useEffect(() => {
    if (!id) return;
    const q = query(collection(db, "vehicleFolders"), where("ownerCidNormalized", "==", id));
    return onSnapshot(q, (snap) => {
      setVehicles(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    });
  }, [id]);
  
  useEffect(() => {
    if (!id || !session) return;
    void logActivity({ type: "dossier_view", dossierId: id });
  }, [id, logActivity, session]);

  const addRecord = async () => {
    try {
      setErr(null);
      const payload: any = {
        text: txt || "",
        createdAt: serverTimestamp(),
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        type: "note",
      };

      if (file) {
        const fref = ref(storage, `dossiers/${id}/evidence/${Date.now()}_${file.name}`);
        await uploadBytes(fref, file);
        const url = await getDownloadURL(fref);
        payload.imageUrl = url;
      }

      await addDoc(collection(db, "dossiers", id, "records"), payload);
      await addDoc(collection(db, "logs"), {
        type: "dossier_record_add",
        dossierId: id,
        author: auth.currentUser?.email || "",
        ts: serverTimestamp(),
      });

      setTxt("");
      setFile(null);
    } catch (e: any) {
      setErr(e.message || "Nie udało się dodać wpisu");
    }
  };

  const editRecord = async (rid: string, currentText: string) => {
    const t = await prompt({
      title: "Edycja wpisu",
      message: "Zaktualizuj treść notatki. Możesz wprowadzić wielolinijkowy opis.",
      defaultValue: currentText,
      multiline: true,
      inputLabel: "Treść wpisu",
      confirmLabel: "Zapisz zmiany",
    });
    if (t == null) return;
    if (!t.trim()) {
      await alert({
        title: "Puste pole",
        message: "Treść wpisu nie może być pusta.",
        tone: "info",
      });
      return;
    }
    await updateDoc(doc(db, "dossiers", id, "records", rid), { text: t });
    await addDoc(collection(db, "logs"), {
      type: "dossier_record_edit",
      dossierId: id,
      recordId: rid,
      author: auth.currentUser?.email || "",
      ts: serverTimestamp(),
    });
  };

  const deleteRecord = async (rid: string) => {
    const ok = await confirm({
      title: "Usuń wpis",
      message: "Czy na pewno chcesz usunąć ten wpis z teczki?",
      confirmLabel: "Usuń",
      tone: "danger",
    });
    if (!ok) return;
    await deleteDoc(doc(db, "dossiers", id, "records", rid));
    await addDoc(collection(db, "logs"), {
      type: "dossier_record_delete",
      dossierId: id,
      recordId: rid,
      author: auth.currentUser?.email || "",
      ts: serverTimestamp(),
    });
  };

  const deleteDossier = async () => {
    if (!id || !canDeleteDossier) return;
    const ok = await confirm({
      title: "Usuń teczkę",
      message: "Na pewno usunąć całą teczkę wraz z wszystkimi wpisami? Tej operacji nie można cofnąć.",
      confirmLabel: "Usuń teczkę",
      tone: "danger",
    });
    if (!ok) return;
    try {
      setErr(null);
      setDeleting(true);
      const recordsSnap = await getDocs(collection(db, "dossiers", id, "records"));
      const batch = writeBatch(db);
      recordsSnap.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      batch.delete(doc(db, "dossiers", id));
      await batch.commit();
      await addDoc(collection(db, "logs"), {
        type: "dossier_delete",
        dossierId: id,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      await router.replace("/dossiers");
    } catch (e: any) {
      setErr(e?.message || "Nie udało się usunąć teczki.");
    } finally {
      setDeleting(false);
    }
  };

  const personTitle = useMemo(() => {
    const n = [info.first, info.last].filter(Boolean).join(" ");
    return n ? `${title} • ${n} (CID: ${info.cid || "?"})` : title || "Teczka";
  }, [title, info]);

  return (
    <AuthGate>
      <>
        <Head><title>LSPD 77RP — {personTitle}</title></Head>
        <Nav />
        <div className="max-w-5xl mx-auto px-4 py-6 grid gap-4">
          {err && <div className="card p-3 bg-red-50 text-red-700">{err}</div>}

          <div className="card p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h1 className="text-xl font-bold">{personTitle}</h1>
            {canDeleteDossier && (
              <button
                className="btn bg-red-700 text-white"
                onClick={deleteDossier}
                disabled={deleting}
              >
                {deleting ? "Usuwanie..." : "Usuń teczkę"}
              </button>
            )}
          </div>

          <div className="card p-4 grid gap-3">
            <h2 className="font-semibold">Powiązane pojazdy</h2>
            {vehicles.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {vehicles.map((vehicle) => {
                  const highlight = getVehicleHighlightStyle(vehicle?.statuses);
                  const activeFlags = highlight?.active || getActiveVehicleFlags(vehicle?.statuses);
                  return (
                    <a
                      key={vehicle.id}
                      href={`/vehicle-archive/${vehicle.id}`}
                      className={`card p-3 transition hover:shadow-xl ${highlight ? "text-white" : ""}`}
                      style={highlight?.style || undefined}
                      onClick={() => {
                        if (!session) return;
                        void logActivity({ type: "vehicle_from_dossier_open", dossierId: id, vehicleId: vehicle.id });
                      }}
                    >
                      <div className="font-semibold text-lg">{vehicle.registration}</div>
                      <div className="text-sm opacity-80">{vehicle.brand} • Kolor: {vehicle.color}</div>
                      <div className="text-sm opacity-80">Właściciel: {vehicle.ownerName}</div>
                      {activeFlags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
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
                    </a>
                  );
                })}
              </div>
            ) : (
              <p>Brak powiązanych pojazdów.</p>
            )}
          </div>

          {/* Dodaj wpis (tekst opcjonalnie ze zdjęciem) */}
          <div className="card p-4 grid gap-2">
            <h2 className="font-semibold mb-2">Dodaj wpis</h2>
            <textarea
              className="input h-28"
              placeholder="Treść wpisu (opcjonalnie)…"
              value={txt}
              onChange={(e) => setTxt(e.target.value)}
            />
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <div className="flex gap-2">
              <button className="btn" onClick={addRecord}>Dodaj</button>
              <button className="btn" onClick={() => { setTxt(""); setFile(null); }}>Wyczyść</button>
            </div>
          </div>

          {/* Lista wpisów */}
          <div className="grid gap-2">
            {records.map((r) => (
              <div key={r.id} className="card p-3">
                <div className="text-sm text-beige-700 mb-1">
                  {new Date(r.createdAt?.toDate?.() || Date.now()).toLocaleString()} • {r.author || r.authorUid}
                </div>
                {r.text && <div className="whitespace-pre-wrap mb-2">{r.text}</div>}
                {r.imageUrl && (
                 <a
                    className="text-blue-700 underline"
                    href={r.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => {
                      if (!session) return;
                      void logActivity({ type: "dossier_evidence_open", dossierId: id, recordId: r.id });
                    }}
                  >
                    Zobacz zdjęcie
                  </a>
                )}
                {canEditRecord(r) && (
                  <div className="mt-2 flex gap-2">
                    <button className="btn" onClick={() => editRecord(r.id, r.text || "")}>Edytuj</button>
                    <button className="btn bg-red-700 text-white" onClick={() => deleteRecord(r.id)}>Usuń</button>
                  </div>
                )}
              </div>
            ))}
            {records.length === 0 && <div className="card p-3">Brak wpisów.</div>}
          </div>
        </div>
      </>
    </AuthGate>
  );
}
