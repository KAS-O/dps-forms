import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { UnitsPanel } from "@/components/UnitsPanel";
import { AccountPanel } from "@/components/AccountPanel";
import { useProfile } from "@/hooks/useProfile";
import { useSessionActivity } from "@/components/ActivityLogger";
import { useLogWriter } from "@/hooks/useLogWriter";
import { useDialog } from "@/components/DialogProvider";
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
} from "firebase/firestore";
import {
  computeDurationMinutes,
  formatDuration,
  generatePwcReportPdf,
  PwcAction,
} from "@/lib/pwcReport";

type PwcReport = {
  id: string;
  pwcName: string;
  pwcBadge: string;
  apwcName: string;
  apwcBadge: string;
  takeoverTime: string;
  handoverTime: string;
  totalMinutes: number;
  reportDate: string;
  actions: PwcAction[];
  createdAt?: any;
  createdBy?: string;
  updatedAt?: any;
  updatedBy?: string;
};

type FormState = {
  pwcName: string;
  pwcBadge: string;
  apwcName: string;
  apwcBadge: string;
  takeoverTime: string;
  handoverTime: string;
  reportDate: string;
};

const emptyForm: FormState = {
  pwcName: "",
  pwcBadge: "",
  apwcName: "",
  apwcBadge: "",
  takeoverTime: "",
  handoverTime: "",
  reportDate: new Date().toISOString().slice(0, 10),
};

