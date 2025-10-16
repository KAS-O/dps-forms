import { ReactNode, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/router";
import { auth } from "@/lib/firebase";

export default function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      const isLoginPage = router.pathname === "/";
      if (!user && !isLoginPage) {
        router.replace("/");
      } else if (user && isLoginPage) {
        router.replace("/dashboard");
      }
      setReady(true);
    });
    return () => unsub();
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
