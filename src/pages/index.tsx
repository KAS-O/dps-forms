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

  const getErrorMessage = (code?: string) => {
    switch (code) {
      case "auth/user-not-found":
        return "Nie znaleziono użytkownika o podanym loginie. Sprawdź pisownię lub skontaktuj się z administratorem.";
      case "auth/invalid-email":
        return "Login ma nieprawidłowy format. Upewnij się, że wpisujesz wewnętrzny login bez domeny.";
      case "auth/wrong-password":
        return "Hasło jest nieprawidłowe. Spróbuj ponownie lub skontaktuj się z przełożonym.";
      case "auth/invalid-credential":
        return "Wprowadzono nieprawidłową kombinację loginu i hasła. Sprawdź oba pola.";
      case "auth/too-many-requests":
        return "Zbyt wiele nieudanych prób logowania. Odczekaj chwilę przed kolejną próbą.";
      default:
        return "Wprowadzono błędne dane logowania. Sprawdź login oraz hasło i spróbuj ponownie.";
    }
  };

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

      setError(getErrorMessage(e?.code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Logowanie</title>
        </Head>

        <div className="auth-layout">
          <div className="auth-shell">
            <div className="card auth-panel auth-scale w-full max-w-xl mx-auto p-6 sm:p-8 bg-[var(--card)] border border-white/10">
              <div className="flex flex-col items-center text-center gap-3 sm:gap-4 mb-6">
                <Image src="/logo.png" alt="LSPD" width={240} height={60} priority className="floating" />
                <h1 className="text-xl sm:text-2xl font-semibold leading-tight">
                  <span className="block">Los Santos Police Department</span>
                  <span className="block text-base sm:text-lg text-beige-900/80">Mobile Data Terminal</span>
                </h1>
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-1">
                  <label className="label">Login</label>
                  <input
                    className="input"
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    required
                    inputMode="email"
                    autoComplete="username"
                  />
                </div>

                <div className="space-y-1">
                  <label className="label">Hasło</label>
                  <input
                    className="input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </div>

                {error && (
                  <p
                    className="rounded-xl border border-red-500/40 bg-red-900/40 px-3 py-2 text-sm text-red-100"
                    role="alert"
                  >
                    {error}
                  </p>
                )}

                <button className="btn w-full min-h-[3rem] text-center" disabled={loading}>
                  {loading ? "Logowanie..." : "Zaloguj"}
                </button>

                <p className="text-xs text-beige-900/80 leading-relaxed">
                  Dostępy nadaje administrator. Brak rejestracji i opcji resetu hasła.
                </p>
              </form>

              <p className="text-[11px] text-center mt-4 text-beige-900/80 leading-relaxed">
                Loginy mają format wewnętrzny <code>LOGIN@{LOGIN_DOMAIN}</code>.
              </p>
            </div>
          </div>
        </div>
      </>
    </AuthGate>
  );
}
