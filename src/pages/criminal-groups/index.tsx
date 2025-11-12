import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import Link from "next/link";

export default function CriminalGroupsPage() {
  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Grupy przestępcze</title>
        </Head>
        <Nav />
        <div className="mx-auto max-w-4xl px-4 py-12">
          <div className="card space-y-5 p-6" data-section="criminal-groups">
            <span className="section-chip">
              <span className="section-chip__dot" style={{ background: "#ec4899" }} aria-hidden />
              Grupy przestępcze
            </span>
            <div className="space-y-3">
              <h1 className="text-3xl font-bold tracking-tight text-white">Panel został przeniesiony</h1>
              <p className="text-sm text-white/70">
                Rejestr grup przestępczych jest teraz dostępny bezpośrednio w panelach jednostek specjalistycznych. Aby
                kontynuować pracę nad materiałami operacyjnymi, przejdź do sekcji Gang Unit lub Detective Task Unit.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/units/gu" className="btn btn--primary btn--small">
                  Otwórz panel GU
                </Link>
                <Link href="/units/dtu" className="btn btn--primary btn--small">
                  Otwórz panel DTU
                </Link>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60">
              Jeśli posiadasz uprawnienia do zarządzania jednostką, w zakładce <em>Grupy przestępcze</em> znajdziesz pełen
              zestaw narzędzi do tworzenia i aktualizacji wpisów, wspólny dla obu sekcji.
            </div>
          </div>
        </div>
      </>
    </AuthGate>
  );
}