export default function PwcPage() {
  const { fullName, login, badgeNumber } = useProfile();
  const { logActivity } = useSessionActivity();
  const { writeLog } = useLogWriter();
  const { alert } = useDialog();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [actions, setActions] = useState<PwcAction[]>([{ time: "", description: "" }]);
  const [reports, setReports] = useState<PwcReport[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, "pwcReports"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setReports(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as PwcReport[]
      );
    });
  }, []);

  useEffect(() => {
    logActivity({ type: "pwc_view" }).catch(() => {});
  }, [logActivity]);

  const totalMinutes = useMemo(
    () => computeDurationMinutes(form.takeoverTime, form.handoverTime),
    [form.handoverTime, form.takeoverTime]
  );

  const resetForm = () => {
    setForm(emptyForm);
    setActions([{ time: "", description: "" }]);
    setEditingId(null);
  };

  const updateAction = (index: number, patch: Partial<PwcAction>) => {
    setActions((prev) =>
      prev.map((action, i) => (i === index ? { ...action, ...patch } : action))
    );
  };

  const addActionRow = () => {
    setActions((prev) => [...prev, { time: "", description: "" }]);
  };

  const removeAction = (index: number) => {
    setActions((prev) => prev.filter((_, i) => i !== index));
  };

  const fillFromReport = (report: PwcReport) => {
    setForm({
      pwcName: report.pwcName,
      pwcBadge: report.pwcBadge,
      apwcName: report.apwcName,
      apwcBadge: report.apwcBadge,
      takeoverTime: report.takeoverTime,
      handoverTime: report.handoverTime,
      reportDate: report.reportDate,
    });
    setActions(report.actions.length ? report.actions : [{ time: "", description: "" }]);
    setEditingId(report.id);
    setSuccess(null);
    setError(null);
  };

  const validate = () => {
    if (!form.pwcName.trim() || !form.pwcBadge.trim()) {
      return "Uzupełnij dane PWC (imię, nazwisko i numer odznaki).";
    }
    if (!form.apwcName.trim() || !form.apwcBadge.trim()) {
      return "Uzupełnij dane APWC (imię, nazwisko i numer odznaki).";
    }
    if (!form.takeoverTime || !form.handoverTime) {
      return "Podaj godzinę przejęcia i zakończenia.";
    }
    if (totalMinutes == null) {
      return "Godziny są w nieprawidłowym formacie (użyj HH:MM).";
    }
    const hasAction = actions.some((a) => a.description.trim());
    if (!hasAction) {
      return "Dodaj przynajmniej jedną czynność PWC.";
    }
    const invalidAction = actions.find((a) => a.description.trim() && !a.time.trim());
    if (invalidAction) {
      return "Podaj godzinę dla każdej uzupełnionej czynności.";
    }
    return null;
  };

  const submit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      setSuccess(null);
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const filteredActions = actions
        .filter((a) => a.time.trim() || a.description.trim())
        .map((a) => ({ time: a.time.trim(), description: a.description.trim() }));

      const payload = {
        pwcName: form.pwcName.trim(),
        pwcBadge: form.pwcBadge.trim(),
        apwcName: form.apwcName.trim(),
        apwcBadge: form.apwcBadge.trim(),
        takeoverTime: form.takeoverTime,
        handoverTime: form.handoverTime,
        totalMinutes: totalMinutes ?? 0,
        reportDate: form.reportDate,
        actions: filteredActions,
      };

      const { filename, base64, doc } = await generatePwcReportPdf(payload, {
        generatedBy: fullName || login,
      });

      const actor = {
        createdBy: auth.currentUser?.email || "",
        createdByUid: auth.currentUser?.uid || "",
      };

      if (editingId) {
        await updateDoc(doc(db, "pwcReports", editingId), {
          ...payload,
          updatedAt: serverTimestamp(),
          updatedBy: auth.currentUser?.email || "",
        });
      } else {
        await addDoc(collection(db, "pwcReports"), {
          ...payload,
          ...actor,
          createdAt: serverTimestamp(),
        });
      }

      const response = await fetch("/api/send-pwc-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename,
          fileBase64: base64,
          metadata: {
            pwc: `${payload.pwcName} (${payload.pwcBadge})`,
            apwc: `${payload.apwcName} (${payload.apwcBadge})`,
            totalMinutes: payload.totalMinutes,
            reportDate: payload.reportDate,
            generatedBy: fullName || login || "—",
          },
        }),
      });

      if (!response.ok) {
        const details = await response.text();
        throw new Error(details || "Nie udało się wysłać raportu PWC na Discord.");
      }

      doc.save(filename);

      await writeLog({
        type: editingId ? "pwc_report_update" : "pwc_report_create",
        section: "pwc",
        action: editingId ? "pwc.report_update" : "pwc.report_create",
        message: editingId
          ? `Zaktualizowano raport PWC ${payload.reportDate}.`
          : `Utworzono raport PWC ${payload.reportDate}.`,
        details: {
          pwc: payload.pwcName,
          apwc: payload.apwcName,
          czas: payload.totalMinutes,
          czynnosci: payload.actions.length,
        },
      });

      setSuccess(
        editingId ? "Raport PWC zaktualizowany. Plik zapisano i wysłano na Discord." : "Raport PWC zapisany. Plik zapisano i wysłano na Discord."
      );
      resetForm();
    } catch (err: any) {
      console.error("Nie udało się zapisać raportu PWC", err);
      setError(err?.message || "Nie udało się zapisać raportu PWC.");
      await alert({
        title: "Błąd zapisu",
        message: err?.message || "Nie udało się zapisać raportu PWC.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const downloadReport = async (report: PwcReport) => {
    try {
      const { filename, doc } = await generatePwcReportPdf(
        {
          pwcName: report.pwcName,
          pwcBadge: report.pwcBadge,
          apwcName: report.apwcName,
          apwcBadge: report.apwcBadge,
          takeoverTime: report.takeoverTime,
          handoverTime: report.handoverTime,
          totalMinutes: report.totalMinutes,
          reportDate: report.reportDate,
          actions: report.actions,
        },
        { generatedBy: fullName || login }
      );
      doc.save(filename);
      await writeLog({
        type: "pwc_report_download",
        section: "pwc",
        action: "pwc.report_download",
        message: `Pobrano raport PWC ${report.reportDate}.`,
      });
    } catch (err: any) {
      console.error("Nie udało się pobrać raportu PWC", err);
      await alert({
        title: "Błąd pobierania",
        message: err?.message || "Nie udało się pobrać raportu PWC.",
        tone: "danger",
      });
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
          center={
            <div className="card p-6 space-y-6">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm text-beige-900/70">Patrol Watch Commander</p>
                  <h1 className="text-2xl font-semibold">Raport PWC</h1>
                </div>
                {editingId && (
                  <button className="btn-outline text-sm" onClick={resetForm}>
                    Anuluj edycję
                  </button>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold">Dane PWC</h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">PWC — imię i nazwisko</label>
                      <input
                        className="input"
                        value={form.pwcName}
                        onChange={(e) => setForm({ ...form, pwcName: e.target.value })}
                        placeholder={fullName || "John Doe"}
                      />
                    </div>
                    <div>
                      <label className="label">PWC — numer odznaki</label>
                      <input
                        className="input"
                        value={form.pwcBadge}
                        onChange={(e) => setForm({ ...form, pwcBadge: e.target.value })}
                        placeholder={badgeNumber || "0000"}
                      />
                    </div>
                    <div>
                      <label className="label">APWC — imię i nazwisko</label>
                      <input
                        className="input"
                        value={form.apwcName}
                        onChange={(e) => setForm({ ...form, apwcName: e.target.value })}
                        placeholder="Jane Doe"
                      />
                    </div>
                    <div>
                      <label className="label">APWC — numer odznaki</label>
                      <input
                        className="input"
                        value={form.apwcBadge}
                        onChange={(e) => setForm({ ...form, apwcBadge: e.target.value })}
                        placeholder="0000"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="label">Godzina przejęcia</label>
                      <input
                        className="input"
                        type="time"
                        value={form.takeoverTime}
                        onChange={(e) => setForm({ ...form, takeoverTime: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label">Godzina zakończenia</label>
                      <input
                        className="input"
                        type="time"
                        value={form.handoverTime}
                        onChange={(e) => setForm({ ...form, handoverTime: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label">Łączny czas</label>
                      <input className="input" value={formatDuration(totalMinutes)} disabled />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">Data służby</label>
                      <input
                        className="input"
                        type="date"
                        value={form.reportDate}
                        onChange={(e) => setForm({ ...form, reportDate: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold">Czynności</h2>
                    <button className="btn-outline text-sm" onClick={addActionRow}>
                      Dodaj kolejną czynność
                    </button>
                  </div>
                  <div className="space-y-3">
                    {actions.map((action, idx) => (
                      <div key={idx} className="rounded-xl border border-white/10 bg-white/5 p-3">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[120px,1fr,auto] sm:items-center">
                          <input
                            className="input"
                            type="time"
                            value={action.time}
                            onChange={(e) => updateAction(idx, { time: e.target.value })}
                          />
                          <input
                            className="input"
                            value={action.description}
                            onChange={(e) => updateAction(idx, { description: e.target.value })}
                            placeholder="Opis czynności (np. Napad na kasetkę)"
                          />
                          {actions.length > 1 && (
                            <button
                              className="btn-outline text-xs px-3 py-2"
                              onClick={() => removeAction(idx)}
                            >
                              Usuń
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {error && (
                <div className="rounded-xl border border-red-500/40 bg-red-900/30 px-4 py-3 text-sm text-red-50">
                  {error}
                </div>
              )}
              {success && (
                <div className="rounded-xl border border-green-500/30 bg-green-900/30 px-4 py-3 text-sm text-green-50">
                  {success}
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-beige-900/80">
                  Wypełnij dane i kliknij zakończ czynności PWC, aby wygenerować i wysłać raport.
                </p>
                <div className="flex gap-2">
                  <button className="btn-outline" onClick={resetForm} disabled={saving}>
                    Wyczyść
                  </button>
                  <button className="btn" onClick={submit} disabled={saving}>
                    {saving ? "Zapisywanie..." : "Zakończ czynności PWC"}
                  </button>
                </div>
              </div>
            </div>
          }
          right={
            <div className="card p-5 space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Historia raportów PWC</h2>
                <p className="text-sm text-beige-900/80">Podgląd i edycja zapisanych raportów.</p>
              </div>
              <div className="space-y-3">
                {reports.length === 0 && (
                  <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-beige-900/70">
                    Brak zapisanych raportów PWC.
                  </div>
                )}
                {reports.map((report) => {
                  const reportActions = report.actions || [];
                  return (
                  <div key={report.id} className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-beige-900/70">
                          {report.reportDate}
                        </p>
                        <p className="font-semibold">{report.pwcName}</p>
                        <p className="text-sm text-beige-900/80">
                          APWC: {report.apwcName} • {formatDuration(report.totalMinutes)} •{" "}
                          {reportActions.length} czynności
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button className="btn-outline text-xs" onClick={() => fillFromReport(report)}>
                          Edytuj
                        </button>
                        <button className="btn text-xs" onClick={() => downloadReport(report)}>
                          Pobierz PDF
                        </button>
                      </div>
                    </div>
                    <div className="text-xs text-beige-900/70">
                      {reportActions.slice(0, 3).map((a, idx) => (
                        <div key={idx} className="flex gap-2">
                          <span className="font-mono">{a.time || "--:--"}</span>
                          <span>{a.description || "(brak opisu)"}</span>
                        </div>
                      ))}
                      {reportActions.length > 3 && <p>…</p>}
                    </div>
                  </div>
                );
                })}
              </div>
            </div>
          }
        />
      </>
    </AuthGate>
  );
}
