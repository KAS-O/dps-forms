import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { DialogProvider } from "@/components/DialogProvider";
import { ActivityLoggerProvider } from "@/components/ActivityLogger";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <DialogProvider>
     <ActivityLoggerProvider>
        <div className="min-h-screen flex flex-col relative bg-[#02060f] text-white">
          <div className="relative z-10 flex-1 flex flex-col">
            <Component {...pageProps} />
          </div>
          <footer className="relative z-10 w-full border-t border-white/10 bg-[var(--card)]/80 backdrop-blur py-4 text-center text-xs text-beige-900/80">
            <p>© 2025 Los Santos Police Department. Wszelkie prawa zastrzeżone.</p>
            <p>
              Niniejsza strona oraz cała jej zawartość stanowią własność KASO i są przeznaczone wyłącznie dla
              funkcjonariuszy Los Santos Police Department na serwerze 77RP.
            </p>
            <p>
              Kopiowanie, rozpowszechnianie, modyfikowanie lub wykorzystywanie materiałów ze strony bez uprzedniej,
              wyraźnej zgody jest zabronione.
            </p>
            <p>Dostęp i korzystanie z serwisu podlegają wewnętrznym regulacjom i mogą być monitorowane.</p>
          </footer>
        </div>
      </ActivityLoggerProvider>
    </DialogProvider>
  );
}
