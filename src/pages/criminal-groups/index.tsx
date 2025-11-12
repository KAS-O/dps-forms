import { useEffect } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";

export default function CriminalGroupsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/units/gu");
  }, [router]);

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Grupy przestępcze</title>
        </Head>
        <Nav />
        <div className="max-w-3xl mx-auto px-4 py-8">
          <div className="card p-6 space-y-4" data-section="criminal-groups">
            <h1 className="text-2xl font-semibold tracking-tight">Grupy przestępcze przeniesiono</h1>
            <p className="text-sm text-beige-100/80">
              Rejestr organizacji został zintegrowany z panelami jednostek Gang Unit oraz Detective Task Unit. Aby
              zarządzać grupami przestępczymi, skorzystaj z odpowiedniego panelu jednostki.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/units/gu" className="btn">
                Przejdź do GU
              </Link>
              <Link href="/units/dtu" className="btn btn--ghost">
                Przejdź do DTU
              </Link>
            </div>
          </div>
        </div>
      </>
    </AuthGate>
  );
}
