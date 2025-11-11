import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, onIdTokenChanged, signOut, User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { deriveLoginFromEmail } from "@/lib/login";
import { useRouter } from "next/router";
import { doc, getDoc } from "firebase/firestore";

type ActivityEvent = { type: string; [key: string]: any };

type SessionInfo = {
  uid: string;
  login: string;
  name?: string;
  sessionId: string;
  startedAt: number;
};

type SessionActivityContextValue = {
  logActivity: (event: ActivityEvent) => Promise<void>;
  logLogout: (reason?: "logout" | "timeout") => Promise<void>;
  session: SessionInfo | null;
};

const SessionActivityContext = createContext<SessionActivityContextValue>({
  logActivity: async () => {},
  logLogout: async () => {},
  session: null,
});

const SESSION_STORAGE_KEY = "dps-activity-session";
const INACTIVITY_LIMIT_MS = 15 * 60 * 1000;

function readStoredSession(): SessionInfo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionInfo;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.uid || !parsed.sessionId || !parsed.startedAt) return null;
    return {
      uid: parsed.uid,
      login: parsed.login || "",
      sessionId: parsed.sessionId,
      startedAt: Number(parsed.startedAt) || Date.now(),
      name: typeof parsed.name === "string" ? parsed.name : undefined,
    };
  } catch (error) {
    console.warn("Nie udało się odczytać sesji aktywności:", error);
    return null;
  }
}

function storeSession(info: SessionInfo) {
  if (typeof window === "undefined") return;
  try {
    const payload: SessionInfo = {
      uid: info.uid,
      login: info.login,
      sessionId: info.sessionId,
      startedAt: info.startedAt,
      name: info.name,
    };
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Nie udało się zapisać sesji aktywności:", error);
  }
}

function clearStoredSession() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (error) {
    console.warn("Nie udało się wyczyścić sesji aktywności:", error);
  }
}

function createSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureIdToken(user: User | null): Promise<string | null> {
  try {
    if (!user) return null;
    return await user.getIdToken();
  } catch (error) {
    console.warn("Nie udało się uzyskać tokenu ID Firebase:", error);
    return null;
  }
}

async function postEvents(token: string | null, events: ActivityEvent[], useBeacon = false) {
  if (!events.length || typeof window === "undefined") return;
  if (!token) return;

  const body = JSON.stringify({ token, events });

  try {
    if (useBeacon && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon("/api/activity-log", blob);
      if (ok) return;
      // fallback do fetch jeżeli beacon się nie udał
    }

    await fetch("/api/activity-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: useBeacon,
    });
  } catch (error) {
    console.warn("Nie udało się wysłać zdarzeń aktywności:", error);
  }
}

export function useSessionActivity() {
  return useContext(SessionActivityContext);
}

