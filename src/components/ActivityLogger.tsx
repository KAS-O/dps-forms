import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, onIdTokenChanged, signOut, User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import { deriveLoginFromEmail } from "@/lib/login";
import { useRouter } from "next/router";

type ActivityEvent = { type: string; [key: string]: any };

type SessionInfo = {
  uid: string;
  login: string;
  sessionId: string;
  startedAt: number;
  fullName?: string;
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
      fullName: parsed.fullName || undefined,
    };
  } catch (error) {
    console.warn("Nie udało się odczytać sesji aktywności:", error);
    return null;
  }
}

function storeSession(info: SessionInfo) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ ...info, fullName: info.fullName || undefined })
    );
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
      return events.map((event) => ({
        ...event,
        login: current.login,
        uid: current.uid,
        sessionId: current.sessionId,
        fullName: current.fullName,
      }));
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

      let fullName: string | undefined = stored?.fullName;
      if (db) {
        try {
          const snap = await getDoc(doc(db, "profiles", user.uid));
          const data = snap.data() as { fullName?: string } | undefined;
          if (data?.fullName) {
            fullName = data.fullName;
          }
        } catch (error) {
          console.warn("Nie udało się pobrać profilu użytkownika dla logów aktywności:", error);
        }
      }

      const info: SessionInfo = stored && stored.uid === user.uid
        ? { ...stored, login, fullName: fullName || stored.fullName }
        : { uid: user.uid, login, sessionId: createSessionId(), startedAt: Date.now(), fullName };

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
