import { useEffect, useRef } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

export function useIdleLogout(timeoutMs = 15 * 60 * 1000) {
  const timer = useRef<any>(null);

  useEffect(() => {
    const reset = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => signOut(auth), timeoutMs);
    };

    ["mousemove","keydown","click","scroll","touchstart"].forEach(evt =>
      window.addEventListener(evt, reset, { passive: true })
    );
    reset();

    const onUnload = () => { try { signOut(auth); } catch {} };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      ["mousemove","keydown","click","scroll","touchstart"].forEach(evt =>
        window.removeEventListener(evt, reset)
      );
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [timeoutMs]);
}
