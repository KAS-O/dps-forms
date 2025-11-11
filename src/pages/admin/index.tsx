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
  QueryDocumentSnapshot,
  DocumentData,
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

const LOG_PAGE_SIZE = 150;
const LOG_FETCH_BATCH_SIZE = 300;

type LogSectionKey =
  | "session"
  | "navigation"
  | "documents"
  | "archive"
  | "dossiers"
  | "vehicles"
  | "accounts"
  | "other";

const LOG_SECTION_OPTIONS: { value: "all" | LogSectionKey; label: string }[] = [
  { value: "all", label: "Wszystkie sekcje" },
  { value: "session", label: "Sesje i logowania" },
  { value: "navigation", label: "Nawigacja po panelu" },
  { value: "documents", label: "Dokumenty i raporty" },
  { value: "archive", label: "Archiwum" },
  { value: "dossiers", label: "Teczki" },
  { value: "vehicles", label: "Pojazdy" },
  { value: "accounts", label: "Administracja" },
  { value: "other", label: "Inne działania" },
];

const RECORD_TYPE_LABELS: Record<string, string> = {
  note: "Notatka",
  weapon: "Dowód — Broń",
  drug: "Dowód — Narkotyki",
  explosive: "Dowód — Materiały wybuchowe",
  member: "Członek grupy",
  vehicle: "Pojazd organizacji",
  "group-link": "Powiązanie z organizacją",
};

const VEHICLE_FIELD_LABELS: Record<string, string> = {
  registration: "Numer rejestracyjny",
  brand: "Marka",
  color: "Kolor",
  ownerName: "Właściciel",
  ownerCid: "CID właściciela",
};

type LogTypeConfig = {
  label: string;
  section: LogSectionKey;
};

const LOG_TYPE_CONFIG: Record<string, LogTypeConfig> = {
  session_start: { label: "Rozpoczęcie sesji", section: "session" },
  session_end: { label: "Zakończenie sesji", section: "session" },
  logout: { label: "Wylogowanie", section: "session" },
  login_success: { label: "Logowanie udane", section: "session" },
  login_fail: { label: "Logowanie nieudane", section: "session" },
  page_view: { label: "Wejście na stronę", section: "navigation" },
  template_view: { label: "Podgląd szablonu", section: "documents" },
  doc_sent: { label: "Wysłanie dokumentu", section: "documents" },
  archive_view: { label: "Przegląd archiwum", section: "archive" },
  archive_image_open: { label: "Podgląd pliku archiwum", section: "archive" },
  archive_delete: { label: "Usunięcie wpisu archiwum", section: "archive" },
  archive_clear: { label: "Wyczyszczenie archiwum", section: "archive" },
  archive_link: { label: "Połączenie z archiwum", section: "archive" },
  stats_clear: { label: "Wyzerowanie statystyk", section: "accounts" },
  criminal_group_open: { label: "Podgląd grupy", section: "dossiers" },
  dossier_create: { label: "Utworzenie teczki", section: "dossiers" },
  dossier_delete: { label: "Usunięcie teczki", section: "dossiers" },
  dossier_view: { label: "Podgląd teczki", section: "dossiers" },
  dossier_link_open: { label: "Wejście do teczki", section: "dossiers" },
  dossier_evidence_open: { label: "Otwarcie dowodu w teczce", section: "dossiers" },
  dossier_record_add: { label: "Dodanie wpisu do teczki", section: "dossiers" },
  dossier_record_edit: { label: "Edycja wpisu w teczce", section: "dossiers" },
  dossier_record_delete: { label: "Usunięcie wpisu z teczki", section: "dossiers" },
  dossier_group_link_add: { label: "Powiązanie z organizacją", section: "dossiers" },
  dossier_group_link_remove: { label: "Usunięcie powiązania z organizacją", section: "dossiers" },
  vehicle_archive_view: { label: "Przegląd bazy pojazdów", section: "vehicles" },
  vehicle_folder_view: { label: "Podgląd teczki pojazdu", section: "vehicles" },
  vehicle_from_dossier_open: { label: "Pojazd z teczki", section: "vehicles" },
  vehicle_create: { label: "Utworzenie teczki pojazdu", section: "vehicles" },
  vehicle_update: { label: "Aktualizacja danych pojazdu", section: "vehicles" },
  vehicle_delete: { label: "Usunięcie teczki pojazdu", section: "vehicles" },
  vehicle_flag_update: { label: "Zmiana oznaczenia pojazdu", section: "vehicles" },
  vehicle_note_add: { label: "Dodanie notatki o pojeździe", section: "vehicles" },
  vehicle_note_edit: { label: "Edycja notatki o pojeździe", section: "vehicles" },
  vehicle_note_delete: { label: "Usunięcie notatki o pojeździe", section: "vehicles" },
  vehicle_note_payment: { label: "Aktualizacja płatności pojazdu", section: "vehicles" },
  vehicle_note_from_doc: { label: "Notatka utworzona z dokumentu", section: "vehicles" },
  vehicle_group_link_add: { label: "Powiązanie pojazdu z grupą", section: "vehicles" },
  vehicle_group_link_remove: { label: "Usunięcie powiązania pojazdu", section: "vehicles" },
};

