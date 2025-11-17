import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { TEMPLATES } from "@/lib/templates";
import Link from "next/link";
import { useMemo, useState } from "react";
import AnnouncementSpotlight from "@/components/AnnouncementSpotlight";
import UnitSidebar from "@/components/UnitSidebar";

export default function Dashboard() {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return TEMPLATES.filter(t =>
      t.name.toLowerCase().includes(q.toLowerCase()) ||
      t.slug.includes(q.toLowerCase())
    );
  }, [q]);

  const accentPalette = ["#60a5fa", "#34d399", "#f472b6", "#facc15", "#f97316", "#818cf8"];

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Dashboard</title>
        </Head>

        <Nav showSidebars={false} />

        <main className="layout-shell layout-shell--wide">
          <div className="mx-auto grid w-full max-w-screen-2xl grid-cols-1 gap-6 px-4 pb-8 pt-4 sm:px-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1.5fr)_minmax(0,360px)] lg:items-start lg:px-8 lg:pt-6">
            <UnitSidebar
              variant="inline"
              showProfilePanel={false}
              leftClassName="lg:w-full lg:min-w-0"
            />

            <div className="flex min-h-[calc(100vh-200px)] min-w-0 flex-col gap-5 overflow-hidden lg:gap-6">
              <div className="card flex min-h-0 flex-col gap-4 overflow-hidden p-4 md:p-5 lg:p-6" data-section="documents">
                <div className="space-y-3">
                  <span className="section-chip text-xs sm:text-sm">
                    <span className="section-chip__dot" style={{ background: "#60a5fa" }} />
                    Dokumenty
                  </span>
                  <div className="space-y-2">
                    <h1 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">Wybierz dokument służbowy</h1>
                    <p className="text-sm text-beige-100/80 sm:text-base lg:text-lg">
                      Zebraliśmy wszystkie wzory raportów i formularzy w jednym miejscu. Skorzystaj z wyszukiwarki,
                      aby szybciej odnaleźć potrzebny dokument.
                    </p>
                  </div>
                </div>

                <input
                  className="input w-full text-base sm:text-lg"
                  placeholder="Szukaj dokumentu po nazwie lub słowach kluczowych..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />

                <div className="flex-1 overflow-y-auto pr-1">
                  <div className="module-grid pb-2">
                    {filtered.map((t, index) => {
                      const accent = accentPalette[index % accentPalette.length];
                      return (
                        <Link
                          key={t.slug}
                          href={`/doc/${t.slug}`}
                          className="card p-4 transition hover:-translate-y-1 md:p-5"
                          data-section="documents"
                          style={{
                            borderColor: `${accent}80`,
                            boxShadow: `0 28px 60px -26px ${accent}aa`,
                          }}
                        >
                          <span
                            className="absolute inset-0 opacity-50 animate-shimmer"
                            style={{
                              backgroundImage: `linear-gradient(120deg, transparent 0%, ${accent}26 45%, transparent 90%)`,
                            }}
                          />
                          <div className="relative flex flex-col gap-2">
                            <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
                              <span className="text-lg sm:text-xl" aria-hidden>📄</span>
                              {t.name}
                            </h2>
                            {t.description ? (
                              <p className="text-sm text-beige-100/80 sm:text-base">{t.description}</p>
                            ) : (
                              <p className="text-sm text-beige-100/60 sm:text-base">Kliknij, aby otworzyć szablon dokumentu.</p>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                    {filtered.length === 0 && (
                      <div className="card p-4 text-sm text-beige-100/70 md:p-5" data-section="documents">
                        Nie znaleziono dokumentu pasującego do wyszukiwania.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="hidden min-h-0 min-w-0 flex-col gap-4 lg:flex">
              <UnitSidebar
                variant="inline"
                showUnitsPanel={false}
                rightClassName="w-full"
              />
              <div className="w-full min-w-0">
                <AnnouncementSpotlight />
              </div>
            </div>
          </div>
        </main>
      </>
    </AuthGate>
  );
}
