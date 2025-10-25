import { useEffect, useRef } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useSessionActivity } from "@/components/ActivityLogger";

export function useIdleLogout(timeoutMs = 15 * 60 * 1000) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggeredRef = useRef(false);
  const { logLogout, session } = useSessionActivity();
  const sessionId = session?.sessionId;

  useEffect(() => {
    if (!sessionId) {
      triggeredRef.current = false;
      return;
    }
    if (typeof window === "undefined") return undefined;

    let mounted = true;

    const clear = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const handleTimeout = async () => {
      if (triggeredRef.current || !mounted) return;
      triggeredRef.current = true;
      clear();
      try {
        await logLogout("timeout");
      } catch (error) {
        console.warn("Nie udało się zapisać wylogowania z powodu bezczynności:", error);
      }
      try {
        await signOut(auth);
      } catch (error) {
        console.warn("Nie udało się wylogować użytkownika po bezczynności:", error);
      }
    };

    const reset = () => {
      if (!mounted || triggeredRef.current) return;
      clear();
      timer.current = window.setTimeout(handleTimeout, timeoutMs);
    };

    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;
    events.forEach((evt) => window.addEventListener(evt, reset, { passive: true }));

    const handleVisibility = () => {
      if (document.visibilityState !== "hidden") {
        reset();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    triggeredRef.current = false;
    reset();

    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", handleVisibility);
      events.forEach((evt) => window.removeEventListener(evt, reset));
      clear();
    };
  }, [logLogout, sessionId, timeoutMs]);
}
