import Image from "next/image";
import Head from "next/head";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { FormEvent, useState } from "react";
import { useRouter } from "next/router";
import AuthGate from "@/components/AuthGate";
import PageShell from "@/components/PageShell";

const LOGIN_DOMAIN = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dps.local";

export default function LoginPage() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const email = `${login}@${LOGIN_DOMAIN}`;
      await signInWithEmailAndPassword(auth, email, password);

      // log sukcesu
      await addDoc(collection(db, "logs"), {
        type: "login_success",
        section: "logowanie",
        action: "auth.login_success",
        message: `Pomyślne logowanie użytkownika ${login}.`,
        login,
        actorLogin: login,
        actorName: login,
        ts: serverTimestamp(),
      });

      router.push("/dashboard");
    } catch (e: any) {
      // log niepowodzenia
      await addDoc(collection(db, "logs"), {
        type: "login_fail",
        section: "logowanie",
        action: "auth.login_fail",
        message: `Nieudane logowanie użytkownika ${login}.`,
        login,
        actorLogin: login,
        actorName: login,
        error: e?.code || e?.message,
        ts: serverTimestamp(),
      });

      setError("Nieprawidłowy login lub hasło");
      setLoading(false);
    }
  };

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Logowanie</title>
        </Head>

        <PageShell as="main" className="flex min-h-screen items-center justify-center py-12">
          <div className="card w-full max-w-md p-6 sm:p-8 bg-[var(--card)] border border-white/10">
            <div className="flex flex-col items-center gap-4 mb-6">
              {/* Jeśli masz PNG: zmień logo.svg na logo.png */}
              <Image src="/logo.png" alt="LSPD" width={320} height={80} priority className="floating" />
              <h1 className="text-xl font-semibold text-center">
                <span className="block">Los Santos Police Department</span>
                <span className="block">Mobile Data Terminal</span>
              </h1>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="label">Login</label>
                <input
                  className="input"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label">Hasło</label>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {error && <p className="text-red-300 text-sm">{error}</p>}

              <button className="btn w-full" disabled={loading}>
                {loading ? "Logowanie..." : "Zaloguj"}
              </button>

              <p className="text-xs text-beige-900/80">
                Dostępy nadaje administrator. Brak rejestracji i opcji resetu hasła.
              </p>
            </form>

            <p className="text-[11px] text-center mt-3 text-beige-900/80">
              Loginy mają format wewnętrzny <code>LOGIN@{LOGIN_DOMAIN}</code>.
            </p>
          </div>
        </PageShell>
      </>
    </AuthGate>
  );
}
