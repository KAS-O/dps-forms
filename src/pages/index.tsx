import Image from "next/image";
import Head from "next/head";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/router";
import AuthGate from "@/components/AuthGate";

const LOGIN_DOMAIN = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dps.local";

export default function LoginPage() {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    document.body.classList.add("is-login");

    // Przelicz skalowanie po oznaczeniu strony jako logowanie
    window.dispatchEvent(new Event("resize"));

    return () => {
      document.body.classList.remove("is-login");
      window.dispatchEvent(new Event("resize"));
    };
  }, []);

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

        <div className="login-layout">
          <div className="auth-shell">
            <div className="card auth-panel login-card w-full p-6 sm:p-8 bg-[var(--card)] border border-white/10">
              <div className="flex flex-col items-center gap-4 mb-6">
                {/* Jeśli masz PNG: zmień logo.svg na logo.png */}
                <Image
                  src="/logo.png"
                  alt="LSPD"
                  width={320}
                  height={80}
                  priority
                  className="floating w-full max-w-[260px] sm:max-w-[320px] h-auto"
                />
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

                <p className="text-xs text-beige-900/80">
                  Dostępy nadaje administrator. Brak rejestracji i opcji resetu hasła.
                </p>
              </form>

              <p className="text-[11px] text-center mt-3 text-beige-900/80">
                Loginy mają format wewnętrzny <code>LOGIN@{LOGIN_DOMAIN}</code>.
              </p>
            </div>
          </div>
        </div>
      </>
    </AuthGate>
  );
}
