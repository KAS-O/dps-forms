import { FormEvent, useState } from "react";
import Image from "next/image";
import Head from "next/head";
import { useRouter } from "next/router";
import { signInWithEmailAndPassword } from "firebase/auth";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import AuthGate from "@/components/AuthGate";
import { auth, db } from "@/lib/firebase";

const LOGIN_DOMAIN = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dps.local";

export default function LoginPage() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const email = `${login}@${LOGIN_DOMAIN}`;
      await signInWithEmailAndPassword(auth, email, password);

      await addDoc(collection(db, "logs"), {
        type: "login_success",
        login,
        ts: serverTimestamp(),
      });

      router.push("/dashboard");
    } catch (error: any) {
      await addDoc(collection(db, "logs"), {
        type: "login_fail",
        login,
        error: error?.code || error?.message,
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
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="card w-full max-w-md p-8 bg-[var(--card)] border border-white/10">
            <div className="mb-6 flex flex-col items-center gap-4">
              <Image src="/logo.png" alt="LSPD" width={320} height={80} priority className="floating" />
              <h1 className="text-xl font-semibold text-center">
                Los Santos Police Department — Panel dokumentów
              </h1>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="label">Login</label>
                <input className="input" value={login} onChange={(event) => setLogin(event.target.value)} required />
              </div>

              <div>
                <label className="label">Hasło</label>
                <input
                  className="input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
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

            <p className="mt-3 text-center text-[11px] text-beige-900/80">
              Loginy mają format wewnętrzny <code>LOGIN@{LOGIN_DOMAIN}</code>.
            </p>
          </div>
        </div>
      </>
    </AuthGate>
  );
}
