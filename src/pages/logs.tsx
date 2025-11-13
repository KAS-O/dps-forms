import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useProfile, can } from "@/hooks/useProfile";

export default function LogsPage() {
  const { role, adminPrivileges } = useProfile();

  if (!can.seeLogs(role, adminPrivileges)) return (
    <AuthGate>
      <Nav /><div className="max-w-4xl mx-auto p-6">Brak uprawnień.</div>
    </AuthGate>
  );

  return (
    <AuthGate>
      <Head><title>LSPD 77RP — Logi</title></Head>
      <Nav />
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="card p-6">
          <h1 className="text-2xl font-semibold mb-3">Logi aktywności</h1>
          <p className="text-sm text-beige-700">
            Logi zostały przeniesione do Panelu zarządu. Przejdź do zakładki <b>Logi</b> w panelu dowódczym (Staff Commander i
            wyżej), aby zobaczyć szczegółowe zestawienie zdarzeń.
          </p>
        </div>
      </div>
    </AuthGate>
  );
}
