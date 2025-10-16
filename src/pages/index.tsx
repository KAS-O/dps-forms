import Image from "next/image";
import Head from "next/head";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { FormEvent, useState } from "react";
import { useRouter } from "next/router";
import AuthGate from "@/components/AuthGate";

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
        login,
        ts: serverTimestamp(),
      });

      router.push("/dashboard");
    } catch (e: any) {
      // log niepowodzenia
      await addDoc(collection(db, "logs"), {
        type: "login_fail",
        login,
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
          <title>DPS 77RP — Logowanie</title>
        </Head>

        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="card w-full max-w-md p-8 bg-[var(--card)]">
            <div className="flex flex-col items-center gap-4 mb-6">
              {/* Jeśli masz PNG: zmień logo.svg na logo.png */}
              <Image src="/logo.png" alt="DPS" width={320} height={80} priority />
              <h1 className="text-xl font-semibold text-center">
                Department of Public Safety — Panel dokumentów
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

              {error && <p className="text-red-700 text-sm">{error}</p>}

              <button className="btn w-full" disabled={loading}>
                {loading ? "Logowanie..." : "Zaloguj"}
              </button>

              <p className="text-xs text-beige-700">
                Dostępy nadaje administrator. Brak rejestracji i opcji resetu hasła.
              </p>
            </form>

            <p className="text-[11px] text-center mt-3 text-beige-700">
              Loginy mają format wewnętrzny <code>LOGIN@{LOGIN_DOMAIN}</code>.
            </p>
          </div>
        </div>
      </>
    </AuthGate>
  );
}
