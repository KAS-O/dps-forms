import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import CriminalGroupsSection from "@/components/CriminalGroupsSection";

export default function CriminalGroupsPage() {
  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Grupy przestępcze</title>
        </Head>
        <Nav />
        <div className="max-w-6xl mx-auto px-4 py-6">
          <CriminalGroupsSection variant="page" allowCreate />
        </div>
      </>
    </AuthGate>
  );
}
