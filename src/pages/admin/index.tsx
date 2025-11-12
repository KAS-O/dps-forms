import Head from "next/head";
import PanelLayout from "@/components/PanelLayout";
import AuthGate from "@/components/AuthGate";
import { useProfile, Role } from "@/hooks/useProfile";
import { useLogWriter } from "@/hooks/useLogWriter";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  query,
  where,
  onSnapshot,
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
  QueryConstraint,
  QueryDocumentSnapshot,
} from "firebase/firestore";
import { deriveLoginFromEmail } from "@/lib/login";
import { auth, db } from "@/lib/firebase";
import { useDialog } from "@/components/DialogProvider";
import { useAnnouncement } from "@/hooks/useAnnouncement";
import { ROLE_LABELS, ROLE_OPTIONS, hasBoardAccess, DEFAULT_ROLE, normalizeRole } from "@/lib/roles";
import {
  DEPARTMENTS,
  INTERNAL_UNITS,
  ADDITIONAL_RANK_GROUPS,
  type Department,
  type InternalUnit,
  type AdditionalRank,
  getDepartmentOption,
  getInternalUnitOption,
  getAdditionalRankOption,
  normalizeDepartment,
  normalizeInternalUnits,
  normalizeAdditionalRanks,
} from "@/lib/hr";

type Range = "all" | "30" | "7";
type Person = { uid: string; fullName?: string; login?: string };
type AdminSection = "overview" | "hr" | "announcements" | "logs" | "tickets";

type Account = {
  uid: string;
  login: string;
  fullName?: string;
  role: Role;
  email: string;
  createdAt?: string;
  badgeNumber?: string;
  department?: Department | null;
  units: InternalUnit[];
  additionalRanks: AdditionalRank[];
  additionalRank?: AdditionalRank | null;
};

type TicketEntry = {
  id: string;
  authorUid: string;
  authorLogin?: string | null;
  authorName?: string | null;
  authorBadgeNumber?: string | null;
  authorRole?: Role | null;
  authorUnits?: InternalUnit[];
  content: string;
  status?: string;
  createdAt?: Timestamp;
};

const LOGIN_PATTERN = /^[a-z0-9._-]+$/;
const BADGE_PATTERN = /^[0-9]{1,6}$/;

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

const CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide shadow-sm";

