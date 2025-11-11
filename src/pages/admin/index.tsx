import Head from "next/head";
import Nav from "@/components/Nav";
import AuthGate from "@/components/AuthGate";
import { useProfile, Role } from "@/hooks/useProfile";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  orderBy,
  limit,
  startAfter,
} from "firebase/firestore";
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useDialog } from "@/components/DialogProvider";
import { useAnnouncement } from "@/hooks/useAnnouncement";
import { VEHICLE_FLAGS } from "@/lib/vehicleFlags";
import { deriveLoginFromEmail } from "@/lib/login";

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

const LOG_PAGE_SIZE = 150;
const LOG_FETCH_BATCH = 200;

type LogCategory =
  | "session"
  | "navigation"
  | "documents"
  | "archive"
  | "vehicles"
  | "dossiers"
  | "administration"
  | "other";

const LOG_CATEGORY_LABELS: Record<LogCategory, string> = {
  session: "Sesje i logowania",
  navigation: "Nawigacja",
  documents: "Dokumenty",
  archive: "Archiwum",
  vehicles: "Pojazdy",
  dossiers: "Teczki i organizacje",
  administration: "Administracja",
  other: "Pozostałe",
};

const LOG_TYPE_META: Record<string, { label: string; category: LogCategory }> = {
  session_start: { label: "Rozpoczęcie sesji", category: "session" },
  session_end: { label: "Zakończenie sesji", category: "session" },
  logout: { label: "Wylogowanie", category: "session" },
  login_success: { label: "Udane logowanie", category: "session" },
  login_fail: { label: "Nieudane logowanie", category: "session" },
  page_view: { label: "Wejście na stronę", category: "navigation" },
  template_view: { label: "Podgląd szablonu", category: "documents" },
  doc_sent: { label: "Wysłanie dokumentu", category: "documents" },
  archive_view: { label: "Podgląd archiwum", category: "archive" },
  archive_image_open: { label: "Podgląd obrazu archiwum", category: "archive" },
  archive_delete: { label: "Usunięcie wpisu archiwum", category: "archive" },
  archive_clear: { label: "Czyszczenie archiwum", category: "archive" },
  vehicle_archive_view: { label: "Lista pojazdów", category: "vehicles" },
  vehicle_folder_view: { label: "Teczka pojazdu", category: "vehicles" },
  vehicle_create: { label: "Utworzenie teczki pojazdu", category: "vehicles" },
  vehicle_update: { label: "Aktualizacja pojazdu", category: "vehicles" },
  vehicle_delete: { label: "Usunięcie teczki pojazdu", category: "vehicles" },
  vehicle_flag_update: { label: "Zmiana oznaczenia pojazdu", category: "vehicles" },
  vehicle_note_add: { label: "Dodanie notatki pojazdu", category: "vehicles" },
  vehicle_note_edit: { label: "Edycja notatki pojazdu", category: "vehicles" },
  vehicle_note_delete: { label: "Usunięcie notatki pojazdu", category: "vehicles" },
  vehicle_note_from_doc: { label: "Notatka z dokumentu", category: "vehicles" },
  vehicle_note_payment: { label: "Rozliczenie płatności", category: "vehicles" },
  vehicle_group_link_add: { label: "Powiązanie pojazdu z grupą", category: "vehicles" },
  vehicle_group_link_remove: { label: "Usunięcie powiązania pojazdu", category: "vehicles" },
  vehicle_from_dossier_open: { label: "Pojazd z teczki", category: "vehicles" },
  dossier_view: { label: "Podgląd teczki", category: "dossiers" },
  dossier_link_open: { label: "Przejście do teczki", category: "dossiers" },
  dossier_evidence_open: { label: "Podgląd dowodu w teczce", category: "dossiers" },
  dossier_record_add: { label: "Dodanie wpisu do teczki", category: "dossiers" },
  dossier_record_edit: { label: "Edycja wpisu w teczce", category: "dossiers" },
  dossier_record_delete: { label: "Usunięcie wpisu z teczki", category: "dossiers" },
  dossier_group_link_add: { label: "Powiązanie grupy z teczką", category: "dossiers" },
  dossier_group_link_remove: { label: "Usunięcie powiązania grupy", category: "dossiers" },
  dossier_create: { label: "Utworzenie teczki", category: "dossiers" },
  dossier_delete: { label: "Usunięcie teczki", category: "dossiers" },
  criminal_group_open: { label: "Podgląd organizacji", category: "dossiers" },
  stats_clear: { label: "Wyczyszczenie statystyk", category: "administration" },
};

