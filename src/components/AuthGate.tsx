import { ReactNode, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useIdleLogout } from "@/hooks/useIdleLogout";
import { useRouter } from "next/router";
import { auth, db } from "@/lib/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

export default function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useIdleLogout(); // auto-logout po 15 min braku aktywności


  useEffect(() => {
    let interval: any;

    const unsub = onAuthStateChanged(auth, (user) => {
      const isLoginPage = router.pathname === "/";

      if (!user && !isLoginPage) {
        router.replace("/");
      } else if (user && isLoginPage) {
        router.replace("/dashboard");
      }

      setReady(true);

      // --- Presence / heartbeat ---
      if (user) {
        const domain = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dps.local";
        const email = user.email || "";
        const suffix = `@${domain}`;
        const login = email.endsWith(suffix) ? email.slice(0, -suffix.length) : email;

        const updatePresence = () =>
          setDoc(
            doc(db, "presence", user.uid),
            { login, lastSeen: serverTimestamp() },
            { merge: true }
          );

        // od razu oznacz jako aktywnego
        updatePresence();
        // i aktualizuj co 60s
        interval = setInterval(updatePresence, 60_000);
      } else {
        if (interval) clearInterval(interval);
      }
      // --- /Presence ---
    });

    return () => {
      unsub();
      if (interval) clearInterval(interval);
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="card p-6 text-center">
          <p>Ładowanie...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
