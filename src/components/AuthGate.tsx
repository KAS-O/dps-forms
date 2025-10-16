import { ReactNode, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { useRouter } from "next/router";
import { auth, db } from "@/lib/firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

const IDLE_MS = 15 * 60 * 1000; // 15 min

export default function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      const isLoginPage = router.pathname === "/";
      if (!user && !isLoginPage) {
        router.replace("/");
      } else if (user && isLoginPage) {
        router.replace("/dashboard");
      }

      // presence + heartbeat
      if (user) {
        await setDoc(
          doc(db, "presence", user.uid),
          { login: user.email, lastSeen: serverTimestamp() },
          { merge: true }
        );
      }

      setReady(true);
    });
    return () => unsub();
  }, [router]);

  // Auto-logout on idle + on tab close
  useEffect(() => {
    let t: any;

    const reset = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        signOut(auth);
      }, IDLE_MS);
    };

    reset();
    window.addEventListener("mousemove", reset);
    window.addEventListener("keydown", reset);
    window.addEventListener("click", reset);
    window.addEventListener("beforeunload", () => {
      // best-effort; nie zawsze zdąży
      signOut(auth);
    });

    return () => {
      clearTimeout(t);
      window.removeEventListener("mousemove", reset);
      window.removeEventListener("keydown", reset);
      window.removeEventListener("click", reset);
    };
  }, []);

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
