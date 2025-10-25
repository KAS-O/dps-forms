import Head from "next/head";
import Nav from "@/components/Nav";
import AuthGate from "@/components/AuthGate";
import { useProfile, Role } from "@/hooks/useProfile";
import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  query,
  where,
  getCountFromServer,
  getDoc,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  increment,
  Timestamp,
  serverTimestamp,
  writeBatch,
  onSnapshot,
  orderBy,
  limit,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useDialog } from "@/components/DialogProvider";
import { useAnnouncement } from "@/hooks/useAnnouncement";

type Range = "all" | "30" | "7";
type Person = { uid: string; fullName?: string; login?: string };
type AdminSection = "overview" | "hr" | "announcements" | "logs";

type Account = {
  uid: string;
  login: string;
  fullName?: string;
  role: Role;
  email: string;
  createdAt?: string;
};

const ROLE_NAMES: Record<Role, string> = {
  director: "Director",
  chief: "Chief Agent",
  senior: "Senior Agent",
  agent: "Agent",
  rookie: "Rookie",
};

const LOGIN_PATTERN = /^[a-z0-9._-]+$/;

const ANNOUNCEMENT_WINDOWS: { value: string; label: string; ms: number | null }[] = [
  { value: "30m", label: "30 minut", ms: 30 * 60 * 1000 },
  { value: "1h", label: "1 godzina", ms: 60 * 60 * 1000 },
  { value: "3h", label: "3 godziny", ms: 3 * 60 * 60 * 1000 },
  { value: "5h", label: "5 godzin", ms: 5 * 60 * 60 * 1000 },
  { value: "8h", label: "8 godzin", ms: 8 * 60 * 60 * 1000 },
  { value: "12h", label: "12 godzin", ms: 12 * 60 * 60 * 1000 },
  { value: "24h", label: "24 godziny", ms: 24 * 60 * 60 * 1000 },
  { value: "2d", label: "2 dni", ms: 2 * 24 * 60 * 60 * 1000 },
  { value: "3d", label: "3 dni", ms: 3 * 24 * 60 * 60 * 1000 },
  { value: "7d", label: "Tydzień", ms: 7 * 24 * 60 * 60 * 1000 },
  { value: "forever", label: "Do czasu usunięcia", ms: null },
];

async function readErrorResponse(res: Response, fallback: string) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const data = await res.json();
      const message = data?.error || data?.message;
      if (message) return String(message);
    } catch (err) {
      console.warn("Nie udało się sparsować JSON z odpowiedzi:", err);
    }
  }
  try {
    const text = await res.text();
    if (!text) return fallback;
    if (/<!DOCTYPE/i.test(text)) {
      return `${fallback} (kod ${res.status})`;
    }
    return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  } catch (err) {
    console.warn("Nie udało się odczytać treści odpowiedzi:", err);
    return fallback;
  }
}


