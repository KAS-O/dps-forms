import Head from "next/head";
import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { UnitsPanel } from "@/components/UnitsPanel";
import { AccountPanel } from "@/components/AccountPanel";
import { DocumentsContent } from "@/components/documents/DocumentsContent";

export default function Dashboard() {
  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Dashboard</title>
        </Head>

        <Nav showSidebars={false} />

        <DashboardLayout
          left={<UnitsPanel />}
          center={<DocumentsContent />}
          right={<AccountPanel />}
        />
      </>
    </AuthGate>
  );
}