const humanizeIdentifier = (value: string) => {
  if (!value) return "";
  if (/\s/.test(value)) return value.trim();
  const normalized = value
    .replace(/[_-]+/g, " ")
    .replace(/([a-ząćęłńóśźż])([A-ZĄĆĘŁŃÓŚŹŻ0-9])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return value.trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace(/[^0-9a-fA-F]/g, "");
  const expand = (value: string) => (value.length === 1 ? value + value : value);
  if (normalized.length === 3) {
    const r = parseInt(expand(normalized[0]), 16);
    const g = parseInt(expand(normalized[1]), 16);
    const b = parseInt(expand(normalized[2]), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (normalized.length === 6) {
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgba(56, 189, 248, ${alpha})`;
}

const SECTION_LABELS: Record<string, string> = {
  sesja: "Sesja",
  nawigacja: "Nawigacja",
  dokumenty: "Dokumenty",
  archiwum: "Archiwum dokumentów",
  "archiwum-pojazdow": "Archiwum pojazdów",
  teczki: "Teczki i organizacje",
  "panel-zarzadu": "Panel zarządu",
  logowanie: "Logowanie",
  inne: "Inne",
};

const SECTION_OPTIONS = [
  { value: "", label: "Wszystkie sekcje" },
  { value: "sesja", label: SECTION_LABELS.sesja },
  { value: "nawigacja", label: SECTION_LABELS.nawigacja },
  { value: "dokumenty", label: SECTION_LABELS.dokumenty },
  { value: "archiwum", label: SECTION_LABELS.archiwum },
  { value: "archiwum-pojazdow", label: SECTION_LABELS["archiwum-pojazdow"] },
  { value: "teczki", label: SECTION_LABELS.teczki },
  { value: "panel-zarzadu", label: SECTION_LABELS["panel-zarzadu"] },
  { value: "logowanie", label: SECTION_LABELS.logowanie },
  { value: "inne", label: SECTION_LABELS.inne },
];

const RECORD_TYPE_LABELS: Record<string, string> = {
  note: "Notatka",
  weapon: "Dowód — Broń",
  drug: "Dowód — Narkotyki",
  explosive: "Dowód — Materiały wybuchowe",
  member: "Członek grupy",
  vehicle: "Pojazd organizacji",
  "group-link": "Powiązanie organizacji",
};

const ACTION_LABELS: Record<string, string> = {
  "session.start": "Start sesji",
  "session.end": "Koniec sesji",
  "session.logout": "Wylogowanie",
  "page.view": "Wejście na stronę",
  "template.view": "Podgląd szablonu dokumentu",
  "archive.view": "Przegląd archiwum dokumentów",
  "archive.image_open": "Podgląd załącznika w archiwum",
  "archive.delete": "Usunięcie wpisu z archiwum",
  "archive.clear": "Wyczyszczenie archiwum",
  "vehicle.archive_view": "Przegląd archiwum pojazdów",
  "vehicle.folder_view": "Podgląd teczki pojazdu",
  "vehicle.create": "Utworzenie teczki pojazdu",
  "vehicle.update": "Aktualizacja danych pojazdu",
  "vehicle.delete": "Usunięcie teczki pojazdu",
  "vehicle.flag": "Zmiana oznaczenia pojazdu",
  "vehicle.note.add": "Dodanie notatki w pojeździe",
  "vehicle.note.edit": "Edycja notatki w pojeździe",
  "vehicle.note.delete": "Usunięcie notatki w pojeździe",
  "vehicle.note.payment": "Aktualizacja statusu płatności",
  "vehicle.note.from_doc": "Notatka wygenerowana z dokumentu",
  "vehicle.group.link_add": "Dodanie pojazdu do organizacji",
  "vehicle.group.link_remove": "Usunięcie pojazdu z organizacji",
  "vehicle.from_dossier_open": "Podgląd pojazdu z teczki",
  "dossier.view": "Podgląd teczki",
  "dossier.link_open": "Przejście do teczki",
  "dossier.evidence_open": "Podgląd załącznika w teczce",
  "dossier.group.link_add": "Dodanie członka do organizacji",
  "dossier.group.link_remove": "Usunięcie członka z organizacji",
  "dossier.record.note": "Dodanie notatki w teczce",
  "dossier.record.weapon": "Dodanie dowodu — broń",
  "dossier.record.drug": "Dodanie dowodu — narkotyki",
  "dossier.record.explosive": "Dodanie dowodu — materiały wybuchowe",
  "dossier.record.member": "Dodanie członka organizacji",
  "dossier.record.vehicle": "Dodanie pojazdu organizacji",
  "dossier.record.group-link": "Dodanie powiązania organizacji",
  "dossier.record.edit": "Edycja wpisu w teczce",
  "dossier.record.delete": "Usunięcie wpisu w teczce",
  "dossier.create": "Nowa teczka",
  "dossier.delete": "Usunięcie teczki",
  "criminal_group.open": "Podgląd organizacji",
  "document.send": "Wygenerowanie dokumentu",
  "stats.clear": "Czyszczenie statystyk",
  "auth.login_success": "Udane logowanie",
  "auth.login_fail": "Nieudane logowanie",
};

const ACTION_OPTIONS = [
  { value: "", label: "Wszystkie czynności" },
  ...Object.entries(ACTION_LABELS)
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pl", { sensitivity: "base" })),
];

const INITIAL_LOG_FILTERS = { actorUid: "", section: "", action: "", from: "", to: "" };

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
  const { writeLog } = useLogWriter();
  const { confirm, prompt, alert } = useDialog();
  const { announcement } = useAnnouncement();
  const loginDomain = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dps.local";

  const [range, setRange] = useState<Range>("all");
  const [err, setErr] = useState<string | null>(null);
  const [section, setSection] = useState<AdminSection>("overview");
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<TicketEntry[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [logPage, setLogPage] = useState(0);
  const [logPages, setLogPages] = useState<any[][]>([]);
  const [logCursors, setLogCursors] = useState<(QueryDocumentSnapshot | null)[]>([]);
  const [logPageHasMore, setLogPageHasMore] = useState<boolean[]>([]);
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  const [logFilters, setLogFilters] = useState(() => ({ ...INITIAL_LOG_FILTERS }));
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
  const [accountRoleFilter, setAccountRoleFilter] = useState<Role | "">("");
  const [editorState, setEditorState] = useState<{
    mode: "create" | "edit";
    account: Partial<Account>;
    password?: string;
  } | null>(null);
  const [accountSaving, setAccountSaving] = useState(false);

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

  const buildLogsQuery = useCallback(
    (cursor: QueryDocumentSnapshot | null) => {
      if (!db) throw new Error("Brak połączenia z bazą danych.");
      const constraints: QueryConstraint[] = [];
      const fromDate = logFilters.from ? new Date(logFilters.from) : null;
      if (fromDate && Number.isNaN(fromDate.getTime())) throw new Error("Nieprawidłowa data początkowa.");
      const toDate = logFilters.to ? new Date(logFilters.to) : null;
      if (toDate && Number.isNaN(toDate.getTime())) throw new Error("Nieprawidłowa data końcowa.");
      if (fromDate && toDate && fromDate > toDate) {
        throw new Error("Początek zakresu nie może być później niż koniec.");
      }
      if (logFilters.actorUid) constraints.push(where("actorUid", "==", logFilters.actorUid));
      if (logFilters.section) constraints.push(where("section", "==", logFilters.section));
      if (logFilters.action) constraints.push(where("action", "==", logFilters.action));
      if (fromDate) constraints.push(where("ts", ">=", Timestamp.fromDate(fromDate)));
      if (toDate) constraints.push(where("ts", "<=", Timestamp.fromDate(toDate)));
      const ordered: QueryConstraint[] = [orderBy("ts", "desc")];
      if (cursor) ordered.push(startAfter(cursor));
      ordered.push(limit(LOG_PAGE_SIZE));
      return query(collection(db, "logs"), ...constraints, ...ordered);
    },
    [logFilters]
  );

  useEffect(() => {
    if (!hasBoardAccess(role)) return;
    setLogPages([]);
    setLogCursors([]);
    setLogPageHasMore([]);
    setActivityLogs([]);
    setHasMoreLogs(false);
    setLogsError(null);
    setLogPage(0);
  }, [logFilters, role]);

  useEffect(() => {
    if (!hasBoardAccess(role)) {
      setTickets([]);
      setTicketsLoading(false);
      return;
    }
    setTicketsLoading(true);
    setTicketsError(null);
    const ticketsQuery = query(collection(db, "tickets"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      ticketsQuery,
      (snapshot) => {
        const docs = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as any;
          return {
            id: docSnap.id,
            authorUid: typeof data.authorUid === "string" ? data.authorUid : "",
            authorLogin: typeof data.authorLogin === "string" ? data.authorLogin : null,
            authorName: typeof data.authorName === "string" ? data.authorName : null,
            authorBadgeNumber: typeof data.authorBadgeNumber === "string" ? data.authorBadgeNumber : null,
            authorRole: data.authorRole ? normalizeRole(data.authorRole) : null,
            authorUnits: normalizeInternalUnits(data.authorUnits),
            content: typeof data.content === "string" ? data.content : "",
            status: typeof data.status === "string" ? data.status : "open",
            createdAt: data.createdAt,
          } as TicketEntry;
        });
        setTickets(docs);
        setTicketsLoading(false);
      },
      (error) => {
        console.error("Nie udało się pobrać ticketów:", error);
        setTicketsError(error?.message || "Nie udało się pobrać ticketów.");
        setTickets([]);
        setTicketsLoading(false);
      }
    );
    return () => unsub();
  }, [role]);

  useEffect(() => {
    if (!hasBoardAccess(role)) {
      setLogsLoading(false);
      return;
    }
    const loadLogs = async () => {
      const cached = logPages[logPage];
      if (cached) {
        setActivityLogs(cached);
        const cachedHasMore = logPageHasMore[logPage] || false;
        const hasCachedNext = Boolean(logPages[logPage + 1]);
        setHasMoreLogs(cachedHasMore || hasCachedNext);
        setLogsLoading(false);
        return;
      }

      setLogsLoading(true);
      setLogsError(null);
      try {
        const cursor = logPage > 0 ? logCursors[logPage - 1] : null;
        const q = buildLogsQuery(cursor);
        const snap = await getDocs(q);
        const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        setLogPages((prev) => {
          const next = [...prev];
          next[logPage] = docs;
          return next;
        });
        setLogCursors((prev) => {
          const next = [...prev];
          next[logPage] = snap.docs.length ? snap.docs[snap.docs.length - 1] : null;
          return next;
        });
        setLogPageHasMore((prev) => {
          const next = [...prev];
          next[logPage] = snap.size === LOG_PAGE_SIZE;
          return next;
        });
        setActivityLogs(docs);
        const hasCachedNext = Boolean(logPages[logPage + 1]);
        setHasMoreLogs(snap.size === LOG_PAGE_SIZE || hasCachedNext);
      } catch (error: any) {
        console.error("Nie udało się pobrać logów aktywności:", error);
        setLogsError(error?.message || "Nie udało się pobrać logów aktywności.");
        setActivityLogs([]);
        setHasMoreLogs(false);
      } finally {
        setLogsLoading(false);
      }
    };
    void loadLogs();
  }, [role, logPage, logPages, logCursors, logPageHasMore, buildLogsQuery]);

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
      const snap = await getDocs(collection(db, "profiles"));
      const domain = loginDomain;
      const arr = snap.docs.map((docSnap) => {
        const data = docSnap.data() as any;
        const loginRaw = typeof data?.login === "string" ? data.login.trim() : "";
        const emailLogin =
          typeof data?.email === "string" && data.email.includes("@") ? data.email.split("@")[0] : "";
        const uid = docSnap.id;
        const login = (loginRaw || emailLogin || uid || "").toLowerCase();
        const createdAtRaw = data?.createdAt;
        let createdAt: string | undefined;
        if (createdAtRaw?.toDate && typeof createdAtRaw.toDate === "function") {
          try {
            createdAt = createdAtRaw.toDate().toISOString();
          } catch (error) {
            createdAt = undefined;
          }
        } else if (typeof createdAtRaw === "string") {
          createdAt = createdAtRaw;
        }
      const badgeNumberValue =
        typeof data?.badgeNumber === "string"
          ? data.badgeNumber.trim()
          : typeof data?.badgeNumber === "number"
          ? String(data.badgeNumber)
          : "";
      const departmentValue = normalizeDepartment(data?.department);
      const unitsValue = normalizeInternalUnits(data?.units);
      const additionalRanksValue = normalizeAdditionalRanks(data?.additionalRanks ?? data?.additionalRank);
      return {
        uid,
        login,
        fullName: typeof data?.fullName === "string" ? data.fullName : "",
        role: normalizeRole(data?.role),
        email: login ? `${login}@${domain}` : "",
        ...(badgeNumberValue ? { badgeNumber: badgeNumberValue } : {}),
        ...(createdAt ? { createdAt } : {}),
        department: departmentValue,
        units: unitsValue,
        additionalRanks: additionalRanksValue,
        additionalRank: additionalRanksValue[0] ?? null,
      } as Account;
    });
      arr.sort((a, b) => (a.fullName || a.login).localeCompare(b.fullName || b.login, "pl", { sensitivity: "base" }));
      setAccounts(arr);
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
      account: {
        login: "",
        fullName: "",
        role: DEFAULT_ROLE,
        email: "",
        badgeNumber: "",
        department: DEPARTMENTS[0]?.value ?? null,
        units: [],
        additionalRanks: [],
        additionalRank: null,
      },
      password: "",
    });
  };

  const openEditAccount = (account: Account) => {
    setEditorState({
      mode: "edit",
      account: {
        ...account,
        units: Array.isArray(account.units) ? account.units : [],
        department: account.department ?? null,
        additionalRanks: Array.isArray(account.additionalRanks)
          ? account.additionalRanks
          : account.additionalRank
          ? [account.additionalRank]
          : [],
        additionalRank: account.additionalRank ?? null,
      },
      password: "",
    });
  };

  const saveAccount = async () => {
    if (!editorState) return;
    const loginValue = (editorState.account.login || "").trim().toLowerCase();
    const fullNameValue = (editorState.account.fullName || "").trim();
    const roleValue: Role = editorState.account.role || DEFAULT_ROLE;
    const passwordValue = (editorState.password || "").trim();
    const badgeNumberValue = (editorState.account.badgeNumber || "").trim();
    const departmentValue = normalizeDepartment(editorState.account.department);
    const unitsValue = Array.isArray(editorState.account.units)
      ? editorState.account.units.filter((unit): unit is InternalUnit => !!getInternalUnitOption(unit))
      : [];
    const additionalRanksValue = normalizeAdditionalRanks(editorState.account.additionalRanks);

    if (!loginValue) {
      setErr("Login jest wymagany.");
      return;
    }
    if (!LOGIN_PATTERN.test(loginValue)) {
      setErr("Login może zawierać jedynie małe litery, cyfry, kropki, myślniki i podkreślniki.");
      return;
    }
    if (editorState.mode === "edit") {
      const originalLogin = (editorState.account.login || "").trim().toLowerCase();
      if (loginValue !== originalLogin) {
        setErr("Zmiana loginu jest zablokowana. Utwórz nowe konto z poprawnym loginem.");
        return;
      }
      if (passwordValue) {
        setErr("Zmiana hasła jest niedostępna z poziomu panelu. Użyj resetu hasła w Firebase.");
        return;
      }
    }
    if (!badgeNumberValue) {
      setErr("Numer odznaki jest wymagany.");
      return;
    }
    if (!BADGE_PATTERN.test(badgeNumberValue)) {
      setErr("Numer odznaki powinien zawierać od 1 do 6 cyfr.");
      return;
    }
    if (editorState.mode === "create" && !passwordValue) {
      setErr("Hasło jest wymagane przy tworzeniu nowego konta.");
      return;
    }
    if (editorState.mode === "create" && passwordValue.length < 6) {
      setErr("Hasło musi mieć co najmniej 6 znaków.");
      return;
    }
    if (!departmentValue) {
      setErr("Wybierz departament dla funkcjonariusza.");
      return;
    }
    for (const rank of additionalRanksValue) {
      const rankOption = getAdditionalRankOption(rank);
      if (rankOption && !unitsValue.includes(rankOption.unit)) {
        const unitOption = getInternalUnitOption(rankOption.unit);
        setErr(
          unitOption
            ? `Aby przypisać stopień ${rankOption.label}, dodaj jednostkę ${unitOption.abbreviation}.`
            : "Aby przypisać dodatkowy stopień, wybierz powiązaną jednostkę."
        );
        return;
      }
    }

    try {
      setAccountSaving(true);
      setErr(null);
      const user = auth.currentUser;
      if (!user) throw new Error("Brak zalogowanego użytkownika.");
      const token = await user.getIdToken();
      const payload: Record<string, any> =
        editorState.mode === "create"
          ? {
              login: loginValue,
              fullName: fullNameValue,
              role: roleValue,
              password: passwordValue,
              badgeNumber: badgeNumberValue,
              department: departmentValue,
              units: unitsValue,
              additionalRanks: additionalRanksValue,
              additionalRank: additionalRanksValue[0] ?? null,
            }
          : {
              uid: editorState.account.uid,
              fullName: fullNameValue,
              role: roleValue,
              badgeNumber: badgeNumberValue,
              department: departmentValue,
              units: unitsValue,
              additionalRanks: additionalRanksValue,
              additionalRank: additionalRanksValue[0] ?? null,
            };
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

  const filteredAccounts = useMemo(() => {
    const phrase = accountSearch.trim().toLowerCase();
    const roleFilter = accountRoleFilter;
    const base = accounts
      .filter((acc) => (!roleFilter ? true : acc.role === roleFilter))
      .filter((acc) => {
        if (!phrase) return true;
        const fullName = (acc.fullName || "").toLowerCase();
        const badge = (acc.badgeNumber || "").toLowerCase();
        const departmentLabel = (getDepartmentOption(acc.department)?.abbreviation || "").toLowerCase();
        const unitLabels = acc.units
          .map((unit) => getInternalUnitOption(unit)?.abbreviation || "")
          .map((label) => label.toLowerCase());
        const additionalRankLabels = (Array.isArray(acc.additionalRanks) && acc.additionalRanks.length
          ? acc.additionalRanks
          : acc.additionalRank
          ? [acc.additionalRank]
          : [])
          .map((rank) => getAdditionalRankOption(rank)?.label || "")
          .map((label) => label.toLowerCase())
          .filter(Boolean);
        return (
          acc.login.toLowerCase().includes(phrase) ||
          fullName.includes(phrase) ||
          (badge ? badge.includes(phrase) : false) ||
          (departmentLabel ? departmentLabel.includes(phrase) : false) ||
          unitLabels.some((label) => label.includes(phrase)) ||
          additionalRankLabels.some((label) => label.includes(phrase))
        );
      })
      .slice();
    base.sort((a, b) => {
      const nameA = (a.fullName || a.login).toLowerCase();
      const nameB = (b.fullName || b.login).toLowerCase();
      return nameA.localeCompare(nameB);
    });
    return base;
  }, [accounts, accountSearch, accountRoleFilter]);

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

  const formatTicketTimestamp = (ticket: TicketEntry) => {
    const raw = ticket.createdAt as any;
    if (raw?.toDate && typeof raw.toDate === "function") {
      try {
        return raw.toDate().toLocaleString("pl-PL");
      } catch (error) {
        return raw.toDate().toISOString();
      }
    }
    if (raw instanceof Date) {
      try {
        return raw.toLocaleString("pl-PL");
      } catch (error) {
        return raw.toISOString();
      }
    }
    if (typeof raw === "string") {
      const parsed = Date.parse(raw);
      if (!Number.isNaN(parsed)) {
        try {
          return new Date(parsed).toLocaleString("pl-PL");
        } catch (error) {
          return new Date(parsed).toISOString();
        }
      }
      return raw;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      try {
        return new Date(raw).toLocaleString("pl-PL");
      } catch (error) {
        return new Date(raw).toISOString();
      }
    }
    return "—";
  };

  const resolveSectionLabel = (value?: string | null) => {
    if (!value) return "—";
    return SECTION_LABELS[value] || value;
  };

  const resolveActionLabel = (log: any) => {
    const key = log?.action || log?.type;
    if (!key) return "—";
    if (ACTION_LABELS[key]) return ACTION_LABELS[key];
    const fallbackType = log?.type && ACTION_LABELS[log.type];
    if (fallbackType) return fallbackType;
    if (typeof key === "string" && key.startsWith("custom.")) {
      const custom = key.slice(7);
      const label = humanizeIdentifier(custom);
      return label ? `Zdarzenie niestandardowe (${label})` : "Zdarzenie niestandardowe";
    }
    const parts = String(key).split(".");
    const last = parts[parts.length - 1] || String(key);
    const label = humanizeIdentifier(last);
    return label || String(key);
  };

  const formatDetailKey = (key: string) => {
    if (!key) return "Szczegół";
    const label = humanizeIdentifier(key);
    return label || key;
  };

  const formatDetailValue = (value: any): string => {
    if (value == null) return "—";
    if (value instanceof Timestamp) {
      try {
        return value.toDate().toLocaleString("pl-PL");
      } catch (error) {
        return value.toDate().toISOString();
      }
    }
    if (value?.toDate && typeof value.toDate === "function") {
      try {
        return value.toDate().toLocaleString("pl-PL");
      } catch (error) {
        return String(value);
      }
    }
    if (value instanceof Date) {
      try {
        return value.toLocaleString("pl-PL");
      } catch (error) {
        return value.toISOString();
      }
    }
    if (typeof value === "boolean") return value ? "Tak" : "Nie";
    if (typeof value === "number") {
      return Number.isFinite(value) ? value.toLocaleString("pl-PL") : String(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => formatDetailValue(item)).join(", ");
    }
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (error) {
        return String(value);
      }
    }
    const str = String(value);
    return str.trim().length > 0 ? str : "—";
  };

  const formatLogDetails = (log: any) => {
    const entries: { key: string; label: string; value: string }[] = [];
    const used = new Set<string>();

    const collect = (source: any) => {
      if (!source || typeof source !== "object" || Array.isArray(source)) return;
      Object.entries(source).forEach(([key, value]) => {
        if (used.has(key)) return;
        used.add(key);
        entries.push({ key, label: formatDetailKey(key), value: formatDetailValue(value) });
      });
    };

    collect(log?.details);
    collect(log?.extra);

    if (!entries.length && log && typeof log === "object") {
      Object.entries(log).forEach(([key, value]) => {
        if (
          [
            "id",
            "type",
            "section",
            "action",
            "message",
            "details",
            "extra",
            "actorUid",
            "actorLogin",
            "actorName",
            "uid",
            "login",
            "ts",
            "createdAt",
            "sessionId",
            "durationMs",
            "reason",
          ].includes(key)
        ) {
          return;
        }
        if (used.has(key)) return;
        used.add(key);
        entries.push({ key, label: formatDetailKey(key), value: formatDetailValue(value) });
      });
    }

    return entries;
  };

  const actorProfiles = useMemo(() => {
    const map = new Map<string, Person>();
    people.forEach((p) => {
      map.set(p.uid, p);
    });
    return map;
  }, [people]);

  const resolveActor = useCallback(
    (log: any) => {
      const actorUid = (log?.actorUid || log?.uid || "") as string;
      const profile = actorUid ? actorProfiles.get(actorUid) : undefined;
      let login =
        (log?.actorLogin as string | undefined) ||
        (log?.login as string | undefined) ||
        (profile?.login as string | undefined) ||
        "";
      if (login && login.includes("@")) {
        login = deriveLoginFromEmail(login);
      }
      const trimmedLogin = login ? login.trim() : "";
      const profileName = typeof profile?.fullName === "string" ? profile.fullName.trim() : "";
      const nameCandidates = [
        profileName,
        (log?.actorName as string | undefined)?.trim() || "",
        (log?.name as string | undefined)?.trim() || "",
        (log?.fullName as string | undefined)?.trim() || "",
      ].filter((value, index, array) => value && array.indexOf(value) === index);
      const nameFromLog = nameCandidates.find((value) => value && value !== trimmedLogin);
      const fallbackName = nameCandidates.find((value) => value) || "";
      const name =
        profileName ||
        nameFromLog ||
        fallbackName ||
        trimmedLogin ||
        (actorUid ? `UID: ${actorUid}` : "Nieznany użytkownik");

      return {
        uid: actorUid || null,
        name,
        login: trimmedLogin || null,
      };
    },
    [actorProfiles]
  );

  const buildActorLabel = (name: string, login?: string | null) => {
    const trimmedName = name.trim();
    const trimmedLogin = login?.trim() || "";
    if (trimmedLogin && trimmedName && trimmedName !== trimmedLogin) {
      return `${trimmedName} (${trimmedLogin})`;
    }
    if (trimmedName) return trimmedName;
    if (trimmedLogin) return trimmedLogin;
    return "Nieznany użytkownik";
  };

  const actorOptions = useMemo(() => {
    const map = new Map<string, string>();
    people.forEach((p) => {
      const name = (p.fullName || "").trim();
      const login = (p.login || "").trim();
      const label = buildActorLabel(name || login || p.uid, login || null);
      map.set(p.uid, label);
    });
    activityLogs.forEach((log) => {
      const actor = resolveActor(log);
      if (!actor.uid) return;
      if (map.has(actor.uid)) return;
      map.set(actor.uid, buildActorLabel(actor.name, actor.login));
    });
    if (logFilters.actorUid && !map.has(logFilters.actorUid)) {
      map.set(logFilters.actorUid, logFilters.actorUid);
    }
    const options = Array.from(map.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pl", { sensitivity: "base" }));
    return [{ value: "", label: "Wszyscy użytkownicy" }, ...options];
  }, [people, activityLogs, resolveActor, logFilters.actorUid]);

  const hasActiveLogFilters = useMemo(() => {
    return Object.values(logFilters).some((value) => value);
  }, [logFilters]);

  const clearLogFilters = () => {
    setLogFilters({ ...INITIAL_LOG_FILTERS });
    setLogPage(0);
  };

  const logRange = useMemo(() => {
    if (!activityLogs.length) return null;
    const start = logPage * LOG_PAGE_SIZE + 1;
    const end = logPage * LOG_PAGE_SIZE + activityLogs.length;
    return { start, end };
  }, [activityLogs, logPage]);

  const describeLog = (log: any) => {
    if (typeof log?.message === "string" && log.message.trim().length > 0) {
      return log.message.trim();
    }

    switch (log?.type) {
      case "session_start":
        return "Rozpoczęto sesję w panelu.";
      case "session_end":
        return `Zakończono sesję (powód: ${formatReason(log.reason)}).`;
      case "logout":
        return `Wylogowanie użytkownika (powód: ${formatReason(log.reason)}).`;
      case "page_view": {
        const title = log.title ? ` — ${log.title}` : "";
        return `Odwiedzono stronę ${log.path || "(nieznana)"}${title}`;
      }
      case "template_view":
        return `Wyświetlono szablon dokumentu ${log.template || log.slug || "(nieznany)"}.`;
      case "archive_view":
        return "Przegląd zasobów archiwum dokumentów.";
      case "archive_image_open":
        return `Podgląd pliku z archiwum (ID ${log.archiveId || "—"}).`;
      case "dossier_view":
        return `Otworzono teczkę ${log.dossierId || "—"}.`;
      case "dossier_link_open":
        return `Przejście do teczki ${log.dossierId || "—"}.`;
      case "dossier_evidence_open":
        return `Otwarto załącznik ${log.recordId || "—"} w teczce ${log.dossierId || "—"}.`;
      default:
        return "—";
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
    if (!ready || !hasBoardAccess(role)) return;
    recalcAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, role, since]);

  useEffect(() => {
    if (!ready || !hasBoardAccess(role) || !person) return;
    recalcPerson();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, role, person, since, people]);

  useEffect(() => {
    if (!ready || !hasBoardAccess(role)) return;
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
      await writeLog({
        type: "stats_clear",
        section: "panel-zarzadu",
        action: "stats.clear",
        message: `Wyczyszczono statystyki z ostatnich ${normalizedDays} dni (usunięto ${snap.size} wpisów).`,
        details: {
          dni: normalizedDays,
          usunieteWpisy: snap.size,
        },
        days: normalizedDays,
        removed: snap.size,
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
        <PanelLayout>
          <div className="card p-6 text-sm text-white/70">Ładowanie…</div>
        </PanelLayout>
      </AuthGate>
    );
  }
  if (!hasBoardAccess(role)) {
    return (
      <AuthGate>
        <Head><title>LSPD 77RP — Panel zarządu</title></Head>
        <PanelLayout>
          <div className="card p-6 text-center text-sm text-white/80">
            Brak dostępu. Panel zarządu jest dostępny dla rang <b>Staff Commander</b> i wyższych.
          </div>
        </PanelLayout>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <Head><title>LSPD 77RP — Panel zarządu</title></Head>
      <PanelLayout>
        <div className="grid gap-5">
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
              <button type="button" className={sectionButtonClass("tickets")} onClick={() => setSection("tickets")}>
                <span className="text-base font-semibold">Tickety</span>
                <span className="block text-xs text-white/70">Zgłoszenia od funkcjonariuszy</span>
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
                      placeholder="Szukaj po loginie, imieniu lub numerze odznaki..."
                      value={accountSearch}
                      onChange={(e) => setAccountSearch(e.target.value)}
                    />
                    <select
                      className="input w-full md:w-56 bg-white text-black"
                      value={accountRoleFilter}
                      onChange={(e) => setAccountRoleFilter(e.target.value as Role | "")}
                    >
                      <option value="">Wszystkie rangi</option>
                      {ROLE_OPTIONS.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-white/60">Domena logowania: @{loginDomain}</span>
                  </div>
                </div>

                <div className="grid gap-3">
                  {accountsLoading ? (
                    <div className="card p-5 text-center">Ładowanie kont…</div>
                  ) : filteredAccounts.length === 0 ? (
                    <div className="card p-5 text-center">Brak kont spełniających kryteria.</div>
                  ) : (
                    filteredAccounts.map((acc) => {
                      const departmentOption = getDepartmentOption(acc.department);
                      const unitOptions = acc.units
                        .map((unit) => getInternalUnitOption(unit))
                        .filter(
                          (option): option is NonNullable<ReturnType<typeof getInternalUnitOption>> => !!option
                        );
                      const additionalRankOptions = (Array.isArray(acc.additionalRanks) && acc.additionalRanks.length
                        ? acc.additionalRanks
                        : acc.additionalRank
                        ? [acc.additionalRank]
                        : [])
                        .map((rank) => getAdditionalRankOption(rank))
                        .filter((option): option is NonNullable<ReturnType<typeof getAdditionalRankOption>> => !!option);

                      return (
                        <div
                          key={acc.uid}
                          className="card p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
                        >
                          <div>
                            <h3 className="text-lg font-semibold">{acc.fullName || "Bez nazwy"}</h3>
                            <p className="text-sm text-beige-700">
                              Login: <span className="font-mono text-base">{acc.login}@{loginDomain}</span>
                            </p>
                            {acc.badgeNumber && (
                              <p className="text-sm text-beige-700">
                                Numer odznaki: <span className="font-semibold">{acc.badgeNumber}</span>
                              </p>
                            )}
                            <p className="text-xs uppercase tracking-wide text-beige-600 mt-1">
                              Ranga: {ROLE_LABELS[acc.role] || acc.role}
                            </p>
                            {(departmentOption || unitOptions.length > 0 || additionalRankOptions.length > 0) && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {departmentOption && (
                                  <span
                                    className={CHIP_CLASS}
                                    style={{
                                      background: departmentOption.background,
                                      color: departmentOption.color,
                                      borderColor: departmentOption.borderColor,
                                    }}
                                  >
                                    {departmentOption.abbreviation}
                                  </span>
                                )}
                                {unitOptions.map((unit) => (
                                  <span
                                    key={unit.value}
                                    className={CHIP_CLASS}
                                    style={{
                                      background: unit.background,
                                      color: unit.color,
                                      borderColor: unit.borderColor,
                                    }}
                                  >
                                    {unit.shortLabel || unit.abbreviation}
                                  </span>
                                ))}
                                {additionalRankOptions.map((option) => (
                                  <span
                                    key={`rank-${acc.uid}-${option.value}`}
                                    className={`${CHIP_CLASS} text-[11px]`}
                                    style={{
                                      background: option.background,
                                      color: option.color,
                                      borderColor: option.borderColor,
                                    }}
                                  >
                                    {option.label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-col items-stretch gap-2 md:items-end">
                            <button className="btn" onClick={() => openEditAccount(acc)}>Edytuj</button>
                            <span className="text-xs text-beige-600 text-left md:text-right">
                              Usuwanie kont i reset haseł wykonaj w konsoli Firebase.
                            </span>
                          </div>
                        </div>
                      );
                    })
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

            {section === "tickets" && (
              <div className="grid gap-5" data-section="tickets">
                <div className="card bg-gradient-to-br from-sky-900/85 via-indigo-900/80 to-blue-900/80 text-white p-6 shadow-xl">
                  <h2 className="text-xl font-semibold">Tickety</h2>
                  <p className="text-sm text-white/70">
                    Podgląd zgłoszeń przesłanych przez funkcjonariuszy. Odpowiedz na nie w komunikatorze lub na służbie.
                  </p>
                  <div className="mt-4 text-xs text-white/60">
                    Łącznie: {tickets.length} • Otwartych: {tickets.filter((ticket) => (ticket.status || "open") !== "closed").length}
                  </div>
                </div>

                {ticketsError && <div className="card p-4 bg-red-50 text-red-700">{ticketsError}</div>}

                {ticketsLoading ? (
                  <div className="card p-4 text-sm text-white/70">Ładowanie ticketów…</div>
                ) : tickets.length ? (
                  <div className="grid gap-4">
                    {tickets.map((ticket) => {
                      const unitOptions = (ticket.authorUnits || [])
                        .map((unit) => getInternalUnitOption(unit))
                        .filter((option): option is NonNullable<ReturnType<typeof getInternalUnitOption>> => !!option);
                      const roleLabel = ticket.authorRole ? ROLE_LABELS[ticket.authorRole] || ticket.authorRole : "—";
                      const status = ticket.status || "open";
                      const statusLabel = status === "closed" ? "Zamknięty" : "Otwarty";
                      const statusAccent = status === "closed" ? "#34d399" : "#38bdf8";
                      const createdAtLabel = formatTicketTimestamp(ticket);
                      const authorLabel = ticket.authorName || ticket.authorLogin || `UID: ${ticket.authorUid}`;
                      return (
                        <div
                          key={ticket.id}
                          className="card relative overflow-hidden border border-white/10 bg-white/5 p-5 shadow-[0_24px_60px_rgba(15,23,42,0.45)]"
                        >
                          <span
                            className="pointer-events-none absolute inset-0 opacity-40"
                            style={{ background: `radial-gradient(circle at top, ${withAlpha(statusAccent, 0.22)}, transparent 70%)` }}
                          />
                          <div className="relative flex flex-col gap-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="space-y-1">
                                <span className="text-[11px] uppercase tracking-[0.35em] text-white/50">Zgłoszenie</span>
                                <div className="text-lg font-semibold text-white">{authorLabel}</div>
                                <div className="text-xs text-white/60">
                                  {ticket.authorLogin || "—"}
                                  {ticket.authorBadgeNumber ? ` • #${ticket.authorBadgeNumber}` : ""}
                                  {roleLabel ? ` • ${roleLabel}` : ""}
                                </div>
                              </div>
                              <div className="text-right text-xs text-white/60">
                                <div>{createdAtLabel}</div>
                                <div
                                  className="mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
                                  style={{
                                    borderColor: withAlpha(statusAccent, 0.65),
                                    background: withAlpha(statusAccent, 0.2),
                                    color: "#f8fafc",
                                  }}
                                >
                                  <span className="h-2 w-2 rounded-full" style={{ background: statusAccent }} aria-hidden />
                                  {statusLabel}
                                </div>
                              </div>
                            </div>

                            <p className="text-sm leading-relaxed text-white/80 whitespace-pre-wrap">{ticket.content}</p>

                            {unitOptions.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {unitOptions.map((unit) => (
                                  <span
                                    key={`ticket-${ticket.id}-unit-${unit.value}`}
                                    className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold"
                                    style={{
                                      background: unit.background,
                                      color: unit.color,
                                      borderColor: unit.borderColor,
                                    }}
                                  >
                                    {unit.shortLabel || unit.abbreviation || unit.label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="card p-4 text-sm text-white/70">Brak zgłoszeń w kolejce.</div>
                )}
              </div>
            )}

            {section === "logs" && (
              <div className="grid gap-5">
                <div className="card bg-gradient-to-br from-amber-900/85 via-amber-800/85 to-stone-900/80 text-white p-6 shadow-xl">
                  <h2 className="text-xl font-semibold">Monitor aktywności</h2>
                  <p className="text-sm text-white/70">
                    Historia logowań, zmian danych i wszystkich operacji w panelu. Dostępna wyłącznie dla dowództwa (Staff
                    Commander i wyżej).
                  </p>
                  <p className="mt-2 text-xs text-white/60">
                    Lista obejmuje pełną historię działań i jest stronicowana po {LOG_PAGE_SIZE} wpisów. Skorzystaj z filtrów,
                    aby zawęzić wyniki do wybranych osób, sekcji lub zakresów czasu.
                  </p>
                </div>

                <div className="card bg-white/90 p-4 shadow">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    <div>
                      <label className="text-xs font-semibold uppercase text-beige-500">Użytkownik</label>
                      <select
                        className="input mt-1 bg-white text-black"
                        value={logFilters.actorUid}
                        onChange={(e) => setLogFilters((prev) => ({ ...prev, actorUid: e.target.value }))}
                      >
                        {actorOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase text-beige-500">Sekcja</label>
                      <select
                        className="input mt-1 bg-white text-black"
                        value={logFilters.section}
                        onChange={(e) => setLogFilters((prev) => ({ ...prev, section: e.target.value }))}
                      >
                        {SECTION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase text-beige-500">Czynność</label>
                      <select
                        className="input mt-1 bg-white text-black"
                        value={logFilters.action}
                        onChange={(e) => setLogFilters((prev) => ({ ...prev, action: e.target.value }))}
                      >
                        {ACTION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase text-beige-500">Od (data i godzina)</label>
                      <input
                        type="datetime-local"
                        className="input mt-1 bg-white text-black"
                        value={logFilters.from}
                        onChange={(e) => setLogFilters((prev) => ({ ...prev, from: e.target.value }))}
                        max={logFilters.to || undefined}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold uppercase text-beige-500">Do (data i godzina)</label>
                      <input
                        type="datetime-local"
                        className="input mt-1 bg-white text-black"
                        value={logFilters.to}
                        onChange={(e) => setLogFilters((prev) => ({ ...prev, to: e.target.value }))}
                        min={logFilters.from || undefined}
                      />
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-beige-600">
                    <span>Filtry aktualizują listę automatycznie po każdej zmianie.</span>
                    <button
                      type="button"
                      className="btn bg-beige-200 text-beige-900 hover:bg-beige-300 disabled:opacity-50"
                      onClick={clearLogFilters}
                      disabled={!hasActiveLogFilters}
                    >
                      Wyczyść filtry
                    </button>
                  </div>
                </div>

                <div className="card p-0 overflow-hidden">
                  {logsError && (
                    <div className="bg-red-50 px-4 py-3 text-sm text-red-700 border-b border-red-200">{logsError}</div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-beige-200 text-sm">
                      <thead className="bg-beige-100">
                        <tr className="text-left">
                          <th className="px-4 py-3 font-semibold">Data</th>
                          <th className="px-4 py-3 font-semibold">Użytkownik</th>
                          <th className="px-4 py-3 font-semibold">Sekcja</th>
                          <th className="px-4 py-3 font-semibold">Czynność</th>
                          <th className="px-4 py-3 font-semibold">Opis</th>
                          <th className="px-4 py-3 font-semibold">Dodatkowe szczegóły</th>
                          <th className="px-4 py-3 font-semibold">Czas sesji</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-beige-100 bg-white/60">
                        {logsLoading ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-6 text-center">Ładowanie logów…</td>
                          </tr>
                        ) : logsError ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-6 text-center text-red-700">
                              Wystąpił błąd podczas wczytywania logów. Spróbuj zmienić filtr lub odświeżyć widok.
                            </td>
                          </tr>
                        ) : activityLogs.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-6 text-center">Brak zarejestrowanych zdarzeń.</td>
                          </tr>
                        ) : (
                          activityLogs.map((log, idx) => {
                            const actor = resolveActor(log);
                            const details = formatLogDetails(log);
                            const sectionLabel = resolveSectionLabel(log.section);
                            const actionLabel = resolveActionLabel(log);
                            return (
                              <tr key={log.id ?? idx} className="align-top">
                                <td className="px-4 py-3 whitespace-nowrap align-top">{formatLogTimestamp(log)}</td>
                                <td className="px-4 py-3 align-top">
                                  <div className="font-semibold text-beige-900">{actor.name}</div>
                                  {actor.login && (
                                    <div className="text-xs text-beige-700">
                                      Login: <span className="font-mono text-[13px]">{actor.login}</span>
                                    </div>
                                  )}
                                  {actor.uid && (
                                    <div className="text-[11px] text-beige-500">UID: {actor.uid}</div>
                                  )}
                                  {log.sessionId && (
                                    <div className="text-[11px] text-beige-500">Sesja: {log.sessionId}</div>
                                  )}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap align-top">
                                  <span className="inline-flex items-center rounded-full bg-beige-200 px-2 py-0.5 text-xs font-semibold text-beige-900">
                                    {sectionLabel}
                                  </span>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap align-top">
                                  <div className="font-semibold text-beige-900">{actionLabel}</div>
                                  {(log.action || log.type) && (
                                    <div className="text-[11px] text-beige-500">{log.action || log.type}</div>
                                  )}
                                </td>
                                <td className="px-4 py-3 align-top">{describeLog(log)}</td>
                                <td className="px-4 py-3 align-top">
                                  {details.length ? (
                                    <ul className="space-y-1 text-sm text-beige-900">
                                      {details.map((detail) => (
                                        <li key={detail.key} className="flex flex-wrap gap-x-2 gap-y-1">
                                          <span className="font-medium text-beige-700">{detail.label}:</span>
                                          <span className="break-words">{detail.value}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <span className="text-beige-500">—</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap align-top">
                                  {formatDuration(resolveDurationMs(log) ?? undefined)}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-col gap-3 border-t border-beige-200 bg-beige-50/60 px-4 py-3 text-sm text-beige-700 md:flex-row md:items-center md:justify-between">
                    <div>
                      {logRange ? (
                        <span>
                          Wpisy {logRange.start}–{logRange.end} • maksymalnie {LOG_PAGE_SIZE} na stronę
                        </span>
                      ) : (
                        <span>Brak wyników dla wybranych filtrów</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn bg-beige-200 text-beige-900 hover:bg-beige-300 disabled:opacity-50"
                        onClick={() => setLogPage((prev) => Math.max(0, prev - 1))}
                        disabled={logPage === 0 || logsLoading}
                      >
                        Poprzednia strona
                      </button>
                      <button
                        type="button"
                        className="btn bg-beige-200 text-beige-900 hover:bg-beige-300 disabled:opacity-50"
                        onClick={() => setLogPage((prev) => prev + 1)}
                        disabled={!hasMoreLogs || logsLoading}
                      >
                        Następna strona
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      </PanelLayout>

      {editorState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl border border-indigo-400 bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 p-6 text-white shadow-2xl">
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
            

          <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-sm font-semibold text-white/80">Login</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    className="input flex-1 bg-white text-black placeholder:text-slate-500"
                    disabled={editorState.mode === "edit"}
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
                  {editorState.mode === "edit"
                    ? " Aby zmienić login, usuń konto w konsoli Firebase i utwórz je ponownie."
                    : ""}
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
                <label className="text-sm font-semibold text-white/80">Numer odznaki</label>
                <input
                  className="input bg-white text-black placeholder:text-slate-500"
                  value={editorState.account.badgeNumber || ""}
                  placeholder="np. 1234"
                  onChange={(e) =>
                    setEditorState((prev) =>
                      prev ? { ...prev, account: { ...prev.account, badgeNumber: e.target.value } } : prev
                    )
                  }
                />
                <p className="mt-1 text-xs text-white/60">Wpisz od 1 do 6 cyfr.</p>
              </div>

              <div>
                <label className="text-sm font-semibold text-white/80">Ranga</label>
                <select
                  className="input bg-white text-black"
                  value={editorState.account.role || DEFAULT_ROLE}
                  onChange={(e) =>
                    setEditorState((prev) =>
                      prev
                        ? { ...prev, account: { ...prev.account, role: e.target.value as Role } }
                        : prev
                    )
                  }
                >
                  {ROLE_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-white/80">Departament</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DEPARTMENTS.map((dept) => {
                    const active = editorState.account.department === dept.value;
                    return (
                      <button
                        key={dept.value}
                        type="button"
                        className={`${CHIP_CLASS} ${active ? "ring-2 ring-offset-2 ring-offset-indigo-900" : "opacity-80 hover:opacity-100"}`}
                        style={{
                          background: dept.background,
                          color: dept.color,
                          borderColor: dept.borderColor,
                        }}
                        onClick={() =>
                          setEditorState((prev) =>
                            prev ? { ...prev, account: { ...prev.account, department: dept.value } } : prev
                          )
                        }
                      >
                        {dept.abbreviation}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-white/60">Wybierz właściwy departament służbowy.</p>
              </div>

              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-white/80">Jednostki wewnętrzne</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {INTERNAL_UNITS.map((unit) => {
                    const active = editorState.account.units?.includes(unit.value);
                    return (
                      <button
                        key={unit.value}
                        type="button"
                        className={`${CHIP_CLASS} ${
                          active ? "ring-2 ring-offset-2 ring-offset-indigo-900" : "opacity-80 hover:opacity-100"
                        }`}
                        style={{
                          background: unit.background,
                          color: unit.color,
                          borderColor: unit.borderColor,
                        }}
                        onClick={() =>
                          setEditorState((prev) => {
                            if (!prev) return prev;
                            const list = Array.isArray(prev.account.units) ? prev.account.units.slice() : [];
                            const idx = list.indexOf(unit.value);
                            if (idx >= 0) {
                              list.splice(idx, 1);
                            } else {
                              list.push(unit.value);
                            }
                            return { ...prev, account: { ...prev.account, units: list } };
                          })
                        }
                      >
                        {unit.abbreviation}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-white/60">
                  Możesz wybrać dowolną liczbę jednostek specjalistycznych.
                </p>
                {editorState.account.units?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1 text-[11px] text-white/70">
                    {editorState.account.units.map((unit) => {
                      const option = getInternalUnitOption(unit);
                      return option ? <span key={option.value}>• {option.label}</span> : null;
                    })}
                  </div>
                ) : null}
              </div>

              <div className="md:col-span-2">
                <label className="text-sm font-semibold text-white/80">Dodatkowy stopień</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={`${CHIP_CLASS} bg-white/10 text-white/80 hover:bg-white/20`}
                    onClick={() =>
                      setEditorState((prev) =>
                        prev
                          ? {
                              ...prev,
                              account: {
                                ...prev.account,
                                additionalRanks: [],
                                additionalRank: null,
                              },
                            }
                          : prev
                      )
                    }
                  >
                    Brak dodatkowego stopnia
                  </button>
                </div>
                <div className="mt-3 space-y-3">
                  {ADDITIONAL_RANK_GROUPS.map((group) => (
                    <div key={group.unit}>
                      <div className="text-xs font-semibold uppercase text-white/60">
                        {group.unitLabel}
                        <span className="ml-2 text-[11px] text-white/40 normal-case">{group.unitDescription}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2">
                        {group.ranks.map((rank) => {
                          const active = Array.isArray(editorState.account.additionalRanks)
                            ? editorState.account.additionalRanks.includes(rank.value)
                            : editorState.account.additionalRank === rank.value;
                          return (
                            <button
                              key={rank.value}
                              type="button"
                              className={`${CHIP_CLASS} ${
                                active ? "ring-2 ring-offset-2 ring-offset-indigo-900" : "opacity-80 hover:opacity-100"
                              } text-[11px]`}
                              style={{
                                background: rank.background,
                                color: rank.color,
                                borderColor: rank.borderColor,
                              }}
                              onClick={() =>
                                setEditorState((prev) => {
                                  if (!prev) return prev;
                                  const list = Array.isArray(prev.account.additionalRanks)
                                    ? prev.account.additionalRanks.slice()
                                    : prev.account.additionalRank
                                    ? [prev.account.additionalRank]
                                    : [];
                                  const idx = list.indexOf(rank.value);
                                  if (idx >= 0) {
                                    list.splice(idx, 1);
                                  } else {
                                    list.push(rank.value);
                                  }
                                  return {
                                    ...prev,
                                    account: {
                                      ...prev.account,
                                      additionalRanks: list,
                                      additionalRank: list[0] ?? null,
                                    },
                                  };
                                })
                              }
                            >
                              {rank.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-xs text-white/60">
                  Aby przypisać stopień, upewnij się, że funkcjonariusz jest w odpowiedniej jednostce.
                </p>
              </div>

              {editorState.mode === "create" ? (
                <div className="md:col-span-2">
                  <label className="text-sm font-semibold text-white/80">Hasło</label>
                  <input
                    type="password"
                    className="input bg-white text-black placeholder:text-slate-500"
                    value={editorState.password || ""}
                    placeholder="Wprowadź hasło"
                    onChange={(e) =>
                      setEditorState((prev) => (prev ? { ...prev, password: e.target.value } : prev))
                    }
                  />
                  <p className="mt-1 text-xs text-white/60">Hasło musi mieć co najmniej 6 znaków.</p>
                </div>
              ) : (
                <div className="md:col-span-2 rounded-2xl border border-white/30 bg-white/10 p-3 text-xs text-white/70">
                  Zmiana hasła jest dostępna z poziomu konsoli Firebase (wyślij reset hasła do użytkownika).
                </div>
              )}
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