type LogPageData = {
  entries: any[];
  endCursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
};

function formatTypeFallback(type: string) {
  if (!type) return "Inne zdarzenie";
  return type
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function shortenText(value: string | null | undefined, max = 160) {
  if (!value) return "";
  const text = String(value).trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function formatList(values: string[] | undefined, fallback = "—") {
  if (!values || values.length === 0) return fallback;
  const filtered = values.map((v) => (typeof v === "string" ? v.trim() : String(v))).filter(Boolean);
  return filtered.length ? filtered.join(", ") : fallback;
}

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
  const [logPages, setLogPages] = useState<LogPageData[]>([]);
  const [logPageIndex, setLogPageIndex] = useState(0);
  const [logPersonFilter, setLogPersonFilter] = useState<string>("all");
  const [logSectionFilter, setLogSectionFilter] = useState<"all" | LogSectionKey>("all");
  const [logTypeFilter, setLogTypeFilter] = useState<string>("all");
  const [logFrom, setLogFrom] = useState("");
  const [logTo, setLogTo] = useState("");
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

  const sortedPeople = useMemo(() => {
    const copy = [...people];
    copy.sort((a, b) => {
      const aLabel = (a.fullName || a.login || a.uid || "").toLocaleLowerCase("pl-PL");
      const bLabel = (b.fullName || b.login || b.uid || "").toLocaleLowerCase("pl-PL");
      return aLabel.localeCompare(bLabel, "pl-PL");
    });
    return copy;
  }, [people]);

  const personByUid = useMemo(() => {
    const map = new Map<string, Person>();
    people.forEach((p) => map.set(p.uid, p));
    return map;
  }, [people]);

  const personByLogin = useMemo(() => {
    const map = new Map<string, Person>();
    people.forEach((p) => {
      if (p.login) {
        map.set(p.login.toLowerCase(), p);
      }
    });
    return map;
  }, [people]);

  const normalizeLogin = useCallback((value: string | null | undefined) => {
    if (!value) return "";
    const trimmed = String(value).trim();
    if (!trimmed) return "";
    const lower = trimmed.toLowerCase();
    const at = lower.indexOf("@");
    return at >= 0 ? lower.slice(0, at) : lower;
  }, []);

  const resolveLogSection = useCallback(
    (type: string): LogSectionKey => LOG_TYPE_CONFIG[type]?.section || "other",
    []
  );

  const getLogTypeLabel = useCallback(
    (type: string) => LOG_TYPE_CONFIG[type]?.label || formatTypeFallback(type),
    []
  );

  const selectedLogPerson = useMemo(() => {
    if (logPersonFilter === "all") return null;
    return personByUid.get(logPersonFilter) || null;
  }, [logPersonFilter, personByUid]);

  const matchesPerson = useCallback(
    (log: any) => {
      if (logPersonFilter === "all") return true;
      if (!selectedLogPerson) return false;
      const uidCandidates = [
        log?.uid,
        log?.authorUid,
        log?.byUid,
        log?.paymentResolvedByUid,
        log?.author?.uid,
      ].filter((uid): uid is string => typeof uid === "string" && !!uid);
      if (uidCandidates.some((uid) => uid === selectedLogPerson.uid)) return true;

      const loginCandidates = [
        normalizeLogin(log?.login),
        normalizeLogin(log?.authorLogin),
        normalizeLogin(log?.by),
        normalizeLogin(log?.author),
        normalizeLogin(log?.createdByLogin),
      ].filter(Boolean) as string[];

      const acceptableLogins = new Set<string>();
      if (selectedLogPerson.login) acceptableLogins.add(selectedLogPerson.login.toLowerCase());
      if (selectedLogPerson.fullName) acceptableLogins.add(selectedLogPerson.fullName.toLowerCase());

      return loginCandidates.some((login) => acceptableLogins.has(login));
    },
    [logPersonFilter, normalizeLogin, selectedLogPerson]
  );

  const matchesSection = useCallback(
    (log: any) => logSectionFilter === "all" || resolveLogSection(log?.type) === logSectionFilter,
    [logSectionFilter, resolveLogSection]
  );

  const matchesType = useCallback(
    (log: any) => logTypeFilter === "all" || log?.type === logTypeFilter,
    [logTypeFilter]
  );

  const matchesFilters = useCallback(
    (log: any) => matchesPerson(log) && matchesSection(log) && matchesType(log),
    [matchesPerson, matchesSection, matchesType]
  );

  const availableTypeOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string; section: LogSectionKey }>();
    Object.entries(LOG_TYPE_CONFIG).forEach(([type, cfg]) => {
      map.set(type, { value: type, label: cfg.label, section: cfg.section });
    });
    logPages.forEach((page) => {
      page?.entries?.forEach((log) => {
        if (!log?.type || map.has(log.type)) return;
        const section = resolveLogSection(log.type);
        map.set(log.type, { value: log.type, label: formatTypeFallback(log.type), section });
      });
    });
    const filtered = Array.from(map.values()).filter(
      (opt) => logSectionFilter === "all" || opt.section === logSectionFilter
    );
    return filtered.sort((a, b) => a.label.localeCompare(b.label, "pl-PL"));
  }, [logPages, logSectionFilter, resolveLogSection]);

  useEffect(() => {
    if (logTypeFilter === "all") return;
    if (!availableTypeOptions.some((opt) => opt.value === logTypeFilter)) {
      setLogTypeFilter("all");
    }
  }, [availableTypeOptions, logTypeFilter]);

  const resolveLogPersonName = useCallback(
    (log: any) => {
      const direct = log?.fullName || log?.authorFullName || log?.byFullName;
      if (typeof direct === "string" && direct.trim()) {
        return direct.trim();
      }

      const uidCandidates = [
        log?.uid,
        log?.authorUid,
        log?.byUid,
        log?.paymentResolvedByUid,
      ].filter((uid): uid is string => typeof uid === "string" && !!uid);
      for (const uid of uidCandidates) {
        const person = personByUid.get(uid);
        if (person) {
          return person.fullName || person.login || uid;
        }
      }

      const loginCandidates = [
        normalizeLogin(log?.login),
        normalizeLogin(log?.authorLogin),
        normalizeLogin(log?.by),
        normalizeLogin(log?.author),
        normalizeLogin(log?.createdByLogin),
      ].filter(Boolean) as string[];
      for (const login of loginCandidates) {
        const person = personByLogin.get(login);
        if (person) {
          return person.fullName || person.login || login;
        }
      }

      if (loginCandidates[0]) {
        return loginCandidates[0];
      }
      if (typeof log?.author === "string" && log.author.includes("@")) {
        return normalizeLogin(log.author) || log.author;
      }
      return "—";
    },
    [normalizeLogin, personByLogin, personByUid]
  );

  const resolveLogLogin = useCallback(
    (log: any) => {
      const login =
        normalizeLogin(log?.login) ||
        normalizeLogin(log?.authorLogin) ||
        normalizeLogin(log?.by) ||
        normalizeLogin(log?.author) ||
        normalizeLogin(log?.createdByLogin);
      return login || "";
    },
    [normalizeLogin]
  );

  const resolveLogUid = useCallback(
    (log: any) => log?.uid || log?.authorUid || log?.byUid || log?.paymentResolvedByUid || "",
    []
  );

  const formatRecordLabel = useCallback(
    (type: string) => RECORD_TYPE_LABELS[type] || type || "Wpis",
    []
  );

  const formatVehicleChanges = useCallback(
    (changes: Record<string, { before: string; after: string }> | undefined) => {
      if (!changes) return "";
      const entries = Object.entries(changes).map(([field, diff]) => {
        const label = VEHICLE_FIELD_LABELS[field] || field;
        const before = diff?.before ? String(diff.before) : "—";
        const after = diff?.after ? String(diff.after) : "—";
        return `${label}: ${before} → ${after}`;
      });
      return entries.join(" • ");
    },
    []
  );

  const fetchLogPageData = useCallback(
    async (
      startAfterDoc: QueryDocumentSnapshot<DocumentData> | null
    ): Promise<LogPageData> => {
      if (role !== "director") {
        return { entries: [], endCursor: null, hasMore: false };
      }

      let cursor = startAfterDoc;
      let lastDoc: QueryDocumentSnapshot<DocumentData> | null = startAfterDoc;
      const collected: any[] = [];
      let exhausted = false;

      let fromTimestamp: Timestamp | null = null;
      if (logFrom) {
        const fromDate = new Date(logFrom);
        if (!Number.isNaN(fromDate.getTime())) {
          fromTimestamp = Timestamp.fromDate(fromDate);
        }
      }

      let toTimestamp: Timestamp | null = null;
      if (logTo) {
        const toDate = new Date(logTo);
        if (!Number.isNaN(toDate.getTime())) {
          toTimestamp = Timestamp.fromDate(toDate);
        }
      }

      const baseConstraints = [orderBy("ts", "desc")];
      if (fromTimestamp) baseConstraints.push(where("ts", ">=", fromTimestamp));
      if (toTimestamp) baseConstraints.push(where("ts", "<=", toTimestamp));

      while (collected.length < LOG_PAGE_SIZE && !exhausted) {
        const constraints = [...baseConstraints];
        if (cursor) {
          constraints.push(startAfter(cursor));
        }
        constraints.push(limit(LOG_FETCH_BATCH_SIZE));

        const snap = await getDocs(query(collection(db, "logs"), ...constraints));
        if (snap.empty) {
          exhausted = true;
          break;
        }

        snap.docs.forEach((docSnap) => {
          const data = docSnap.data() as DocumentData;
          const entry = { id: docSnap.id, ...data };
          if (matchesFilters(entry)) {
            collected.push(entry);
          }
        });

        lastDoc = snap.docs[snap.docs.length - 1];
        cursor = lastDoc;
        if (snap.docs.length < LOG_FETCH_BATCH_SIZE) {
          exhausted = true;
        }
      }

      return {
        entries: collected.slice(0, LOG_PAGE_SIZE),
        endCursor: lastDoc ?? null,
        hasMore: !exhausted && collected.length >= LOG_PAGE_SIZE && !!lastDoc,
      };
    },
    [logFrom, logTo, matchesFilters, role]
  );

  useEffect(() => {
    if (!ready || role !== "director") return;
    let cancelled = false;
    setLogsLoading(true);
    setLogPages([]);
    setActivityLogs([]);
    setLogPageIndex(0);

    const load = async () => {
      try {
        const page = await fetchLogPageData(null);
        if (cancelled) return;
        setLogPages(page.entries.length || page.hasMore ? [page] : [page]);
        setActivityLogs(page.entries);
        setLogPageIndex(0);
      } catch (error) {
        console.error("Nie udało się pobrać logów aktywności:", error);
      } finally {
        if (!cancelled) {
          setLogsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [fetchLogPageData, ready, role]);

  const handleNextLogPage = useCallback(async () => {
    const current = logPages[logPageIndex];
    if (!current) return;

    const cached = logPages[logPageIndex + 1];
    if (cached) {
      setLogPageIndex(logPageIndex + 1);
      setActivityLogs(cached.entries);
      return;
    }

    if (!current.hasMore || !current.endCursor) return;
    setLogsLoading(true);
    try {
      const nextPage = await fetchLogPageData(current.endCursor);
      setLogPages((prev) => {
        const next = [...prev];
        next[logPageIndex + 1] = nextPage;
        return next;
      });
      setActivityLogs(nextPage.entries);
      setLogPageIndex(logPageIndex + 1);
    } catch (error) {
      console.error("Nie udało się pobrać kolejnej strony logów:", error);
    } finally {
      setLogsLoading(false);
    }
  }, [fetchLogPageData, logPageIndex, logPages]);

  const handlePrevLogPage = useCallback(() => {
    if (logPageIndex === 0) return;
    const prevIndex = logPageIndex - 1;
    const page = logPages[prevIndex];
    if (!page) return;
    setLogPageIndex(prevIndex);
    setActivityLogs(page.entries);
  }, [logPageIndex, logPages]);
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

  const describeLog = (log: any) => {
    switch (log?.type) {
      case "session_start":
        return "Rozpoczęto nową sesję w panelu.";
      case "session_end":
        return `Sesja zakończona (powód: ${formatReason(log.reason)}).`;
      case "logout":
        return `Wylogowanie (powód: ${formatReason(log.reason)}).`;
      case "login_success":
        return `Pomyślne logowanie jako ${log.login || "—"}.`;
      case "login_fail": {
        const error = typeof log.error === "string" && log.error ? ` • Błąd: ${log.error}` : "";
        return `Nieudane logowanie jako ${log.login || "—"}${error}.`;
      }
      case "page_view":
        return `Odwiedzono stronę ${log.path || "—"}${log.title ? ` (${log.title})` : ""}.`;
      case "template_view":
        return `Otworzono szablon ${log.template || log.slug || "—"}.`;
      case "doc_sent":
        return `Wysłano dokument ${log.template || "—"}${log.officers ? ` • Funkcjonariusze: ${formatList(log.officers)}` : ""}.`;
      case "archive_view":
        return "Przeglądano zasoby archiwum.";
      case "archive_image_open": {
        const summaryParts: string[] = [];
        if (log.template) summaryParts.push(log.template);
        if (log.archiveSummary) summaryParts.push(shortenText(log.archiveSummary));
        if (log.dossierId) summaryParts.push(`CID: ${log.dossierId}`);
        if (log.vehicleRegistration) summaryParts.push(`Pojazd: ${log.vehicleRegistration}`);
        const summary = summaryParts.length ? ` — ${summaryParts.join(" • ")}` : "";
        return `Otworzono plik archiwum${summary || ""}.`;
      }
      case "archive_delete": {
        const summaryParts: string[] = [];
        if (log.template) summaryParts.push(log.template);
        if (log.archiveSummary) summaryParts.push(shortenText(log.archiveSummary));
        if (log.dossierId) summaryParts.push(`CID: ${log.dossierId}`);
        if (log.vehicleRegistration) summaryParts.push(`Pojazd: ${log.vehicleRegistration}`);
        const summary = summaryParts.length ? ` — ${summaryParts.join(" • ")}` : "";
        return `Usunięto wpis archiwum${summary || ""}.`;
      }
      case "archive_clear":
        return `Wyczyszczono archiwum (${log.removed || 0} wpisów).`;
      case "archive_link":
        return "Powiązano dokument z archiwum.";
      case "stats_clear":
        return "Wyzerowano liczniki statystyk.";
      case "dossier_create": {
        const label = log.dossierTitle || `${log.first || ""} ${log.last || ""}`.trim() || "teczka";
        return `Utworzono teczkę ${label}${log.cid ? ` (CID: ${log.cid})` : ""}.`;
      }
      case "dossier_delete":
        return `Usunięto teczkę (CID: ${log.dossierId || "—"}).`;
      case "dossier_view":
        return `Podglądano teczkę (CID: ${log.dossierId || "—"}).`;
      case "dossier_link_open":
        return `Przejście do teczki (CID: ${log.dossierId || "—"}).`;
      case "dossier_evidence_open":
        return `Otworzono dowód w teczce (CID: ${log.dossierId || "—"}${log.recordId ? ` • Wpis: ${log.recordId}` : ""}).`;
      case "dossier_record_add": {
        const label = formatRecordLabel(log.recordType || "");
        const summary = log.recordSummary ? ` — ${shortenText(log.recordSummary)}` : "";
        return `Dodano wpis „${label}” w teczce (CID: ${log.dossierId || "—"})${summary}.`;
      }
      case "dossier_record_edit": {
        const label = formatRecordLabel(log.recordType || "");
        const changes: string[] = [];
        if (log.previousText) changes.push(`Przed: ${shortenText(log.previousText)}`);
        if (log.nextText) changes.push(`Po: ${shortenText(log.nextText)}`);
        const summary = changes.length ? ` — ${changes.join(" • ")}` : log.recordSummary ? ` — ${shortenText(log.recordSummary)}` : "";
        return `Zmieniono wpis „${label}” w teczce (CID: ${log.dossierId || "—"})${summary}.`;
      }
      case "dossier_record_delete": {
        const label = formatRecordLabel(log.recordType || "");
        const summary = log.recordSummary ? ` — ${shortenText(log.recordSummary)}` : "";
        return `Usunięto wpis „${label}” z teczki (CID: ${log.dossierId || "—"})${summary}.`;
      }
      case "dossier_group_link_add": {
        const member = log.memberName ? ` • Członek: ${log.memberName}${log.memberRank ? ` (${log.memberRank})` : ""}` : "";
        return `Powiązano teczkę (CID: ${log.dossierId || "—"}) z organizacją ${log.groupName || "—"}${member}.`;
      }
      case "dossier_group_link_remove": {
        const member = log.memberName ? ` • Członek: ${log.memberName}` : "";
        return `Usunięto powiązanie z organizacją ${log.groupName || "—"} dla teczki (CID: ${log.dossierId || "—"})${member}.`;
      }
      case "vehicle_archive_view":
        return "Przeglądano bazę pojazdów.";
      case "vehicle_folder_view":
        return `Otworzono teczkę pojazdu ${log.vehicleId || "—"}.`;
      case "vehicle_from_dossier_open":
        return `Otworzono pojazd powiązany z teczką (CID: ${log.dossierId || "—"})${log.vehicleId ? ` • Pojazd: ${log.vehicleId}` : ""}.`;
      case "vehicle_create":
        return `Utworzono teczkę pojazdu ${log.registration || "—"}${log.brand ? ` (${log.brand})` : ""}.`;
      case "vehicle_update": {
        const summary = formatVehicleChanges(log.changes);
        const header = log.registration ? `Zaktualizowano dane pojazdu ${log.registration}` : "Zaktualizowano dane pojazdu";
        return summary ? `${header} — ${summary}.` : `${header}.`;
      }
      case "vehicle_delete":
        return `Usunięto teczkę pojazdu ${log.registration || "—"}${log.ownerName ? ` • Właściciel: ${log.ownerName}` : ""}.`;
      case "vehicle_flag_update": {
        const state = log.value ? "AKTYWNE" : "NIEAKTYWNE";
        return `Ustawiono oznaczenie „${log.flagLabel || log.flag || "—"}” na ${state}${log.vehicleRegistration ? ` • Pojazd: ${log.vehicleRegistration}` : log.vehicleId ? ` • Pojazd: ${log.vehicleId}` : ""}.`;
      }
      case "vehicle_note_add":
        return `Dodano notatkę o pojeździe${log.notePreview ? `: ${shortenText(log.notePreview)}` : "."}`;
      case "vehicle_note_edit": {
        const preview = log.notePreview ? `: ${shortenText(log.notePreview)}` : ".";
        return `Zmieniono notatkę o pojeździe${preview}`;
      }
      case "vehicle_note_delete":
        return `Usunięto notatkę o pojeździe${log.notePreview ? `: ${shortenText(log.notePreview)}` : "."}`;
      case "vehicle_note_payment": {
        const amountValue = Number(log.amount);
        const amount = Number.isFinite(amountValue) && amountValue > 0 ? ` • Kwota: ${amountValue.toLocaleString("pl-PL")} $` : "";
        const status = log.status === "paid" ? "opłacono mandat/grzywnę" : log.status === "unpaid" ? "oznaczono jako nieopłacone" : "zaktualizowano status płatności";
        return `Zaktualizowano płatność — ${status}${amount}.`;
      }
      case "vehicle_note_from_doc":
        return `Utworzono notatkę pojazdu na podstawie dokumentu ${log.template || "—"}.`;
      case "vehicle_group_link_add":
        return `Powiązano pojazd ${log.vehicleRegistration || log.vehicleId || "—"} z organizacją ${log.groupName || "—"}.`;
      case "vehicle_group_link_remove":
        return `Usunięto powiązanie pojazdu ${log.vehicleRegistration || log.vehicleId || "—"} z organizacją ${log.groupName || "—"}.`;
      default: {
        const entries = Object.entries(log || {})
          .filter(([key]) =>
            ![
              "type",
              "ts",
              "createdAt",
              "login",
              "uid",
              "sessionId",
              "author",
              "authorUid",
              "authorLogin",
              "authorFullName",
              "fullName",
              "by",
              "byFullName",
              "byUid",
              "durationMs",
            ].includes(key)
          )
          .map(([key, value]) => {
            if (value == null) return `${key}: —`;
            if (Array.isArray(value)) return `${key}: ${value.join(", ")}`;
            if (typeof value === "object") return `${key}: ${JSON.stringify(value)}`;
            return `${key}: ${value}`;
          })
          .join(" • ");
        return entries || "Szczegóły niedostępne.";
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


    const currentLogPage = logPages[logPageIndex] || null;
    const hasPrevLogPage = logPageIndex > 0;
    const hasNextLogPage = Boolean(logPages[logPageIndex + 1] || currentLogPage?.hasMore);

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
                      Historia logowań, wylogowań oraz wszystkich akcji wykonywanych w panelu. Dostępna wyłącznie dla Director.
                    </p>
                    <p className="mt-2 text-xs text-white/60">Na każdej stronie wyświetlamy maksymalnie {LOG_PAGE_SIZE} wpisów. Użyj filtrów, aby zawęzić wyniki.</p>
                  </div>

                  <div className="card border border-white/10 bg-white/5 p-4">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <label className="flex flex-col gap-2 text-sm text-white/80">
                        <span>Użytkownik</span>
                        <select
                          className="input bg-white text-black text-sm"
                          value={logPersonFilter}
                          onChange={(e) => setLogPersonFilter(e.target.value)}
                        >
                          <option value="all">Wszyscy użytkownicy</option>
                          {sortedPeople.map((person) => {
                            const label = [person.fullName, person.login].filter(Boolean).join(" — ") || person.uid;
                            return (
                              <option key={person.uid} value={person.uid}>
                                {label}
                              </option>
                            );
                          })}
                        </select>
                      </label>

                      <label className="flex flex-col gap-2 text-sm text-white/80">
                        <span>Sekcja</span>
                        <select
                          className="input bg-white text-black text-sm"
                          value={logSectionFilter}
                          onChange={(e) => setLogSectionFilter(e.target.value as "all" | LogSectionKey)}
                        >
                          {LOG_SECTION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex flex-col gap-2 text-sm text-white/80">
                        <span>Czynność</span>
                        <select
                          className="input bg-white text-black text-sm"
                          value={logTypeFilter}
                          onChange={(e) => setLogTypeFilter(e.target.value)}
                          disabled={availableTypeOptions.length === 0}
                        >
                          <option value="all">Wszystkie czynności</option>
                          {availableTypeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="flex flex-col gap-2 text-sm text-white/80">
                        <span>Od daty</span>
                        <input
                          type="datetime-local"
                          className="input bg-white text-black text-sm"
                          value={logFrom}
                          onChange={(e) => setLogFrom(e.target.value)}
                        />
                      </label>

                      <label className="flex flex-col gap-2 text-sm text-white/80">
                        <span>Do daty</span>
                        <input
                          type="datetime-local"
                          className="input bg-white text-black text-sm"
                          value={logTo}
                          onChange={(e) => setLogTo(e.target.value)}
                        />
                      </label>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-white/70">
                      <span>
                        Wyświetlanych: {activityLogs.length} / {LOG_PAGE_SIZE}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn h-8 px-3 text-[11px] font-semibold border border-white/20 bg-white/10 text-white/80 hover:bg-white/20 disabled:opacity-50"
                          onClick={() => {
                            setLogPersonFilter("all");
                            setLogSectionFilter("all");
                            setLogTypeFilter("all");
                            setLogFrom("");
                            setLogTo("");
                          }}
                        >
                          Resetuj filtry
                        </button>
                        <button
                          type="button"
                          className="btn h-8 px-3 text-[11px] font-semibold border border-white/20 bg-white/10 text-white/80 hover:bg-white/20 disabled:opacity-50"
                          onClick={() => {
                            setLogFrom("");
                            setLogTo("");
                          }}
                        >
                          Wyczyść daty
                        </button>
                      </div>
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
                          {logsLoading ? (
                            <tr>
                              <td colSpan={5} className="px-4 py-6 text-center">Ładowanie logów…</td>
                            </tr>
                          ) : activityLogs.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-4 py-6 text-center">Brak zarejestrowanych zdarzeń.</td>
                            </tr>
                          ) : (
                            activityLogs.map((log, idx) => {
                              const personName = resolveLogPersonName(log);
                              const loginValue = resolveLogLogin(log);
                              const uidValue = resolveLogUid(log);
                              const typeLabel = getLogTypeLabel(log.type || "");
                              return (
                                <tr key={log.id ?? idx} className="align-top">
                                  <td className="px-4 py-3 whitespace-nowrap">{formatLogTimestamp(log)}</td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <div className="font-semibold">{personName}</div>
                                    {loginValue && (
                                      <div className="text-xs text-beige-700">{`${loginValue}@${loginDomain}`}</div>
                                    )}
                                    {uidValue && (
                                      <div className="text-[11px] text-beige-500">UID: {uidValue}</div>
                                    )}
                                    {log.sessionId && (
                                      <div className="text-[11px] text-beige-500">Sesja: {log.sessionId}</div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <span className="inline-flex items-center rounded-full bg-beige-200 px-2 py-0.5 text-xs font-semibold text-beige-900">
                                      {typeLabel}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 align-top leading-relaxed text-beige-900/80">{describeLog(log)}</td>
                                  <td className="px-4 py-3 whitespace-nowrap">{formatDuration(resolveDurationMs(log) ?? undefined)}</td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex items-center justify-between border-t border-beige-200/60 bg-white/60 px-4 py-3 text-sm text-beige-900/80">
                      <div>Strona {logPageIndex + 1}</div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn h-9 px-4 text-xs font-semibold border border-white/30 bg-white/10 text-beige-900/80 hover:bg-white/20 disabled:opacity-50"
                          onClick={handlePrevLogPage}
                          disabled={!hasPrevLogPage || logsLoading}
                        >
                          Poprzednie
                        </button>
                        <button
                          type="button"
                          className="btn h-9 px-4 text-xs font-semibold border border-white/30 bg-white/10 text-beige-900/80 hover:bg-white/20 disabled:opacity-50"
                          onClick={handleNextLogPage}
                          disabled={!hasNextLogPage || logsLoading}
                        >
                          Następne
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
