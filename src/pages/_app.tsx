import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { DialogProvider } from "@/components/DialogProvider";
import { ActivityLoggerProvider } from "@/components/ActivityLogger";

export default function App({ Component, pageProps }: AppProps) {
 return (
    <DialogProvider>
     <ActivityLoggerProvider>
        <div className="min-h-screen flex flex-col">
          <div className="flex-1 flex flex-col">
            <Component {...pageProps} />
          </div>
          <footer className="w-full border-t border-beige-300 bg-[var(--card)] text-center text-xs text-beige-700 py-3">
            <p>© 2025 Department of Public Safety. Wszelkie prawa zastrzeżone.</p>
            <p>
              Niniejsza strona oraz cała jej zawartość stanowią własność KASO i są przeznaczone wyłącznie dla funkcjonariuszy
              Department of Public Safety na serwerze 77RP.
            </p>
            <p>
              Kopiowanie, rozpowszechnianie, modyfikowanie lub wykorzystywanie materiałów ze strony bez uprzedniej, wyraźnej zgody
              jest zabronione.
            </p>
            <p>Dostęp i korzystanie z serwisu podlegają wewnętrznym regulacjom i mogą być monitorowane.</p>
          </footer>
        </div>
     </ActivityLoggerProvider>
     
    </DialogProvider>  
  );
}
