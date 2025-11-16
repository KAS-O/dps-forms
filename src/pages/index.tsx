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
            <div className="card auth-panel w-full max-w-2xl p-6 sm:p-8 lg:p-10 bg-[var(--card)] border border-white/10 shadow-xl">
              <div className="flex flex-col items-center gap-4 mb-2 sm:mb-4">
                <Image
                  src="/logo.png"
                  alt="LSPD"
                  width={320}
                  height={80}
                  priority
                  className="floating w-full max-w-xs sm:max-w-md h-auto"
                />
                <h1 className="text-center text-lg sm:text-xl font-semibold leading-tight">
                  <span className="block">Los Santos Police Department</span>
                  <span className="block">Mobile Data Terminal</span>
                </h1>
                <p className="text-center text-sm text-ink-muted">
                  Bezpieczne logowanie służbowe. Formularz dopasowuje się do każdego ekranu, więc nie musisz
                  przybliżać ani pomniejszać widoku.
                </p>
              </div>

              <form onSubmit={onSubmit} className="space-y-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <label className="label">Login</label>
                    <input
                      className="input"
                      value={login}
                      onChange={(e) => setLogin(e.target.value)}
                      autoComplete="username"
                      required
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="label">Hasło</label>
                    <input
                      className="input"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </div>
                </div>

                {error && (
                  <p
                    className="rounded-xl border border-red-500/40 bg-red-900/40 px-3 py-2 text-sm text-red-100"
                    role="alert"
                  >
                    {error}
                  </p>
                )}

                <button className="btn w-full" disabled={loading}>
                  {loading ? "Logowanie..." : "Zaloguj"}
                </button>

                <div className="grid gap-3 text-xs text-beige-900/80 sm:grid-cols-2 sm:items-start">
                  <p>
                    Dostępy nadaje administrator. Brak rejestracji i opcji resetu hasła. W razie problemów skontaktuj
                    się z przełożonym.
                  </p>
                  <p className="sm:text-right">
                    Loginy mają format wewnętrzny <code>LOGIN@{LOGIN_DOMAIN}</code>. Pamiętaj, aby stosować domenę
                    służbową.
                  </p>
                </div>
              </form>
            </div>
          </div>
        </div>
      </>
    </AuthGate>
  );
}
