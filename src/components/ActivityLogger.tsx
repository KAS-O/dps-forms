import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, onIdTokenChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { deriveLoginFromEmail } from "@/lib/login";
import { useRouter } from "next/router";

type ActivityEvent = { type: string; [key: string]: any };

type SessionInfo = {
  uid: string;
  login: string;
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
    };
  } catch (error) {
    console.warn("Nie udało się odczytać sesji aktywności:", error);
    return null;
  }
}

function storeSession(info: SessionInfo) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(info));
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

  const enrichEvents = useCallback(
    (events: ActivityEvent[]): ActivityEvent[] => {
      const current = sessionRef.current;
      if (!current) return [];
      return events.map((event) => ({
        ...event,
        login: current.login,
        uid: current.uid,
        sessionId: current.sessionId,
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

  const handleUser = useCallback(
    async (user: User | null) => {
      if (!user) {
        sessionRef.current = null;
        setSession(null);
        tokenRef.current = null;
        endedRef.current = false;
        lastPathRef.current = null;
        return;
      }

      const login = deriveLoginFromEmail(user.email || "");
      const stored = readStoredSession();

      const info: SessionInfo = stored && stored.uid === user.uid
        ? { ...stored, login }
        : { uid: user.uid, login, sessionId: createSessionId(), startedAt: Date.now() };

      sessionRef.current = info;
      setSession(info);
      endedRef.current = false;
      lastPathRef.current = null;
      storeSession(info);

      if (!stored || stored.sessionId !== info.sessionId) {
        tokenRef.current = await ensureIdToken(user);
        await sendEvents([{ type: "session_start" }]);
      }
    },
    [sendEvents]
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
      if (endedRef.current) return;
      const current = sessionRef.current;
      if (!current) return;
      endedRef.current = true;
      const durationMs = Math.max(0, Date.now() - current.startedAt);
      clearStoredSession();
      void sendEvents([{ type: "session_end", reason: "window_closed", durationMs }], { useBeacon: true });
      sessionRef.current = null;
      setSession(null);
    };

    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [sendEvents, session]);

  const logActivity = useCallback(
    async (event: ActivityEvent) => {
      await sendEvents([event]);
    },
    [sendEvents]
  );

  const logLogout = useCallback(
    async (reason: "logout" | "timeout" = "logout") => {
      if (endedRef.current) return;
      const current = sessionRef.current;
      if (!current) return;
      endedRef.current = true;
      const durationMs = Math.max(0, Date.now() - current.startedAt);
      clearStoredSession();
      await sendEvents(
        [
          { type: "logout", reason, durationMs },
          { type: "session_end", reason, durationMs },
        ]
      );
      sessionRef.current = null;
      setSession(null);
    },
    [sendEvents]
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
