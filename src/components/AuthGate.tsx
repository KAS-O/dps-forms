import { ReactNode, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";
import { auth, db } from "@/lib/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

export default function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let hb: any;

    const refreshAfterNavigation = (targetPath: string) => {
      const reload = () => {
        if (typeof window !== "undefined") {
          window.setTimeout(() => window.location.reload(), 50);
        }
      };

      if (router.asPath === targetPath) {
        reload();
        return;
      }

      router
        .replace(targetPath)
        .then(reload)
        .catch(reload);
    };

    const unsub = onAuthStateChanged(auth, (user) => {
      const isLoginPage = router.pathname === "/";

      if (user) {
        // NIE czekamy na Promise — nawet jeśli reguły odmówią, nie blokujemy UI
        try {
          setDoc(
            doc(db, "presence", user.uid),
            { login: user.email || "", lastSeen: serverTimestamp() },
            { merge: true }
          ).catch(() => {});
          hb = setInterval(() => {
            setDoc(
              doc(db, "presence", user.uid),
              { lastSeen: serverTimestamp() },
              { merge: true }
            ).catch(() => {});
          }, 60_000);
        } catch (e) {
          console.warn("presence write failed:", e);
        }

        if (isLoginPage) {
          refreshAfterNavigation("/dashboard");
        }
      } else {
        if (!isLoginPage) {
          refreshAfterNavigation("/");
        }
      }

      setReady(true);
    });

    return () => {
      unsub();
      if (hb) clearInterval(hb);
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
