import AuthGate from "@/components/AuthGate";
import PanelLayout from "@/components/PanelLayout";
import Head from "next/head";
import { useProfile, can } from "@/hooks/useProfile";

export default function LogsPage() {
  const { role } = useProfile();
 
  if (!can.seeLogs(role))
    return (
      <AuthGate>
        <PanelLayout>
          <div className="max-w-4xl">
            <div className="card p-6">Brak uprawnień.</div>
          </div>
        </PanelLayout>
      </AuthGate>
    );

  return (
    <AuthGate>
      <Head><title>LSPD 77RP — Logi</title></Head>
      <PanelLayout>
        <div className="max-w-4xl">
          <div className="card p-6">
          <h1 className="text-2xl font-semibold mb-3">Logi aktywności</h1>
          <p className="text-sm text-beige-700">
            Logi zostały przeniesione do Panelu zarządu. Przejdź do zakładki <b>Logi</b> w panelu dowódczym (Staff Commander i
            wyżej), aby zobaczyć szczegółowe zestawienie zdarzeń.
          </p>
          </div>
        </div>
      </PanelLayout>
    </AuthGate>
  );
}
