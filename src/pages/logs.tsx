import AuthGate from "@/components/AuthGate";
import PanelLayout from "@/components/PanelLayout";
import Head from "next/head";
import { useProfile, can } from "@/hooks/useProfile";

export default function LogsPage() {
  const { role } = useProfile();
 
  if (!can.seeLogs(role))
    return (
      <AuthGate>
        <Head>
          <title>LSPD 77RP — Logi</title>
        </Head>
        <PanelLayout>
          <div className="card p-6 text-center text-sm text-white/70">Brak uprawnień.</div>
        </PanelLayout>
      </AuthGate>
    );

  return (
    <AuthGate>
      <Head><title>LSPD 77RP — Logi</title></Head>
      <PanelLayout>
        <div className="card p-6 space-y-3">
          <h1 className="text-2xl font-semibold">Logi aktywności</h1>
          <p className="text-sm text-beige-100/80">
            Logi zostały przeniesione do Panelu zarządu. Przejdź do zakładki <b>Logi</b> w panelu dowódczym (Staff Commander
            i wyżej), aby zobaczyć szczegółowe zestawienie zdarzeń.
          </p>
        </div>
      </PanelLayout>
    </AuthGate>
  );
}
