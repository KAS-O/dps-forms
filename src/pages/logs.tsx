import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { UnitsPanel } from "@/components/UnitsPanel";
import { AccountPanel } from "@/components/AccountPanel";
import { useProfile, can } from "@/hooks/useProfile";

export default function LogsPage() {
  const { role, adminPrivileges } = useProfile();

  if (!can.seeLogs(role, adminPrivileges)) return (
    <AuthGate>
      <Nav showSidebars={false} />
      <DashboardLayout
        left={<UnitsPanel />}
        center={<div className="card p-6">Brak uprawnień.</div>}
        right={<AccountPanel />}
      />
    </AuthGate>
  );

  return (
    <AuthGate>
      <Head><title>LSPD 77RP — Logi</title></Head>
      <Nav showSidebars={false} />
      <DashboardLayout
        left={<UnitsPanel />}
        center={(
          <div className="card p-6">
            <h1 className="text-2xl font-semibold mb-3">Logi aktywności</h1>
            <p className="text-sm text-beige-700">
              Logi zostały przeniesione do Panelu zarządu. Przejdź do zakładki <b>Logi</b> w panelu dowódczym (Staff Commander i
              wyżej), aby zobaczyć szczegółowe zestawienie zdarzeń.
            </p>
          </div>
        )}
        right={<AccountPanel />}
      />
    </AuthGate>
  );
}
