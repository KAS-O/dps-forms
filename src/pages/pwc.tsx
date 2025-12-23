import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { UnitsPanel } from "@/components/UnitsPanel";
import { AccountPanel } from "@/components/AccountPanel";
import { useProfile } from "@/hooks/useProfile";
import { useLogWriter } from "@/hooks/useLogWriter";
import { auth, db } from "@/lib/firebase";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import { buildPwcPdf, calculateDurationMinutes, formatDuration, type PwcAction, type PwcReportInput } from "@/lib/pwcReport";

type ActionFormRow = PwcAction & { id: string };

type PwcReportRecord = {
  id: string;
  pwcName: string;
  pwcBadge: string;
  apwcName: string;
  apwcBadge: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  durationDisplay: string;
  actions: PwcAction[];
  pdfBase64?: string;
  pdfFilename?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  createdBy?: string;
  createdByUid?: string;
};

const createEmptyAction = (): ActionFormRow => ({
  id: crypto.randomUUID(),
  time: "",
  description: "",
});

const formatDateTimeLocal = (date: Date) => {
  const pad = (value: number) => value.toString().padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

function formatTimestamp(ts?: Timestamp) {
  if (!ts?.toDate) return null;
  return ts.toDate();
}

export default function PwcPage() {
  const { fullName, login } = useProfile();
  const { writeLog } = useLogWriter();
  const [history, setHistory] = useState<PwcReportRecord[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [formVisible, setFormVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({
    pwcName: "",
    pwcBadge: "",
    apwcName: "",
    apwcBadge: "",
    startTime: "",
    endTime: "",
  });
  const [actions, setActions] = useState<ActionFormRow[]>([createEmptyAction()]);

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, "pwcReports"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Omit<PwcReportRecord, "id">) }));
        setHistory(items);
        setHistoryError(null);
        setLoadingHistory(false);
      },
      (err) => {
        console.error("Nie udało się pobrać historii PWC", err);
        setHistoryError("Nie udało się pobrać historii PWC.");
        setLoadingHistory(false);
      }
    );
    return () => unsub();
  }, []);

  const durationMinutes = useMemo(
    () => calculateDurationMinutes(form.startTime, form.endTime),
    [form.startTime, form.endTime]
  );
  const durationDisplay = useMemo(() => formatDuration(durationMinutes), [durationMinutes]);

  const resetForm = () => {
    setForm({
      pwcName: "",
      pwcBadge: "",
      apwcName: "",
      apwcBadge: "",
      startTime: "",
      endTime: "",
    });
    setActions([createEmptyAction()]);
    setEditingId(null);
    setError(null);
    setSuccess(null);
  };

  const handleAddAction = () => {
    setActions((prev) => [...prev, createEmptyAction()]);
  };

  const handleUpdateAction = (id: string, key: keyof PwcAction, value: string) => {
    setActions((prev) => prev.map((action) => (action.id === id ? { ...action, [key]: value } : action)));
  };

  const handleRemoveAction = (id: string) => {
    setActions((prev) => (prev.length === 1 ? prev : prev.filter((action) => action.id !== id)));
  };

  const startSession = () => {
    setFormVisible(true);
    if (!form.startTime) {
      const now = new Date();
      setForm((prev) => ({ ...prev, startTime: formatDateTimeLocal(now) }));
    }
  };

  const loadReport = (record: PwcReportRecord) => {
    setFormVisible(true);
    setEditingId(record.id);
    setForm({
      pwcName: record.pwcName || "",
      pwcBadge: record.pwcBadge || "",
      apwcName: record.apwcName || "",
      apwcBadge: record.apwcBadge || "",
      startTime: record.startTime || "",
      endTime: record.endTime || "",
    });
    const savedActions = (record.actions || []).map((action) => ({
      ...action,
      id: crypto.randomUUID(),
    }));
    setActions(savedActions.length ? savedActions : [createEmptyAction()]);
    setError(null);
    setSuccess(null);
  };

  const downloadPdf = (record: PwcReportRecord) => {
    if (!record.pdfBase64 || !record.pdfFilename) {
      setError("Brak danych PDF do pobrania. Otwórz raport i zapisz go ponownie.");
      return;
    }
    const link = document.createElement("a");
    link.href = `data:application/pdf;base64,${record.pdfBase64}`;
    link.download = record.pdfFilename;
    link.click();
  };

  const validateForm = () => {
    if (!form.pwcName.trim() || !form.pwcBadge.trim()) {
      setError("Uzupełnij imię, nazwisko i numer odznaki PWC.");
      return false;
    }
    if (!form.apwcName.trim() || !form.apwcBadge.trim()) {
      setError("Uzupełnij imię, nazwisko i numer odznaki APWC.");
      return false;
    }
    if (!form.startTime || !form.endTime) {
      setError("Podaj godzinę przejęcia i zakończenia.");
      return false;
    }
    if (durationMinutes <= 0) {
      setError("Godzina zakończenia musi być późniejsza niż przejęcia.");
      return false;
    }
    const validActions = actions
      .map(({ time, description }) => ({ time: time.trim(), description: description.trim() }))
      .filter((a) => a.description.length > 0 && a.time.length > 0);
    if (!validActions.length) {
      setError("Dodaj przynajmniej jedną czynność wraz z godziną.");
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!db) {
      setError("Brak połączenia z bazą danych.");
      return;
    }
    if (saving) return;
    setError(null);
    setSuccess(null);
    const user = auth?.currentUser;
    const actionsPayload = actions
      .map(({ time, description }) => ({ time: time.trim(), description: description.trim() }))
      .filter((a) => a.description.length > 0 && a.time.length > 0);

    if (!validateForm()) {
      return;
    }

    const payload: PwcReportInput = {
      pwcName: form.pwcName.trim(),
      pwcBadge: form.pwcBadge.trim(),
      apwcName: form.apwcName.trim(),
      apwcBadge: form.apwcBadge.trim(),
      startTime: form.startTime,
      endTime: form.endTime,
      durationMinutes,
      durationDisplay,
      actions: actionsPayload,
      generatedBy: fullName || login || user?.email || "—",
      generatedAt: new Date().toISOString(),
    };

    try {
      setSaving(true);
      const { pdfBase64, fileName } = buildPwcPdf(payload);
      const dataToSave = {
        ...payload,
        pdfBase64,
        pdfFilename: fileName,
        updatedAt: serverTimestamp(),
        ...(editingId ? {} : { createdAt: serverTimestamp() }),
        createdBy: user?.email || login || null,
        createdByUid: user?.uid || null,
      };

      if (editingId) {
        await updateDoc(doc(db, "pwcReports", editingId), dataToSave);
      } else {
        await addDoc(collection(db, "pwcReports"), dataToSave);
      }

      await writeLog({
        type: "pwc_report",
        section: "pwc",
        action: editingId ? "pwc.report.update" : "pwc.report.create",
        message: `${editingId ? "Zaktualizowano" : "Utworzono"} raport PWC (${payload.pwcName}).`,
        details: {
          pwc: payload.pwcName,
          apwc: payload.apwcName,
          startTime: payload.startTime,
          endTime: payload.endTime,
          duration: payload.durationDisplay,
          actions: payload.actions.length,
        },
      });

      const discordResponse = await fetch("/api/send-pwc-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: fileName,
          fileBase64: pdfBase64,
          metadata: {
            pwcName: `${payload.pwcName} (${payload.pwcBadge})`,
            apwcName: `${payload.apwcName} (${payload.apwcBadge})`,
            duration: payload.durationDisplay,
            startTime: new Date(payload.startTime).toLocaleString("pl-PL"),
            endTime: new Date(payload.endTime).toLocaleString("pl-PL"),
          },
        }),
      });

      if (!discordResponse.ok) {
        console.error(await discordResponse.text());
        setError("Raport zapisano, ale nie udało się wysłać na Discord.");
      } else {
        setSuccess("Raport zapisany i wysłany na Discord.");
      }

      if (!editingId) {
        resetForm();
        setFormVisible(false);
      }
    } catch (err: any) {
      console.error("Nie udało się zapisać raportu PWC", err);
      setError(err?.message || "Nie udało się zapisać raportu PWC.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — PWC</title>
        </Head>
        <Nav showSidebars={false} />
        <DashboardLayout
          left={<UnitsPanel />}
          center={(
            <section className="flex flex-col gap-6" data-section="pwc">
              <div className="card p-6 space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="section-chip">
                      <span className="section-chip__dot" style={{ background: "#06b6d4" }} />
                      PWC
                    </span>
                    <h1 className="text-3xl font-semibold tracking-tight mt-2">Patrol Watch Commander</h1>
                    <p className="text-sm text-beige-100/75">
                      Utwórz raport przejęcia PWC, dodaj czynności wraz z godziną i zapisz je w historii.
                    </p>
                  </div>
                  <div className="action-stack sm:justify-end">
                    <button className="btn" type="button" onClick={startSession}>
                      Przejmij PWC
                    </button>
                    {editingId && (
                      <button className="btn bg-slate-800 text-white" type="button" onClick={resetForm}>
                        Anuluj edycję
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {formVisible && (
                <div className="card p-6 space-y-5">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-2xl font-semibold tracking-tight">Generator raportu PWC</h2>
                    <p className="text-sm text-beige-100/75">
                      Uzupełnij dane PWC i APWC, wprowadź godziny służby oraz kolejne czynności. Łączny czas obliczy się automatycznie.
                    </p>
                  </div>

                  <div className="form-grid">
                    <div className="flex flex-col gap-1">
                      <label className="label">PWC — imię i nazwisko</label>
                      <input
                        className="input"
                        value={form.pwcName}
                        onChange={(e) => setForm((prev) => ({ ...prev, pwcName: e.target.value }))}
                        placeholder="np. John Doe"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="label">PWC — numer odznaki</label>
                      <input
                        className="input"
                        value={form.pwcBadge}
                        onChange={(e) => setForm((prev) => ({ ...prev, pwcBadge: e.target.value }))}
                        placeholder="np. 1012"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="label">APWC — imię i nazwisko</label>
                      <input
                        className="input"
                        value={form.apwcName}
                        onChange={(e) => setForm((prev) => ({ ...prev, apwcName: e.target.value }))}
                        placeholder="np. Jane Doe"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="label">APWC — numer odznaki</label>
                      <input
                        className="input"
                        value={form.apwcBadge}
                        onChange={(e) => setForm((prev) => ({ ...prev, apwcBadge: e.target.value }))}
                        placeholder="np. 3045"
                      />
                    </div>
                  </div>

                  <div className="form-grid">
                    <div className="flex flex-col gap-1">
                      <label className="label">Godzina przejęcia</label>
                      <input
                        className="input"
                        type="datetime-local"
                        value={form.startTime}
                        onChange={(e) => setForm((prev) => ({ ...prev, startTime: e.target.value }))}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="label">Godzina zakończenia</label>
                      <input
                        className="input"
                        type="datetime-local"
                        value={form.endTime}
                        onChange={(e) => setForm((prev) => ({ ...prev, endTime: e.target.value }))}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="label">Łączny czas jako PWC</label>
                      <div className="input bg-white/5 text-beige-50">{durationDisplay}</div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-semibold">Czynności</h3>
                      <button className="btn" type="button" onClick={handleAddAction}>
                        Dodaj kolejną czynność
                      </button>
                    </div>
                    <div className="space-y-3">
                      {actions.map((action) => (
                        <div key={action.id} className="grid gap-3 rounded-lg border border-white/10 bg-white/5 p-4 sm:grid-cols-[160px,1fr,auto]">
                          <div className="flex flex-col gap-1">
                            <label className="label">Godzina</label>
                            <input
                              className="input"
                              type="time"
                              value={action.time}
                              onChange={(e) => handleUpdateAction(action.id, "time", e.target.value)}
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="label">Opis czynności</label>
                            <input
                              className="input"
                              value={action.description}
                              onChange={(e) => handleUpdateAction(action.id, "description", e.target.value)}
                              placeholder="np. Napad na kasetkę"
                            />
                          </div>
                          <div className="flex items-end justify-end">
                            <button
                              className="btn bg-red-800 text-white"
                              type="button"
                              disabled={actions.length === 1}
                              onClick={() => handleRemoveAction(action.id)}
                            >
                              Usuń
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {error && <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>}
                  {success && <div className="rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-100">{success}</div>}

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-beige-100/75">
                      Po zakończeniu czynności raport zostanie zapisany, zapisze się w historii i zostanie wysłany na Discord.
                    </div>
                    <div className="action-stack sm:justify-end">
                      <button className="btn" type="button" onClick={resetForm}>
                        Wyczyść
                      </button>
                      <button
                        className="btn bg-emerald-600 text-white"
                        type="button"
                        onClick={handleSubmit}
                        disabled={saving}
                      >
                        {saving ? "Zapisywanie..." : "Zakończ czynności PWC"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="card p-6 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight">Historia raportów PWC</h2>
                    <p className="text-sm text-beige-100/75">Wszystkie zapisane raporty można podglądać i edytować.</p>
                  </div>
                  <span className="section-chip">
                    <span className="section-chip__dot" style={{ background: "#06b6d4" }} />
                    {history.length} raportów
                  </span>
                </div>
                {loadingHistory && <div className="text-sm text-beige-100/75">Wczytywanie raportów...</div>}
                {historyError && <div className="text-sm text-red-200">{historyError}</div>}
                {!loadingHistory && !history.length && !historyError && (
                  <div className="text-sm text-beige-100/75">Brak zapisanych raportów PWC.</div>
                )}
                <div className="space-y-3">
                  {history.map((record) => {
                    const createdAt = formatTimestamp(record.createdAt);
                    const updatedAt = formatTimestamp(record.updatedAt);
                    return (
                      <div key={record.id} className="rounded-lg border border-white/10 bg-white/5 p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2 text-sm text-beige-100/75">
                              <span className="font-semibold text-white">{record.pwcName}</span>
                              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">#{record.pwcBadge}</span>
                              <span className="text-white/70">PWC</span>
                              <span className="text-white/60">•</span>
                              <span className="font-semibold text-white">{record.apwcName}</span>
                              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">#{record.apwcBadge}</span>
                              <span className="text-white/70">APWC</span>
                            </div>
                            <div className="text-sm text-beige-100/75">
                              Od <b>{new Date(record.startTime).toLocaleString("pl-PL")}</b> do{" "}
                              <b>{new Date(record.endTime).toLocaleString("pl-PL")}</b> • {record.durationDisplay}
                            </div>
                            <div className="text-xs text-beige-100/60">
                              {createdAt && <>Dodano: {createdAt.toLocaleString("pl-PL")} </>}
                              {updatedAt && <>• Aktualizacja: {updatedAt.toLocaleString("pl-PL")}</>}
                            </div>
                          </div>
                          <div className="action-stack sm:justify-end">
                            <button className="btn bg-slate-800 text-white" type="button" onClick={() => loadReport(record)}>
                              Edytuj
                            </button>
                            <button
                              className="btn"
                              type="button"
                              onClick={() => downloadPdf(record)}
                              disabled={!record.pdfBase64}
                            >
                              Pobierz PDF
                            </button>
                          </div>
                        </div>
                        {record.actions?.length ? (
                          <div className="mt-3 grid gap-2 md:grid-cols-2">
                            {record.actions.map((action, idx) => (
                              <div key={`${record.id}-${idx}`} className="rounded-md border border-white/5 bg-white/5 px-3 py-2">
                                <div className="text-xs uppercase tracking-wide text-white/60">Godzina {action.time || "—"}</div>
                                <div className="text-sm text-white">{action.description || "—"}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-3 text-sm text-beige-100/75">Brak zapisanych czynności.</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}
          right={<AccountPanel />}
        />
      </>
    </AuthGate>
  );
}