const VEHICLE_FLAG_LABELS: Record<string, string> = VEHICLE_FLAGS.reduce((acc, flag) => {
  acc[flag.key] = flag.label;
  return acc;
}, {} as Record<string, string>);

const DEFAULT_LOG_FILTERS = {
  account: "",
  category: "all",
  type: "all",
  dateFrom: "",
  dateTo: "",
} as const;

const VEHICLE_FIELD_LABELS: Record<string, string> = {
  registration: "Numer rejestracyjny",
  brand: "Marka",
  color: "Kolor",
  ownerName: "Właściciel",
  ownerCid: "CID właściciela",
};

const DOSSIER_RECORD_LABELS: Record<string, string> = {
  note: "Notatka",
  weapon: "Broń",
  drug: "Narkotyk",
  explosive: "Materiał wybuchowy",
  member: "Członek organizacji",
  vehicle: "Pojazd",
  "group-link": "Powiązanie z organizacją",
};

const USD_FORMATTER = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

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
  const [logsCursor, setLogsCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [logsExhausted, setLogsExhausted] = useState(false);
  const [logsPage, setLogsPage] = useState(1);
  const [logsFilters, setLogsFilters] = useState(() => ({ ...DEFAULT_LOG_FILTERS }));
  const [nowMs, setNowMs] = useState(() => Date.now());

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

  const accountOptions = useMemo(() => {
    const entries = [...people];
    entries.sort((a, b) => {
      const nameA = (a.fullName || a.login || a.uid || "").toLowerCase();
      const nameB = (b.fullName || b.login || b.uid || "").toLowerCase();
      return nameA.localeCompare(nameB, "pl");
    });
    return entries.map((p) => {
      const loginValue = normalizeLoginValue(p.login);
      const value = loginValue ? `login:${loginValue}` : `uid:${p.uid}`;
      const labelBase = p.fullName || p.login || p.uid;
      const secondary = loginValue ? loginValue : p.uid;
      return {
        value,
        label: `${labelBase || secondary} (${secondary})`,
      };
    });
  }, [people]);

  const peopleByLogin = useMemo(() => {
    const map = new Map<string, Person>();
    people.forEach((p) => {
      const loginValue = normalizeLoginValue(p.login);
      if (loginValue) {
        map.set(loginValue, p);
      }
    });
    return map;
  }, [people]);

  const peopleByUid = useMemo(() => {
    const map = new Map<string, Person>();
    people.forEach((p) => {
      if (p.uid) {
        map.set(p.uid, p);
      }
    });
    return map;
  }, [people]);

  const categoryOptions = useMemo(() => {
    const categories = new Set<LogCategory>();
    Object.values(LOG_TYPE_META).forEach((meta) => categories.add(meta.category));
    return Array.from(categories)
      .sort((a, b) => LOG_CATEGORY_LABELS[a].localeCompare(LOG_CATEGORY_LABELS[b], "pl"))
      .map((category) => ({ value: category, label: LOG_CATEGORY_LABELS[category] }));
  }, []);

  const typeOptions = useMemo(() => {
    return Object.entries(LOG_TYPE_META)
      .filter(([, meta]) => logsFilters.category === "all" || meta.category === logsFilters.category)
      .sort((a, b) => a[1].label.localeCompare(b[1].label, "pl"))
      .map(([value, meta]) => ({ value, label: meta.label }));
  }, [logsFilters.category]);

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
    if (section !== "logs") return;
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [section]);


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

  const normalizeLoginValue = (value?: string | null) => {
    if (!value) return "";
    const trimmed = String(value).trim();
    if (!trimmed) return "";
    return deriveLoginFromEmail(trimmed).toLowerCase();
  };

  const extractLogLogin = (log: any): string | null => {
    const candidates = [
      typeof log?.login === "string" ? log.login : null,
      typeof log?.by === "string" ? log.by : null,
      typeof log?.author === "string" ? log.author : null,
      typeof log?.authorLogin === "string" ? log.authorLogin : null,
      typeof log?.account?.login === "string" ? log.account.login : null,
    ];
    for (const candidate of candidates) {
      const normalized = normalizeLoginValue(candidate);
      if (normalized) return normalized;
    }
    return null;
  };

  const extractLogUid = (log: any): string | null => {
    const candidates = [
      typeof log?.uid === "string" ? log.uid : null,
      typeof log?.authorUid === "string" ? log.authorUid : null,
      typeof log?.userId === "string" ? log.userId : null,
      typeof log?.account?.uid === "string" ? log.account.uid : null,
    ];
    for (const candidate of candidates) {
      if (candidate && candidate.trim()) return candidate.trim();
    }
    return null;
  };

  const formatLogTypeLabel = (type?: string | null) => {
    if (!type) return "—";
    return LOG_TYPE_META[type]?.label || type;
  };

  const getLogCategory = (type?: string | null): LogCategory => {
    if (!type) return "other";
    return LOG_TYPE_META[type]?.category || "other";
  };

  const parseAccountFilter = (value: string): { kind: "login" | "uid" | null; value: string } => {
    if (!value) return { kind: null, value: "" };
    if (value.startsWith("uid:")) {
      return { kind: "uid", value: value.slice(4) };
    }
    if (value.startsWith("login:")) {
      return { kind: "login", value: value.slice(6) };
    }
    return { kind: "login", value: value };
  };

  const resolveLogUser = (log: any) => {
    const loginValue = extractLogLogin(log);
    const uidValue = extractLogUid(log);
    const person = loginValue ? peopleByLogin.get(loginValue) || null : null;
    const personByUid = !person && uidValue ? peopleByUid.get(uidValue) || null : null;
    const resolved = person || personByUid;
    const fullName = resolved?.fullName?.trim() || "";
    const loginFromPerson = resolved?.login ? normalizeLoginValue(resolved.login) : "";
    const finalLogin = loginFromPerson || loginValue || "";
    return {
      fullName: fullName || null,
      login: finalLogin || null,
      uid: uidValue || resolved?.uid || null,
      sessionId: typeof log?.sessionId === "string" && log.sessionId.trim() ? log.sessionId : null,
    };
  };

  const getLogTimestampMs = (log: any): number | null => {
    const raw = log?.ts || log?.createdAt;
    if (raw?.toDate && typeof raw.toDate === "function") {
      try {
        return raw.toDate().getTime();
      } catch (error) {
        return null;
      }
    }
    if (raw instanceof Date) {
      return raw.getTime();
    }
    if (typeof raw === "string") {
      const parsed = Date.parse(raw);
      return Number.isNaN(parsed) ? null : parsed;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw;
    }
    return null;
  };

  const formatLogTimestamp = (log: any) => {
    const timestamp = getLogTimestampMs(log);
    if (timestamp == null) return "—";
    try {
      return new Date(timestamp).toLocaleString("pl-PL");
    } catch (error) {
      return new Date(timestamp).toISOString();
    }
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

  const ensureLogsForPage = useCallback(
    async (page: number, reset = false) => {
      if (role !== "director") return;
      const required = page * LOG_PAGE_SIZE;
      if (!reset && activityLogs.length >= required) {
        setLogsLoading(false);
        return;
      }

      setLogsLoading(true);

      try {
        let items = reset ? [] : [...activityLogs];
        let cursor: QueryDocumentSnapshot<DocumentData> | null = reset ? null : logsCursor;
        let exhausted = reset ? false : logsExhausted;

        const { kind: accountFilterKind, value: rawAccountValue } = parseAccountFilter(logsFilters.account);
        const accountValue = accountFilterKind === "login" ? rawAccountValue.toLowerCase() : rawAccountValue;
        const categoryFilter = logsFilters.category !== "all" ? logsFilters.category : null;
        const typeFilter = logsFilters.type !== "all" ? logsFilters.type : null;
        const fromParsed = logsFilters.dateFrom ? Date.parse(logsFilters.dateFrom) : NaN;
        const toParsed = logsFilters.dateTo ? Date.parse(logsFilters.dateTo) : NaN;
        const dateFromMs = Number.isNaN(fromParsed) ? null : fromParsed;
        const dateToMs = Number.isNaN(toParsed) ? null : toParsed + 59_999;

        const matches = (log: any) => {
          if (typeFilter && (log?.type || "") !== typeFilter) return false;
          if (categoryFilter && getLogCategory(log?.type) !== categoryFilter) return false;
          if (accountFilterKind === "login") {
            const loginValue = extractLogLogin(log);
            if (!loginValue || loginValue !== accountValue) return false;
          } else if (accountFilterKind === "uid") {
            const uidValue = extractLogUid(log);
            if (!uidValue || uidValue !== accountValue) return false;
          }
          if (dateFromMs != null || dateToMs != null) {
            const ts = getLogTimestampMs(log);
            if (dateFromMs != null && (ts == null || ts < dateFromMs)) return false;
            if (dateToMs != null && (ts == null || ts > dateToMs)) return false;
          }
          return true;
        };

        while (items.length < required && !exhausted) {
          const constraints = [orderBy("ts", "desc"), limit(LOG_FETCH_BATCH)] as const;
          const q = cursor
            ? query(collection(db, "logs"), orderBy("ts", "desc"), startAfter(cursor), limit(LOG_FETCH_BATCH))
            : query(collection(db, "logs"), ...constraints);
          const snap = await getDocs(q);
          if (snap.empty) {
            exhausted = true;
            break;
          }
          cursor = snap.docs[snap.docs.length - 1];
          let reachedOlderThanFrom = false;
          for (const docSnap of snap.docs) {
            const data = { id: docSnap.id, ...(docSnap.data() as any) };
            const ts = getLogTimestampMs(data);
            if (dateToMs != null && ts != null && ts > dateToMs) {
              continue;
            }
            if (dateFromMs != null && ts != null && ts < dateFromMs) {
              reachedOlderThanFrom = true;
              break;
            }
            if (matches(data)) {
              items.push(data);
            }
          }
          if (reachedOlderThanFrom) {
            exhausted = true;
            break;
          }
          if (snap.docs.length < LOG_FETCH_BATCH) {
            exhausted = true;
          }
        }

        setActivityLogs(items);
        setLogsCursor(cursor);
        setLogsExhausted(exhausted);
      } catch (error) {
        console.error("Nie udało się pobrać logów aktywności:", error);
      } finally {
        setLogsLoading(false);
      }
    },
    [
      activityLogs,
      extractLogLogin,
      extractLogUid,
      getLogTimestampMs,
      logsCursor,
      logsExhausted,
      logsFilters,
      parseAccountFilter,
      role,
    ]
  );

  useEffect(() => {
    if (!ready || role !== "director") return;
    if (section !== "logs") return;
    setLogsPage(1);
    void ensureLogsForPage(1, true);
  }, [ensureLogsForPage, ready, role, section, logsFilters]);

  useEffect(() => {
    if (!ready || role !== "director") return;
    if (section !== "logs") return;
    if (activityLogs.length >= logsPage * LOG_PAGE_SIZE) return;
    if (logsExhausted) return;
    void ensureLogsForPage(logsPage, false);
  }, [activityLogs.length, ensureLogsForPage, logsExhausted, logsPage, ready, role, section]);

  const describeLog = (log: any) => {
    const type = log?.type || "";
    switch (type) {
      case "session_start": {
        const sessionId = log.sessionId || "—";
        return `Rozpoczęto sesję (ID: ${sessionId}).`;
      }
      case "session_end": {
        const sessionId = log.sessionId || "—";
        const reason = formatReason(log.reason);
        return `Zamknięto sesję (ID: ${sessionId}, powód: ${reason}).`;
      }
      case "logout": {
        const reason = formatReason(log.reason);
        return `Wylogowanie użytkownika (powód: ${reason}).`;
      }
      case "login_success": {
        const loginValue = extractLogLogin(log) || log.login || "—";
        return `Udane logowanie jako ${loginValue}.`;
      }
      case "login_fail": {
        const loginValue = extractLogLogin(log) || log.login || "—";
        return `Nieudana próba logowania jako ${loginValue}.`;
      }
      case "page_view": {
        const path = log.path || "—";
        const title = log.title ? ` (${log.title})` : "";
        return `Odwiedzono stronę ${path}${title}.`;
      }
      case "template_view":
        return `Podgląd szablonu: ${log.template || log.slug || "—"}.`;
      case "doc_sent": {
        const officers: string[] = Array.isArray(log.officers) ? log.officers : [];
        const officersText = officers.length ? officers.join(", ") : "—";
        return `Wysłano dokument "${log.template || "—"}". Funkcjonariusze: ${officersText}.`;
      }
      case "archive_view":
        return "Podgląd listy dokumentów w archiwum.";
      case "archive_image_open":
        return `Podgląd pliku archiwalnego (ID: ${log.archiveId || "—"}).`;
      case "archive_delete": {
        const title = log.archiveTitle || log.title || log.templateName || log.id || "—";
        return `Usunięto wpis z archiwum: ${title}.`;
      }
      case "archive_clear":
        return `Wyczyszczono archiwum (usunięto ${log.removed ?? 0} wpisów).`;
      case "vehicle_archive_view":
        return "Przegląd listy teczek pojazdów.";
      case "vehicle_folder_view": {
        const registration = log.registration || log.vehicleRegistration || log.vehicleId || "—";
        return `Otworzono teczkę pojazdu ${registration}.`;
      }
      case "vehicle_create": {
        const registration = log.registration || "—";
        const owner = log.ownerName || "nieznany właściciel";
        const cid = log.ownerCid ? ` (CID ${log.ownerCid})` : "";
        return `Utworzono teczkę pojazdu ${registration} — właściciel ${owner}${cid}.`;
      }
      case "vehicle_update": {
        const registration = log.registration || log.vehicleId || "—";
        const changes = Array.isArray(log.changes) ? log.changes : [];
        if (changes.length) {
          const changeText = changes
            .map((change: any) => {
              const key = change?.field as string;
              const label = VEHICLE_FIELD_LABELS[key] || key;
              const before = change?.before ?? "—";
              const after = change?.after ?? "—";
              return `${label}: ${before} → ${after}`;
            })
            .join(" • ");
          return `Zmieniono dane pojazdu ${registration}. ${changeText}`;
        }
        return `Zaktualizowano dane pojazdu ${registration}.`;
      }
      case "vehicle_delete": {
        const registration = log.registration || log.vehicleId || "—";
        return `Usunięto teczkę pojazdu ${registration}.`;
      }
      case "vehicle_flag_update": {
        const flagKey = log.flag || "";
        const label = VEHICLE_FLAG_LABELS[flagKey] || flagKey || "oznaczenie";
        const value = typeof log.value === "boolean" ? (log.value ? "włączono" : "wyłączono") : "zaktualizowano";
        return `Oznaczenie pojazdu ${label} — ${value}.`;
      }
      case "vehicle_note_add": {
        const preview = log.notePreview ? ` "${log.notePreview}"` : "";
        return `Dodano notatkę do pojazdu.${preview}`;
      }
      case "vehicle_note_edit": {
        const before = log.previousPreview ? `z "${log.previousPreview}" ` : "";
        const after = log.notePreview ? `na "${log.notePreview}"` : "na nową treść";
        return `Zmieniono notatkę pojazdu ${before}${after}.`;
      }
      case "vehicle_note_delete": {
        const preview = log.notePreview ? ` "${log.notePreview}"` : "";
        return `Usunięto notatkę pojazdu${preview}.`;
      }
      case "vehicle_note_from_doc":
        return `Utworzono notatkę w pojeździe na podstawie dokumentu "${log.template || "—"}" (archiwum: ${log.archiveId || "—"}).`;
      case "vehicle_note_payment": {
        const status = log.status === "paid" ? "opłacono" : log.status === "unpaid" ? "oznaczono jako nieopłacone" : "zaktualizowano";
        const amount = typeof log.amount === "number" && Number.isFinite(log.amount) ? `, kwota ${USD_FORMATTER.format(log.amount)}` : "";
        return `Zmieniono status płatności notatki — ${status}${amount}.`;
      }
      case "vehicle_group_link_add": {
        const registration = log.vehicleRegistration || log.registration || log.vehicleId || "—";
        const group = log.groupName || log.groupId || "—";
        const details = [
          log.vehicleBrand ? `Model: ${log.vehicleBrand}` : null,
          log.vehicleColor ? `Kolor: ${log.vehicleColor}` : null,
          log.vehicleOwnerName
            ? `Właściciel: ${log.vehicleOwnerName}${log.vehicleOwnerCid ? ` (CID ${log.vehicleOwnerCid})` : ""}`
            : null,
        ]
          .filter(Boolean)
          .join(" • ");
        const suffix = details ? ` ${details}.` : "";
        return `Powiązano pojazd ${registration} z organizacją ${group}.${suffix}`;
      }
      case "vehicle_group_link_remove": {
        const registration = log.vehicleRegistration || log.registration || log.vehicleId || "—";
        const group = log.groupName || log.groupId || "—";
        const details = [
          log.vehicleBrand ? `Model: ${log.vehicleBrand}` : null,
          log.vehicleColor ? `Kolor: ${log.vehicleColor}` : null,
          log.vehicleOwnerName
            ? `Właściciel: ${log.vehicleOwnerName}${log.vehicleOwnerCid ? ` (CID ${log.vehicleOwnerCid})` : ""}`
            : null,
        ]
          .filter(Boolean)
          .join(" • ");
        const suffix = details ? ` ${details}.` : "";
        return `Usunięto powiązanie pojazdu ${registration} z organizacją ${group}.${suffix}`;
      }
      case "vehicle_from_dossier_open": {
        const dossier = log.dossierId || "—";
        const vehicle = log.vehicleId || log.registration || "—";
        return `Podgląd pojazdu ${vehicle} z teczki ${dossier}.`;
      }
      case "dossier_view":
        return `Podgląd teczki CID ${log.dossierId || "—"}.`;
      case "dossier_link_open":
        return `Przejście do teczki CID ${log.dossierId || "—"}.`;
      case "dossier_evidence_open":
        return `Podgląd dowodu ${log.recordId || "—"} w teczce CID ${log.dossierId || "—"}.`;
      case "dossier_record_add": {
        const recordType = log.recordType ? DOSSIER_RECORD_LABELS[log.recordType] || log.recordType : "wpis";
        const details = log.recordSummary ? ` Szczegóły: ${log.recordSummary}` : "";
        return `Dodano wpis (${recordType}) w teczce CID ${log.dossierId || "—"}.${details}`;
      }
      case "dossier_record_edit": {
        const recordType = log.recordType ? DOSSIER_RECORD_LABELS[log.recordType] || log.recordType : null;
        const typeSuffix = recordType ? ` (${recordType})` : "";
        const before = log.previousPreview ? ` z "${log.previousPreview}"` : "";
        const after = log.notePreview ? ` na "${log.notePreview}"` : " na nową treść";
        return `Zmieniono wpis${typeSuffix} ${log.recordId || "—"} w teczce CID ${log.dossierId || "—"}${before}${after}.`;
      }
      case "dossier_record_delete": {
        const recordType = log.recordType ? DOSSIER_RECORD_LABELS[log.recordType] || log.recordType : "wpis";
        const details = log.recordSummary ? ` Szczegóły: ${log.recordSummary}` : "";
        return `Usunięto wpis (${recordType}) z teczki CID ${log.dossierId || "—"}.${details}`;
      }
      case "dossier_group_link_add": {
        const group = log.groupName || log.groupId || "—";
        const memberDetails = [
          log.memberName || null,
          log.memberCid ? `CID ${log.memberCid}` : null,
          log.memberRankLabel || log.memberRank ? `Ranga: ${log.memberRankLabel || log.memberRank}` : null,
        ]
          .filter(Boolean)
          .join(" • ");
        const member = memberDetails ? ` Członek: ${memberDetails}.` : "";
        return `Powiązano teczkę CID ${log.dossierId || "—"} z organizacją ${group}.${member}`;
      }
      case "dossier_group_link_remove": {
        const group = log.groupName || log.groupId || "—";
        const memberParts = [
          log.memberName ? `Członek: ${log.memberName}` : null,
          log.memberCid ? `CID ${log.memberCid}` : null,
          log.memberRankLabel || log.memberRank ? `Ranga: ${log.memberRankLabel || log.memberRank}` : null,
        ].filter(Boolean);
        const memberText = memberParts.length ? ` (${memberParts.join(" • ")})` : "";
        return `Usunięto powiązanie teczki CID ${log.dossierId || "—"} z organizacją ${group}.${memberText}`;
      }
      case "dossier_create": {
        const first = log.first || "";
        const last = log.last || "";
        const cid = log.cid || "—";
        const name = `${first} ${last}`.trim() || "Nowa teczka";
        return `Utworzono teczkę dla ${name} (CID ${cid}).`;
      }
      case "dossier_delete":
        return `Usunięto teczkę CID ${log.dossierId || "—"}.`;
      case "criminal_group_open":
        return `Podgląd organizacji ${log.dossierId || "—"}.`;
      case "stats_clear": {
        const days = log.days != null ? log.days : "?";
        const removed = log.removed ?? 0;
        return `Wyczyszczono statystyki z ostatnich ${days} dni (usunięto ${removed} wpisów).`;
      }
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

  const activeSessionStarts = useMemo(() => {
    const map = new Map<string, number>();
    const chronological = [...activityLogs].reverse();
    chronological.forEach((log) => {
      const sessionId = log?.sessionId;
      if (!sessionId) return;
      const ts = getLogTimestampMs(log);
      if (ts == null) return;
      if (log.type === "session_start") {
        map.set(sessionId, ts);
      } else if (log.type === "session_end" || log.type === "logout") {
        map.delete(sessionId);
      }
    });
    return map;
  }, [activityLogs]);

  const resolveDurationMs = useCallback(
    (log: any): number | null => {
      if (typeof log?.durationMs === "number" && log.durationMs > 0) {
        return log.durationMs;
      }
      if (!log?.sessionId) return null;
      const start = activeSessionStarts.get(log.sessionId);
      if (!start) return null;
      return Math.max(0, nowMs - start);
    },
    [activeSessionStarts, nowMs]
  );

  const paginatedLogs = useMemo(() => {
    const start = (logsPage - 1) * LOG_PAGE_SIZE;
    const end = start + LOG_PAGE_SIZE;
    return activityLogs.slice(start, end);
  }, [activityLogs, logsPage]);

  const hasPrevPage = logsPage > 1;
  const hasNextPage = useMemo(() => {
    if (activityLogs.length > logsPage * LOG_PAGE_SIZE) return true;
    return !logsExhausted;
  }, [activityLogs.length, logsExhausted, logsPage]);

  const goToPrevPage = () => {
    setLogsPage((prev) => Math.max(1, prev - 1));
  };

  const goToNextPage = () => {
    setLogsPage((prev) => prev + 1);
  };

  const logsStartIndex = (logsPage - 1) * LOG_PAGE_SIZE;
  const logsDisplayedFrom = paginatedLogs.length ? logsStartIndex + 1 : 0;
  const logsDisplayedTo = logsStartIndex + paginatedLogs.length;
  const logsTotalLabel = logsExhausted ? `${activityLogs.length}` : `${activityLogs.length}+`;


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
                    Historia logowań, zmian i operacji wykonanych w panelu. Dostępna wyłącznie dla Director.
                  </p>
                  <p className="mt-2 text-xs text-white/60">
                    Na każdej stronie prezentujemy maksymalnie {LOG_PAGE_SIZE} wpisów. Skorzystaj z filtrów, aby szybko odnaleźć konkretne zdarzenia.
                  </p>
                </div>

                <div className="card bg-white/70 p-5">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-beige-700">Funkcjonariusz</label>
                      <select
                        className="input mt-1 bg-white text-black"
                        value={logsFilters.account}
                        onChange={(e) => setLogsFilters((prev) => ({ ...prev, account: e.target.value }))}
                      >
                        <option value="">Wszyscy</option>
                        {accountOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-beige-700">Sekcja</label>
                      <select
                        className="input mt-1 bg-white text-black"
                        value={logsFilters.category}
                        onChange={(e) =>
                          setLogsFilters((prev) => ({ ...prev, category: e.target.value, type: "all" }))
                        }
                      >
                        <option value="all">Wszystkie sekcje</option>
                        {categoryOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-beige-700">Czynność</label>
                      <select
                        className="input mt-1 bg-white text-black"
                        value={logsFilters.type}
                        onChange={(e) => setLogsFilters((prev) => ({ ...prev, type: e.target.value }))}
                      >
                        <option value="all">Wszystkie czynności</option>
                        {typeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-beige-700">Od daty</label>
                      <input
                        type="datetime-local"
                        className="input mt-1 bg-white text-black"
                        value={logsFilters.dateFrom}
                        onChange={(e) => setLogsFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-beige-700">Do daty</label>
                      <input
                        type="datetime-local"
                        className="input mt-1 bg-white text-black"
                        value={logsFilters.dateTo}
                        onChange={(e) => setLogsFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-beige-700">
                    <span>Zakres czasu jest interpretowany według lokalnej strefy czasowej urządzenia.</span>
                    <button
                      type="button"
                      className="rounded-full border border-beige-300 bg-white px-3 py-1 text-sm font-medium text-beige-800 hover:bg-beige-100 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => setLogsFilters({ ...DEFAULT_LOG_FILTERS })}
                    >
                      Wyczyść filtry
                    </button>
                  </div>
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
                        {logsLoading && paginatedLogs.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center">Ładowanie logów…</td>
                          </tr>
                        ) : paginatedLogs.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-4 py-6 text-center">Brak zarejestrowanych zdarzeń dla wybranych filtrów.</td>
                          </tr>
                        ) : (
                          <>
                            {paginatedLogs.map((log, idx) => {
                              const userInfo = resolveLogUser(log);
                              const rawLoginCandidate =
                                typeof log?.login === "string" && log.login.trim()
                                  ? log.login
                                  : typeof log?.by === "string" && log.by.trim()
                                  ? log.by
                                  : typeof log?.author === "string" && log.author.trim()
                                  ? log.author
                                  : "";
                              const fallbackLogin = normalizeLoginValue(rawLoginCandidate);
                              const displayName =
                                userInfo.fullName || userInfo.login || fallbackLogin || userInfo.uid || "—";
                              const loginLabel = userInfo.login || fallbackLogin || null;
                              const uidLabel = userInfo.uid || null;
                              return (
                                <tr key={log.id ?? idx} className="align-top">
                                  <td className="px-4 py-3 whitespace-nowrap">{formatLogTimestamp(log)}</td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <div className="font-semibold">{displayName}</div>
                                    {loginLabel && (
                                      <div className="text-xs text-beige-700">Login: {loginLabel}</div>
                                    )}
                                    {uidLabel && <div className="text-[11px] text-beige-500">UID: {uidLabel}</div>}
                                    {userInfo.sessionId && (
                                      <div className="text-[11px] text-beige-500">Sesja: {userInfo.sessionId}</div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <span
                                      className="inline-flex items-center rounded-full bg-beige-200 px-2 py-0.5 text-xs font-semibold text-beige-900"
                                      title={log.type || undefined}
                                    >
                                      {formatLogTypeLabel(log.type)}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 align-top">{describeLog(log)}</td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    {formatDuration(resolveDurationMs(log) ?? undefined)}
                                  </td>
                                </tr>
                              );
                            })}
                            {logsLoading && (
                              <tr>
                                <td colSpan={5} className="px-4 py-3 text-center text-xs text-beige-600">
                                  Wczytywanie kolejnych logów…
                                </td>
                              </tr>
                            )}
                          </>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-beige-200 bg-beige-50 px-4 py-3 text-xs text-beige-700">
                    <div>
                      {paginatedLogs.length
                        ? `Wyświetlane ${logsDisplayedFrom}–${logsDisplayedTo} z ${logsTotalLabel} wpisów`
                        : logsLoading
                        ? "Ładowanie logów..."
                        : "Brak zdarzeń dla wybranych filtrów."}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <button
                        type="button"
                        className="rounded-full border border-beige-300 bg-white px-3 py-1 font-medium text-beige-800 hover:bg-beige-100 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={goToPrevPage}
                        disabled={!hasPrevPage}
                      >
                        Poprzednia
                      </button>
                      <span className="text-xs font-semibold text-beige-700">Strona {logsPage}</span>
                      <button
                        type="button"
                        className="rounded-full border border-beige-300 bg-white px-3 py-1 font-medium text-beige-800 hover:bg-beige-100 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={goToNextPage}
                        disabled={!hasNextPage}
                      >
                        Następna
                      </button>
                    </div>
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