export default function Admin() {
  const { role, login, fullName, ready } = useProfile();
  const { confirm, prompt, alert } = useDialog();
  const { announcement } = useAnnouncement();
  const loginDomain = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dps.local";

  const [range, setRange] = useState<Range>("all");
  const [err, setErr] = useState<string | null>(null);
  const [section, setSection] = useState<AdminSection>("overview");
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);

  // ogólne
  const [mandaty, setMandaty] = useState(0);
  const [lseb, setLseb] = useState(0);
  const [areszty, setAreszty] = useState(0);

  // saldo
  const [baseTotal, setBaseTotal] = useState(0);
  const [manualDelta, setManualDelta] = useState(0);
  const balance = useMemo(() => baseTotal + manualDelta, [baseTotal, manualDelta]);

  // personel
  const [people, setPeople] = useState<Person[]>([]);
  const [person, setPerson] = useState<string>(""); // uid
  const [pStats, setPStats] = useState({ m: 0, k: 0, a: 0, income: 0 });

  // dzial kadr
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");
  const [editorState, setEditorState] = useState<{
    mode: "create" | "edit";
    account: Partial<Account>;
    password?: string;
  } | null>(null);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountActionUid, setAccountActionUid] = useState<string | null>(null);

  // ogłoszenia
  const [announcementMessage, setAnnouncementMessage] = useState("");
  const [announcementDuration, setAnnouncementDuration] = useState<string>("30m");
  const [announcementSaving, setAnnouncementSaving] = useState(false);
  const rangeLabel = useMemo(() => {
    switch (range) {
      case "30":
        return "Ostatnie 30 dni";
      case "7":
        return "Ostatnie 7 dni";
      default:
        return "Od początku";
    }
  }, [range]);

  useEffect(() => {
    if (announcementSaving) return;
    if (announcement?.message) {
      setAnnouncementMessage(announcement.message);
      if (announcement.duration) {
        setAnnouncementDuration(announcement.duration);
      }
    } else {
      setAnnouncementMessage("");
    }
  }, [announcement, announcementSaving]);

  useEffect(() => {
    if (role !== "director") return;
    setLogsLoading(true);
    const q = query(collection(db, "logs"), orderBy("ts", "desc"), limit(250));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setActivityLogs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
        setLogsLoading(false);
      },
      (error) => {
        console.error("Nie udało się pobrać logów aktywności:", error);
        setLogsLoading(false);
      }
    );
    return () => unsub();
  }, [role]);


  // okres
  const since: Timestamp | null = useMemo(() => {
    if (range === "all") return null;
    const days = range === "30" ? 30 : 7;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return Timestamp.fromDate(d);
  }, [range]);

  // które szablony mają kary pieniężne
  const FINE_TEMPLATES: { name: string; field: string }[] = [
    { name: "Bloczek mandatowy", field: "kwota" },
    { name: "Kontrola LSEB", field: "grzywna" },
    { name: "Protokół aresztowania", field: "grzywna" },
    { name: "Raport z założenia blokady", field: "kara" },
    { name: "Protokół zajęcia pojazdu", field: "grzywna" },
  ];

  // ===== ogólne + saldo + personel
  const recalcAll = async () => {
    try {
      setErr(null);

      const archives = collection(db, "archives");
      const time = since ? [where("createdAt", ">=", since)] : [];

      // ogólne liczniki
      const qM = query(archives, where("templateName", "==", "Bloczek mandatowy"), ...time);
      const qK = query(archives, where("templateName", "==", "Kontrola LSEB"), ...time);
      const qA = query(archives, where("templateName", "==", "Protokół aresztowania"), ...time);

      setMandaty((await getCountFromServer(qM)).data().count);
      setLseb((await getCountFromServer(qK)).data().count);
      setAreszty((await getCountFromServer(qA)).data().count);

      // suma kar z archiwum
      let base = 0;
      for (const t of FINE_TEMPLATES) {
        const qF = query(archives, where("templateName", "==", t.name), ...time);
        const sF = await getDocs(qF);
        sF.docs.forEach((d) => {
          const val = (d.data()?.values || {}) as any;
          const n = Number(val[t.field] || 0);
          if (!Number.isNaN(n)) base += n;
        });
      }
      setBaseTotal(base);

      // manualDelta
      const accRef = doc(db, "accounts", "dps");
      const accSnap = await getDoc(accRef);
      setManualDelta(Number(accSnap.data()?.manualDelta || 0));

      // lista funkcjonariuszy
      const ps = await getDocs(collection(db, "profiles"));
      const arr = ps.docs.map((d) => ({ uid: d.id, ...(d.data() as any) }));
      setPeople(arr);
      if (!person && arr.length) setPerson(arr[0].uid);
    } catch (e: any) {
      setErr(e?.message || "Błąd pobierania danych");
    }
  };

  // ===== statystyki personalne (po UID)
  const recalcPerson = async () => {
    if (!person) return;
    try {
      setErr(null);

      // efektywny start: max(since, lastResetAt)
      const resetRef = doc(db, "profiles", person, "counters", "personal");
      const rSnap = await getDoc(resetRef);
      const lastResetAt = (rSnap.data()?.lastResetAt || null) as Timestamp | null;
      const effSince =
        since && lastResetAt
          ? (since.toMillis() > lastResetAt.toMillis() ? since : lastResetAt)
          : since || lastResetAt || null;

      const archives = collection(db, "archives");
      const snap = await getDocs(query(archives, where("officersUid", "array-contains", person)));

      const cutoff = effSince ? effSince.toMillis() : null;
      let m = 0;
      let k = 0;
      let a = 0;
      let income = 0;

      snap.docs.forEach((docSnap) => {
        const data = docSnap.data() as any;
        const createdAt: Timestamp | null = (data?.createdAt as Timestamp) || null;
        if (cutoff) {
          if (!createdAt) return;
          if (createdAt.toMillis() < cutoff) return;
        }

        const template = data?.templateName as string | undefined;
        if (template === "Bloczek mandatowy") {
          m += 1;
          const val = (data?.values || {}) as any;
          const n = Number(val.kwota || 0);
          if (!Number.isNaN(n)) income += n;
        } else if (template === "Kontrola LSEB") {
          k += 1;
          const val = (data?.values || {}) as any;
          const n = Number(val.grzywna || 0);
          if (!Number.isNaN(n)) income += n;
        } else if (template === "Protokół aresztowania") {
          a += 1;
          const val = (data?.values || {}) as any;
          const n = Number(val.grzywna || 0);
          if (!Number.isNaN(n)) income += n;
        } else if (template === "Raport z założenia blokady") {
          const val = (data?.values || {}) as any;
          const n = Number(val.kara || 0);
          if (!Number.isNaN(n)) income += n;
        } else if (template === "Protokół zajęcia pojazdu") {
          const val = (data?.values || {}) as any;
          const n = Number(val.grzywna || 0);
          if (!Number.isNaN(n)) income += n;
        }
      });

      setPStats({ m, k, a, income });
    } catch (e: any) {
      setErr(e?.message || "Błąd statystyk personelu");
    }
  };

  const loadAccounts = async () => {
    try {
      setErr(null);
      setAccountsLoading(true);
      const user = auth.currentUser;
      if (!user) throw new Error("Brak zalogowanego użytkownika.");
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/accounts", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const message = await readErrorResponse(res, "Nie udało się pobrać kont.");
        throw new Error(message);
      }
      const data = await res.json();
      setAccounts(data.accounts || []);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Nie udało się pobrać kont.");
    } finally {
      setAccountsLoading(false);
    }
  };

  const openCreateAccount = () => {
    setEditorState({
      mode: "create",
      account: { login: "", fullName: "", role: "rookie", email: "" },
      password: "",
    });
  };

  const openEditAccount = (account: Account) => {
    setEditorState({
      mode: "edit",
      account: { ...account },
      password: "",
    });
  };

  const saveAccount = async () => {
    if (!editorState) return;
    const loginValue = (editorState.account.login || "").trim().toLowerCase();
    const fullNameValue = (editorState.account.fullName || "").trim();
    const roleValue = (editorState.account.role || "rookie") as Role;
    const passwordValue = (editorState.password || "").trim();

    if (!loginValue) {
      setErr("Login jest wymagany.");
      return;
    }
    if (!LOGIN_PATTERN.test(loginValue)) {
      setErr("Login może zawierać jedynie małe litery, cyfry, kropki, myślniki i podkreślniki.");
      return;
    }
    if (editorState.mode === "create" && !passwordValue) {
      setErr("Hasło jest wymagane przy tworzeniu nowego konta.");
      return;
    }
    if (passwordValue && passwordValue.length < 6) {
      setErr("Hasło musi mieć co najmniej 6 znaków.");
      return;
    }

    try {
      setAccountSaving(true);
      setErr(null);
      const user = auth.currentUser;
      if (!user) throw new Error("Brak zalogowanego użytkownika.");
      const token = await user.getIdToken();
      const payload: Record<string, any> = {
        login: loginValue,
        fullName: fullNameValue,
        role: roleValue,
      };
      if (passwordValue) payload.password = passwordValue;
      if (editorState.mode === "edit") {
        payload.uid = editorState.account.uid;
      }

      const res = await fetch("/api/admin/accounts", {
        method: editorState.mode === "create" ? "POST" : "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const message = await readErrorResponse(res, "Nie udało się zapisać konta.");
        throw new Error(message);
      }
      setEditorState(null);
      await loadAccounts();
      await recalcAll();
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Nie udało się zapisać konta.");
    } finally {
      setAccountSaving(false);
    }
  };

  const removeAccount = async (account: Account) => {
    const ok = await confirm({
      title: "Usuń konto",
      message: `Czy na pewno chcesz usunąć konto ${account.fullName || account.login}?`,
      confirmLabel: "Usuń konto",
      tone: "danger",
    });
    if (!ok) return;
    try {
      setAccountActionUid(account.uid);
      setErr(null);
      const user = auth.currentUser;
      if (!user) throw new Error("Brak zalogowanego użytkownika.");
      const token = await user.getIdToken();
      const res = await fetch(`/api/admin/accounts?uid=${account.uid}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const message = await readErrorResponse(res, "Nie udało się usunąć konta.");
        throw new Error(message);
      }
      await loadAccounts();
      await recalcAll();
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Nie udało się usunąć konta.");
    } finally {
      setAccountActionUid(null);
    }
  };

  const filteredAccounts = useMemo(() => {
    const phrase = accountSearch.trim().toLowerCase();
    const base = accounts
      .filter((acc) =>
        !phrase
          ? true
          : acc.login.toLowerCase().includes(phrase) || (acc.fullName || "").toLowerCase().includes(phrase)
      )
      .slice();
    base.sort((a, b) => {
      const nameA = (a.fullName || a.login).toLowerCase();
      const nameB = (b.fullName || b.login).toLowerCase();
      return nameA.localeCompare(nameB);
    });
    return base;
  }, [accounts, accountSearch]);

  const publishAnnouncement = async () => {
    const message = announcementMessage.trim();
    if (!message) {
      await alert({
        title: "Brak treści",
        message: "Wpisz treść ogłoszenia.",
        tone: "info",
      });
      return;
    }
    try {
      setAnnouncementSaving(true);
      setErr(null);
      const user = auth.currentUser;
      if (!user) {
        throw new Error("Brak zalogowanego użytkownika.");
      }
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/announcement", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
          duration: announcementDuration,
        }),
      });
      if (!res.ok) {
        const messageText = await readErrorResponse(res, "Nie udało się opublikować ogłoszenia.");
        throw new Error(messageText);
      }
    
      await alert({
        title: "Opublikowano",
        message: "Ogłoszenie zostało opublikowane.",
        tone: "info",
      });
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Nie udało się opublikować ogłoszenia.");
    } finally {
      setAnnouncementSaving(false);
    }
  };

  const removeAnnouncement = async () => {
    if (!announcement?.message) {
      setAnnouncementMessage("");
      return;
    }
    const ok = await confirm({
      title: "Usuń ogłoszenie",
      message: "Czy na pewno chcesz usunąć bieżące ogłoszenie?",
      confirmLabel: "Usuń",
      tone: "danger",
    });
    if (!ok) return;
    try {
      setAnnouncementSaving(true);
      setErr(null);
     const user = auth.currentUser;
      if (!user) {
        throw new Error("Brak zalogowanego użytkownika.");
      }
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/announcement", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const message = await readErrorResponse(res, "Nie udało się usunąć ogłoszenia.");
        throw new Error(message);
      }
      setAnnouncementMessage("");
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Nie udało się usunąć ogłoszenia.");
    } finally {
      setAnnouncementSaving(false);
    }
  };

  const sectionButtonClass = (value: AdminSection) =>
    `rounded-2xl px-4 py-3 text-left transition border ${
      section === value
        ? "bg-white/20 border-white/50 shadow-[0_0_18px_rgba(59,130,246,0.45)]"
        : "bg-white/5 border-white/10 hover:bg-white/15"
    }`;

  const formatLogTimestamp = (log: any) => {
    const raw = log?.ts || log?.createdAt;
    if (raw?.toDate && typeof raw.toDate === "function") {
      try {
        return raw.toDate().toLocaleString("pl-PL");
      } catch (error) {
        return raw.toDate().toISOString();
      }
    }
    if (raw instanceof Date) {
      return raw.toLocaleString("pl-PL");
    }
    if (typeof raw === "string") {
      try {
        return new Date(raw).toLocaleString("pl-PL");
      } catch (error) {
        return raw;
      }
    }
    return "—";
  };

  const formatDuration = (ms?: number) => {
    if (typeof ms !== "number" || Number.isNaN(ms) || ms <= 0) return "—";
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (value: number) => value.toString().padStart(2, "0");
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  };

  const formatReason = (reason?: string) => {
    switch (reason) {
      case "logout":
        return "Wylogowanie";
      case "window_closed":
        return "Zamknięcie karty";
      case "timeout":
        return "Brak aktywności";
      default:
        return reason || "—";
    }
  };

  const describeLog = (log: any) => {
    switch (log?.type) {
      case "session_start":
        return `Start sesji • ID: ${log.sessionId || "—"}`;
      case "session_end":
        return `Koniec sesji • ID: ${log.sessionId || "—"} • Powód: ${formatReason(log.reason)}`;
      case "logout":
        return `Wylogowanie • Powód: ${formatReason(log.reason)}`;
      case "page_view":
        return `Strona: ${log.path || "—"}${log.title ? ` • ${log.title}` : ""}`;
      case "template_view":
        return `Szablon: ${log.template || log.slug || "—"}`;
      case "archive_view":
        return "Przegląd zasobów archiwum";
      case "archive_image_open":
        return `Otwarcie obrazu archiwum • ID: ${log.archiveId || "—"}`;
      case "dossier_view":
        return `Podgląd teczki • CID: ${log.dossierId || "—"}`;
      case "dossier_link_open":
        return `Przejście do teczki • CID: ${log.dossierId || "—"}`;
      case "dossier_evidence_open":
        return `Załącznik w teczce • CID: ${log.dossierId || "—"} • Wpis: ${log.recordId || "—"}`;
      default: {
        const entries = Object.entries(log || {})
          .filter(([key]) => !["type", "ts", "createdAt", "login", "uid", "sessionId"].includes(key))
          .map(([key, value]) => {
            if (value == null) return `${key}: —`;
            if (Array.isArray(value)) return `${key}: ${value.join(", ")}`;
            if (typeof value === "object") return `${key}: ${JSON.stringify(value)}`;
            return `${key}: ${value}`;
          })
          .join(" • ");
        return entries || "—";
      }
    }
  };


  // lifecycle
  useEffect(() => {
    if (!ready || role !== "director") return;
    recalcAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, role, since]);

  useEffect(() => {
    if (!ready || role !== "director" || !person) return;
    recalcPerson();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, role, person, since, people]);

  useEffect(() => {
    if (!ready || role !== "director") return;
    if (section !== "hr") return;
    loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, role, section]);

  // operacje finansowe
  const deposit = async (v: number) => {
    if (v <= 0) return;
    const ref = doc(db, "accounts", "dps");
    await setDoc(ref, { manualDelta: 0, createdAt: serverTimestamp() }, { merge: true });
    await updateDoc(ref, { manualDelta: increment(v) });
    await recalcAll();
  };
  const withdraw = async (v: number) => {
    if (v <= 0) return;
    const ref = doc(db, "accounts", "dps");
    await setDoc(ref, { manualDelta: 0, createdAt: serverTimestamp() }, { merge: true });
    await updateDoc(ref, { manualDelta: increment(-v) });
    await recalcAll();
  };
  const withdrawAll = async () => {
    const ref = doc(db, "accounts", "dps");
    await setDoc(ref, { manualDelta: 0, createdAt: serverTimestamp() }, { merge: true });
    await updateDoc(ref, { manualDelta: -baseTotal });
    await recalcAll();
  };

  const resetPerson = async () => {
    if (!person) return;
    const p = people.find((x) => x.uid === person);
    const label = p?.fullName || p?.login || person;
    const ok = await confirm({
      title: "Wyzeruj statystyki",
      message: `Wyzerować licznik dla ${label}? (nie wpływa na ogólne)`,
      confirmLabel: "Wyzeruj",
      tone: "danger",
    });
    if (!ok) return;
    await setDoc(doc(db, "profiles", person, "counters", "personal"), { lastResetAt: serverTimestamp() }, { merge: true });
    await recalcPerson();
  };

  const clearStats = async () => {
    const input = await prompt({
      title: "Wyczyść statystyki",
      message: "Podaj liczbę dni, z których chcesz usunąć statystyki (np. 7).",
      confirmLabel: "Dalej",
      cancelLabel: "Anuluj",
      placeholder: "np. 7",
    });
    if (input == null) return;
    const days = Number(input);
    if (!Number.isFinite(days) || days <= 0) {
      await alert({
        title: "Nieprawidłowa wartość",
        message: "Podaj dodatnią liczbę dni.",
        tone: "info",
      });
      return;
    }
    const normalizedDays = Math.floor(days);
    if (normalizedDays <= 0) {
      await alert({
        title: "Nieprawidłowa wartość",
        message: "Podaj dodatnią liczbę dni.",
        tone: "info",
      });
      return;
    }
    const ok = await confirm({
      title: "Potwierdź czyszczenie",
      message: `Na pewno usunąć statystyki z ostatnich ${normalizedDays} dni? Spowoduje to również usunięcie wpisów z archiwum.`,
      confirmLabel: "Wyczyść",
      tone: "danger",
    });
    if (!ok) return;

    try {
      setErr(null);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - normalizedDays);
      const cutoffTs = Timestamp.fromDate(cutoff);
      const archivesRef = collection(db, "archives");
      const snap = await getDocs(query(archivesRef, where("createdAt", ">=", cutoffTs)));

      let batch = writeBatch(db);
      const commits: Promise<void>[] = [];
      let counter = 0;
      snap.docs.forEach((docSnap, idx) => {
        batch.delete(docSnap.ref);
        counter += 1;
        if (counter === 400 || idx === snap.docs.length - 1) {
          commits.push(batch.commit());
          batch = writeBatch(db);
          counter = 0;
        }
      });
      await Promise.all(commits);
      await addDoc(collection(db, "logs"), {
        type: "stats_clear",
        days: normalizedDays,
        removed: snap.size,
        author: login,
        ts: serverTimestamp(),
      });

      await recalcAll();
      await recalcPerson();
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Nie udało się wyczyścić statystyk.");
    }
  };


  // UI
  if (!ready) {
    return (
      <AuthGate>
         <Head><title>LSPD 77RP — Panel zarządu</title></Head>
        <Nav />
        <div className="max-w-6xl mx-auto px-4 py-8"><div className="card p-6">Ładowanie…</div></div>
      </AuthGate>
    );
  }
  if (role !== "director") {
    return (
      <AuthGate>
        <Head><title>LSPD 77RP — Panel zarządu</title></Head>
        <Nav />
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="card p-6 text-center">Brak dostępu. Tylko <b>Director</b> może otworzyć Panel zarządu.</div>
        </div>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <Head><title>LSPD 77RP — Panel zarządu</title></Head>
      <Nav />

      <div className="max-w-7xl mx-auto px-4 py-6 grid gap-5">
        {err && <div className="card p-3 bg-red-50 text-red-700">{err}</div>}

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">Panel zarządu</h1>
          <span className="text-sm text-beige-700">Zalogowany: {fullName || login} ({login})</span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <aside className="card bg-gradient-to-br from-slate-900 via-blue-900 to-purple-900 text-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold mb-4">Sekcje</h2>
            <div className="grid gap-2 text-sm">
              <button type="button" className={sectionButtonClass("overview")} onClick={() => setSection("overview")}>
                <span className="text-base font-semibold">Podsumowanie</span>
                <span className="block text-xs text-white/70">Statystyki i finanse</span>
              </button>
              <button type="button" className={sectionButtonClass("hr")} onClick={() => setSection("hr")}>
                <span className="text-base font-semibold">Dział Kadr</span>
                <span className="block text-xs text-white/70">Kontrola kont i rang</span>
              </button>
              <button type="button" className={sectionButtonClass("announcements")} onClick={() => setSection("announcements")}>
                <span className="text-base font-semibold">Ogłoszenia</span>
                <span className="block text-xs text-white/70">Komunikaty dla funkcjonariuszy</span>
              </button>
              <button type="button" className={sectionButtonClass("logs")} onClick={() => setSection("logs")}>
                <span className="text-base font-semibold">Logi</span>
                <span className="block text-xs text-white/70">Aktywność kont</span>
              </button>
            </div>
          </aside>

          <div className="grid gap-6">
            {section === "overview" && (
              <div className="grid gap-6">
                <div className="card p-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-xl font-semibold">Podsumowanie działań</h2>
                    <p className="text-sm text-beige-700">Okres raportowania: {rangeLabel}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select className="input w-48" value={range} onChange={(e) => setRange(e.target.value as Range)}>
                      <option value="all">Od początku</option>
                      <option value="30">Ostatnie 30 dni</option>
                      <option value="7">Ostatnie 7 dni</option>
                    </select>
                    <button className="btn bg-red-700 text-white" onClick={clearStats}>
                      Wyczyść statystyki
                    </button>
                  </div>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                  <div className="card p-4 bg-white/70">
                    <div className="text-sm text-beige-700">Liczba mandatów</div>
                    <div className="text-3xl font-bold">{mandaty}</div>
                  </div>
                  <div className="card p-4 bg-white/70">
                    <div className="text-sm text-beige-700">Kontrole LSEB</div>
                    <div className="text-3xl font-bold">{lseb}</div>
                  </div>
                  <div className="card p-4 bg-white/70">
                    <div className="text-sm text-beige-700">Areszty</div>
                    <div className="text-3xl font-bold">{areszty}</div>
                  </div>
                </div>

                <div className="card p-5 grid gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm text-beige-700">Stan konta DPS</div>
                    <span className="text-3xl font-bold tracking-tight">${balance.toFixed(2)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input id="kw" className="input w-40" placeholder="Kwota (USD)" />
                    <button
                      className="btn"
                      onClick={() => {
                        const v = Number((document.getElementById("kw") as HTMLInputElement)?.value || 0);
                        deposit(v).catch((e) => setErr(e.message));
                      }}
                    >
                      Wpłać
                    </button>
                    <button
                      className="btn"
                      onClick={() => {
                        const v = Number((document.getElementById("kw") as HTMLInputElement)?.value || 0);
                        withdraw(v).catch((e) => setErr(e.message));
                      }}
                    >
                      Wypłać
                    </button>
                    <button
                      className="btn bg-red-700 text-white"
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Wypłać środki",
                          message: "Na pewno wypłacić całe saldo konta DPS?",
                          confirmLabel: "Wypłać wszystko",
                          tone: "danger",
                        });
                        if (ok) withdrawAll().catch((e) => setErr(e.message));
                      }}
                    >
                      Wypłać wszystko
                    </button>
                  </div>
                </div>

                <div className="card p-5 grid gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold">Funkcjonariusz:</span>
                    <select className="input w-64" value={person} onChange={(e) => setPerson(e.target.value)}>
                      {people.map((p) => (
                        <option key={p.uid} value={p.uid}>
                          {p.fullName || p.login || p.uid}
                        </option>
                      ))}
                    </select>
                    <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
                      <span>Okres:</span>
                      <select className="input w-40" value={range} onChange={(e) => setRange(e.target.value as Range)}>
                        <option value="all">Cały okres</option>
                        <option value="30">30 dni</option>
                        <option value="7">7 dni</option>
                      </select>
                    </div>
                    <button className="btn bg-red-700 text-white" onClick={resetPerson}>
                      Wyzeruj licznik tego funkcjonariusza
                    </button>
                  </div>

                  <div className="grid md:grid-cols-4 gap-4">
                    <div className="card p-4 bg-white/70">
                      <div className="text-sm text-beige-700">Mandaty</div>
                      <div className="text-2xl font-bold">{pStats.m}</div>
                    </div>
                    <div className="card p-4 bg-white/70">
                      <div className="text-sm text-beige-700">Kontrole LSEB</div>
                      <div className="text-2xl font-bold">{pStats.k}</div>
                    </div>
                    <div className="card p-4 bg-white/70">
                      <div className="text-sm text-beige-700">Areszty</div>
                      <div className="text-2xl font-bold">{pStats.a}</div>
                    </div>
                    <div className="card p-4 bg-white/70">
                      <div className="text-sm text-beige-700">Przychód dla DPS</div>
                      <div className="text-2xl font-bold">${pStats.income.toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {section === "hr" && (
              <div className="grid gap-5">
                <div className="card bg-gradient-to-br from-sky-900/85 via-indigo-900/80 to-purple-900/80 text-white p-6 shadow-xl">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="flex-1">
                      <h2 className="text-xl font-semibold">Dział Kadr</h2>
                      <p className="text-sm text-white/70">Zarządzaj kontami funkcjonariuszy DPS.</p>
                    </div>
                    <button
                      type="button"
                      className="btn border-white/40 bg-white/10 text-white hover:bg-white/20"
                      onClick={openCreateAccount}
                    >
                      Nowe konto
                    </button>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <input
                    className="input w-full md:w-72 bg-white text-black placeholder:text-slate-500"
                      placeholder="Szukaj po loginie lub imieniu..."
                      value={accountSearch}
                      onChange={(e) => setAccountSearch(e.target.value)}
                    />
                    <span className="text-xs text-white/60">Domena logowania: @{loginDomain}</span>
                  </div>
                </div>

                <div className="grid gap-3">
                  {accountsLoading ? (
                    <div className="card p-5 text-center">Ładowanie kont…</div>
                  ) : filteredAccounts.length === 0 ? (
                    <div className="card p-5 text-center">Brak kont spełniających kryteria.</div>
                  ) : (
                    filteredAccounts.map((acc) => (
                      <div
                        key={acc.uid}
                        className="card p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                      >
                        <div>
                          <h3 className="text-lg font-semibold">{acc.fullName || "Bez nazwy"}</h3>
                          <p className="text-sm text-beige-700">
                            Login: <span className="font-mono text-base">{acc.login}@{loginDomain}</span>
                          </p>
                          <p className="text-xs uppercase tracking-wide text-beige-600 mt-1">
                            Ranga: {ROLE_NAMES[acc.role] || acc.role}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button className="btn" onClick={() => openEditAccount(acc)}>Edytuj</button>
                          <button
                            className="btn bg-red-700 text-white"
                            onClick={() => removeAccount(acc)}
                            disabled={accountActionUid === acc.uid}
                          >
                            {accountActionUid === acc.uid ? "Usuwanie..." : "Usuń"}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {section === "announcements" && (
              <div className="grid gap-5">
                <div className="card bg-gradient-to-br from-purple-900/85 via-indigo-900/80 to-blue-900/80 text-white p-6 shadow-xl">
                  <h2 className="text-xl font-semibold">Ogłoszenia</h2>
                  <p className="text-sm text-white/70">
                    Komunikaty są wyświetlane na stronie dokumentów, teczek i archiwum.
                  </p>
                  <textarea
                    className="mt-4 h-44 w-full rounded-2xl border border-white/30 bg-white/10 px-4 py-3 text-sm text-white shadow-inner placeholder:text-white/60 focus:border-white focus:outline-none focus:ring-2 focus:ring-white/70"
                    value={announcementMessage}
                    onChange={(e) => setAnnouncementMessage(e.target.value)}
                    placeholder="Treść ogłoszenia..."
                  />
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-white/80">Czas wyświetlania:</span>
                      <select
                         className="input bg-white text-black"
                        value={announcementDuration}
                        onChange={(e) => setAnnouncementDuration(e.target.value)}
                      >
                        {ANNOUNCEMENT_WINDOWS.map((w) => (
                          <option key={w.value} value={w.value}>
                            {w.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      className="btn border-white/30 bg-white/10 text-white hover:bg-white/20"
                      onClick={publishAnnouncement}
                      disabled={announcementSaving}
                    >
                      {announcementSaving ? "Zapisywanie..." : "Opublikuj"}
                    </button>
                    <button
                      className="btn bg-red-600/80 text-white"
                      onClick={removeAnnouncement}
                      disabled={announcementSaving || !announcement?.message}
                    >
                      Usuń
                    </button>
                  </div>

                  {announcement?.message && (
                    <div className="mt-5 rounded-2xl border border-white/30 bg-black/30 p-4 text-sm text-white/80">
                      <div className="font-semibold text-white">Aktualnie opublikowane</div>
                      <p className="mt-2 whitespace-pre-wrap">{announcement.message}</p>
                      <div className="mt-2 text-xs text-white/60 flex flex-wrap gap-2">
                        <span>
                          Widoczne: {
                            ANNOUNCEMENT_WINDOWS.find((w) => w.value === announcement.duration)?.label || "—"
                          }
                        </span>
                        <span>
                          {announcement.expiresAtDate
                            ? `Wygasa: ${announcement.expiresAtDate.toLocaleString()}`
                            : "Wygasa: do czasu usunięcia"}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {section === "logs" && (
              <div className="grid gap-5">
                <div className="card bg-gradient-to-br from-amber-900/85 via-amber-800/85 to-stone-900/80 text-white p-6 shadow-xl">
                  <h2 className="text-xl font-semibold">Monitor aktywności</h2>
                  <p className="text-sm text-white/70">
                    Historia logowań, wylogowań oraz odwiedzanych sekcji panelu. Dostępna wyłącznie dla Director.
                  </p>
                  <p className="mt-2 text-xs text-white/60">Rejestrowanych jest maksymalnie 250 ostatnich zdarzeń.</p>
                </div>

                <div className="card p-0 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-beige-200 text-sm">
                      <thead className="bg-beige-100">
                        <tr className="text-left">
                          <th className="px-4 py-3 font-semibold">Data</th>
                          <th className="px-4 py-3 font-semibold">Użytkownik</th>
                          <th className="px-4 py-3 font-semibold">Typ</th>
                          <th className="px-4 py-3 font-semibold">Szczegóły</th>
                          <th className="px-4 py-3 font-semibold">Czas sesji</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-beige-100 bg-white/60">
                        {logsLoading ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center">Ładowanie logów…</td>
                          </tr>
                        ) : activityLogs.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center">Brak zarejestrowanych zdarzeń.</td>
                          </tr>
                        ) : (
                          activityLogs.map((log, idx) => (
                            <tr key={log.id ?? idx} className="align-top">
                              <td className="px-4 py-3 whitespace-nowrap">{formatLogTimestamp(log)}</td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <div className="font-semibold">{log.login || "—"}</div>
                                <div className="text-xs text-beige-700">{log.uid || "—"}</div>
                                {log.sessionId && (
                                  <div className="text-[11px] text-beige-500">Sesja: {log.sessionId}</div>
                                )}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap">
                                <span className="inline-flex items-center rounded-full bg-beige-200 px-2 py-0.5 text-xs font-semibold text-beige-900">
                                  {log.type || "—"}
                                </span>
                              </td>
                              <td className="px-4 py-3">{describeLog(log)}</td>
                              <td className="px-4 py-3 whitespace-nowrap">{formatDuration(log.durationMs)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

       {editorState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-3xl border border-indigo-400 bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 p-6 text-white shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-semibold">
                  {editorState.mode === "create" ? "Nowe konto" : "Edytuj konto"}
                </h2>
                <p className="text-sm text-white/70 mt-1">Loginy wykorzystują domenę @{loginDomain}.</p>
              </div>
              <button
                type="button"
                className="text-white/70 hover:text-white"
                onClick={() => setEditorState(null)}
              >
                ✕
              </button>
            </div>
            

          <div className="mt-4 grid gap-4">
              <div>
                <label className="text-sm font-semibold text-white/80">Login</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    className="input flex-1 bg-white text-black placeholder:text-slate-500"
                    value={editorState.account.login || ""}
                    onChange={(e) =>
                      setEditorState((prev) =>
                        prev ? { ...prev, account: { ...prev.account, login: e.target.value } } : prev
                      )
                    }
                  />
                  <span className="text-sm text-white/70">@{loginDomain}</span>
                </div>
                <p className="mt-1 text-xs text-white/60">
                  Dozwolone znaki: małe litery, cyfry, kropki, myślniki i podkreślniki.
                </p>
              </div>

              <div>
                <label className="text-sm font-semibold text-white/80">Imię i nazwisko</label>
                <input
                className="input bg-white text-black placeholder:text-slate-500"
                  value={editorState.account.fullName || ""}
                  onChange={(e) =>
                    setEditorState((prev) =>
                      prev ? { ...prev, account: { ...prev.account, fullName: e.target.value } } : prev
                    )
                  }
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-white/80">Ranga</label>
                <select
                  className="input bg-white text-black"
                  value={editorState.account.role || "rookie"}
                  onChange={(e) =>
                    setEditorState((prev) =>
                      prev
                        ? { ...prev, account: { ...prev.account, role: e.target.value as Role } }
                        : prev
                    )
                  }
                >
                  {Object.entries(ROLE_NAMES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-semibold text-white/80">
                  {editorState.mode === "create" ? "Hasło" : "Nowe hasło"}
                </label>
                <input
                  type="password"
                  className="input bg-white text-black placeholder:text-slate-500"
                  value={editorState.password || ""}
                  placeholder={editorState.mode === "create" ? "Wprowadź hasło" : "Pozostaw puste aby nie zmieniać"}
                  onChange={(e) =>
                    setEditorState((prev) => (prev ? { ...prev, password: e.target.value } : prev))
                  }
                />
                <p className="mt-1 text-xs text-white/60">Hasło musi mieć co najmniej 6 znaków.</p>
              </div>
            </div>
            
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="btn border-white/30 bg-white/10 text-white hover:bg-white/20"
                onClick={() => setEditorState(null)}
                disabled={accountSaving}
              >
                Anuluj
              </button>
              <button
                className="btn bg-white text-indigo-900 font-semibold hover:bg-white/90"
                onClick={saveAccount}
                disabled={accountSaving}
              >
                {accountSaving ? "Zapisywanie..." : "Zapisz"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AuthGate>
  );
}