export function ActivityLoggerProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const sessionRef = useRef<SessionInfo | null>(null);
  const tokenRef = useRef<string | null>(null);
  const endedRef = useRef(false);
  const lastPathRef = useRef<string | null>(null);
  const inactivityTimeoutRef = useRef<number | null>(null);
  const lastActivityRef = useRef<number>(Date.now());

  const enrichEvents = useCallback(
    (events: ActivityEvent[]): ActivityEvent[] => {
      const current = sessionRef.current;
      if (!current) return [];

      const formatDurationString = (value: number | undefined) => {
        if (typeof value !== "number" || Number.isNaN(value) || value <= 0) return null;
        const totalSeconds = Math.floor(value / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const pad = (unit: number) => unit.toString().padStart(2, "0");
        return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
      };

      const describeEvent = (event: ActivityEvent) => {
        switch (event.type) {
          case "session_start":
            return {
              section: "sesja",
              action: "session.start",
              message: "Rozpoczęto sesję w panelu.",
              details: { "Identyfikator sesji": current.sessionId },
            };
          case "session_end":
            return {
              section: "sesja",
              action: "session.end",
              message: `Zakończono sesję (powód: ${event.reason || "nieznany"}).`,
              details: {
                powod: event.reason || null,
                "Identyfikator sesji": current.sessionId,
                "Czas trwania": formatDurationString(event.durationMs),
              },
            };
          case "logout":
            return {
              section: "sesja",
              action: "session.logout",
              message: `Wylogowanie użytkownika (powód: ${event.reason || "nieznany"}).`,
              details: {
                powod: event.reason || null,
                "Identyfikator sesji": current.sessionId,
              },
            };
          case "page_view":
            return {
              section: "nawigacja",
              action: "page.view",
              message: `Otworzono stronę ${event.title || event.path || "(nieznana)"}.`,
              details: { sciezka: event.path || null, tytul: event.title || null },
            };
          case "template_view":
            return {
              section: "dokumenty",
              action: "template.view",
              message: `Wyświetlono szablon dokumentu ${event.template || event.slug || "(nieznany)"}.`,
              details: { szablon: event.template || event.slug || null },
            };
          case "archive_view":
            return { section: "archiwum", action: "archive.view", message: "Przegląd archiwum dokumentów." };
          case "archive_image_open":
            return {
              section: "archiwum",
              action: "archive.image_open",
              message: `Podgląd obrazu z archiwum (ID ${event.archiveId || "?"}).`,
              details: { archiwumId: event.archiveId || null },
            };
          case "dossier_view":
            return {
              section: "teczki",
              action: "dossier.view",
              message: `Otworzono teczkę ${event.dossierTitle || event.dossierId || "(ID nieznane)"}.`,
              details: {
                dossierId: event.dossierId || null,
                tytul: event.dossierTitle || null,
                cid: event.dossierCid || null,
              },
            };
          case "dossier_link_open":
            return {
              section: "teczki",
              action: "dossier.link_open",
              message: `Przejście do teczki ${event.dossierTitle || event.dossierId || "(ID nieznane)"}.`,
              details: {
                dossierId: event.dossierId || null,
                tytul: event.dossierTitle || null,
                cid: event.dossierCid || null,
              },
            };
          case "dossier_evidence_open":
            return {
              section: "teczki",
              action: "dossier.evidence_open",
              message: `Otworzono załącznik w teczce ${event.dossierId || "?"}.`,
              details: {
                dossierId: event.dossierId || null,
                recordId: event.recordId || null,
                wpis: event.recordTitle || null,
              },
            };
          case "vehicle_archive_view":
            return {
              section: "archiwum-pojazdow",
              action: "vehicle.archive_view",
              message: "Przegląd archiwum pojazdów.",
              details: { liczbaPojazdow: event.vehiclesTotal || null },
            };
          case "vehicle_folder_view":
            return {
              section: "archiwum-pojazdow",
              action: "vehicle.folder_view",
              message: `Otworzono teczkę pojazdu ${event.registration || event.vehicleId || "(ID)"}.`,
              details: {
                pojazdId: event.vehicleId || null,
                rejestracja: event.registration || null,
                wlasciciel: event.ownerName || null,
                wlascicielCid: event.ownerCid || null,
              },
            };
          case "vehicle_from_dossier_open":
            return {
              section: "teczki",
              action: "vehicle.from_dossier_open",
              message: `Podgląd pojazdu ${event.vehicleId || "?"} z poziomu teczki ${event.dossierId || "?"}.`,
              details: {
                dossierId: event.dossierId || null,
                vehicleId: event.vehicleId || null,
              },
            };
          case "criminal_group_open":
            return {
              section: "teczki",
              action: "criminal_group.open",
              message: `Podgląd organizacji o ID ${event.dossierId || "?"}.`,
              details: { dossierId: event.dossierId || null },
            };
          default:
            return {
              section: "inne",
              action: `custom.${event.type || "unknown"}`,
              message: `Zdarzenie ${event.type || "nieznane"}.`,
            };
        }
      };

      return events.map((event) => {
        const meta = describeEvent(event);
        return {
          ...event,
          login: current.login,
          uid: current.uid,
          sessionId: current.sessionId,
          actorLogin: current.login,
          actorUid: current.uid,
          actorName: current.name || current.login,
          ...meta,
        };
      });
    },
    []
  );

  const sendEvents = useCallback(
    async (events: ActivityEvent[], { useBeacon = false }: { useBeacon?: boolean } = {}) => {
      const enriched = enrichEvents(events);
      if (!enriched.length) return;

      let token = tokenRef.current;
      if (!token) {
        if (!auth) return;
        token = await ensureIdToken(auth.currentUser);
        tokenRef.current = token;
      }

      await postEvents(token, enriched, useBeacon);
    },
    [enrichEvents]
  );

  useEffect(() => {
    if (!auth) return;
    const unsub = onIdTokenChanged(auth, async (user) => {
      tokenRef.current = await ensureIdToken(user);
    });
    return () => unsub();
  }, []);

  const clearInactivityTimer = useCallback(() => {
    if (typeof window === "undefined") return;
    if (inactivityTimeoutRef.current != null) {
      window.clearTimeout(inactivityTimeoutRef.current);
      inactivityTimeoutRef.current = null;
    }
  }, []);

  const finalizeSession = useCallback(
    async ({
      reason,
      includeLogout = false,
      useBeacon = false,
    }: {
      reason: "logout" | "timeout" | "window_closed";
      includeLogout?: boolean;
      useBeacon?: boolean;
    }) => {
      if (endedRef.current) return;
      const current = sessionRef.current;
      if (!current) return;
      endedRef.current = true;
      clearStoredSession();
      clearInactivityTimer();
      const durationMs = Math.max(0, Date.now() - current.startedAt);
      const events: ActivityEvent[] = [{ type: "session_end", reason, durationMs }];
      if (includeLogout) {
        events.unshift({ type: "logout", reason, durationMs });
      }
      await sendEvents(events, { useBeacon });
      sessionRef.current = null;
      setSession(null);
      tokenRef.current = null;
      lastPathRef.current = null;
    },
    [clearInactivityTimer, sendEvents]
  );

  const handleInactivityTimeout = useCallback(async () => {
    if (!sessionRef.current) return;
    await finalizeSession({ reason: "timeout", includeLogout: true });
    if (auth) {
      try {
        await signOut(auth);
      } catch (error) {
        console.warn("Nie udało się wylogować użytkownika po czasie bezczynności:", error);
      }
    }
  }, [finalizeSession]);

  const scheduleInactivityTimer = useCallback(() => {
    if (typeof window === "undefined") return;
    clearInactivityTimer();
    if (!sessionRef.current) return;
    inactivityTimeoutRef.current = window.setTimeout(() => {
      void handleInactivityTimeout();
    }, INACTIVITY_LIMIT_MS);
  }, [clearInactivityTimer, handleInactivityTimeout]);

  const registerActivity = useCallback(() => {
    if (!sessionRef.current) return;
    lastActivityRef.current = Date.now();
    scheduleInactivityTimer();
  }, [scheduleInactivityTimer]);

  const handleUser = useCallback(
    async (user: User | null) => {
      if (!user) {
        sessionRef.current = null;
        setSession(null);
        tokenRef.current = null;
        endedRef.current = false;
        lastPathRef.current = null;
        clearInactivityTimer();
        return;
      }

      const login = deriveLoginFromEmail(user.email || "");
      const stored = readStoredSession();

      let name = stored && stored.uid === user.uid ? stored.name : undefined;
      if (!name && db) {
        try {
          const profileSnap = await getDoc(doc(db, "profiles", user.uid));
          if (profileSnap.exists()) {
            const fullName = ((profileSnap.data()?.fullName as string) || "").trim();
            name = fullName || undefined;
          }
        } catch (error) {
          console.warn("Nie udało się pobrać profilu użytkownika do logów aktywności:", error);
        }
      }

      const info: SessionInfo =
        stored && stored.uid === user.uid
          ? { ...stored, login, name }
          : { uid: user.uid, login, name, sessionId: createSessionId(), startedAt: Date.now() };

      sessionRef.current = info;
      setSession(info);
      endedRef.current = false;
      lastPathRef.current = null;
      storeSession(info);
      registerActivity();

      if (!stored || stored.sessionId !== info.sessionId) {
        tokenRef.current = await ensureIdToken(user);
        await sendEvents([{ type: "session_start" }]);
      }
    },
    [registerActivity, sendEvents, clearInactivityTimer]
  );

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, handleUser);
    return () => unsub();
  }, [handleUser]);

  useEffect(() => {
    if (!session) return;

    const logPath = (path: string) => {
      if (!path) return;
      if (lastPathRef.current === path) return;
      lastPathRef.current = path;
      const title = typeof document !== "undefined" ? document.title : "";
      void sendEvents([{ type: "page_view", path, title }]);
    };

    logPath(router.asPath);

    const onRouteChange = (url: string) => logPath(url);
    router.events.on("routeChangeComplete", onRouteChange);
    return () => {
      router.events.off("routeChangeComplete", onRouteChange);
    };
  }, [router, sendEvents, session]);

  useEffect(() => {
    if (!session) return;

    const handleUnload = () => {
      void finalizeSession({ reason: "window_closed", useBeacon: true });
    };

    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [finalizeSession, session]);

  useEffect(() => {
    if (!session) {
      clearInactivityTimer();
      return;
    }
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const activityEvents: (keyof WindowEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
    ];

    const handleActivity = () => {
      registerActivity();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        registerActivity();
      }
    };

    activityEvents.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true } as EventListenerOptions);
    });
    document.addEventListener("visibilitychange", handleVisibilityChange);

    registerActivity();

    return () => {
      activityEvents.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [clearInactivityTimer, registerActivity, session]);

  const logActivity = useCallback(
    async (event: ActivityEvent) => {
      registerActivity();
      await sendEvents([event]);
    },
    [registerActivity, sendEvents]
  );

  const logLogout = useCallback(
    async (reason: "logout" | "timeout" = "logout") => {
      await finalizeSession({ reason, includeLogout: true });
    },
    [finalizeSession]
  );

  const value = useMemo(
    () => ({
      logActivity,
      logLogout,
      session,
    }),
    [logActivity, logLogout, session]
  );

  return <SessionActivityContext.Provider value={value}>{children}</SessionActivityContext.Provider>;
}
