import AuthGate from "@/components/AuthGate";
import PanelLayout from "@/components/PanelLayout";
import Head from "next/head";
import { TEMPLATES } from "@/lib/templates";
import Link from "next/link";
import { useMemo, useState } from "react";
import AnnouncementSpotlight from "@/components/AnnouncementSpotlight";

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

        <PanelLayout>
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-6">
            <div className="card p-6 space-y-5" data-section="documents">
              <div className="space-y-3">
                <span className="section-chip">
                  <span className="section-chip__dot" style={{ background: "#60a5fa" }} />
                  Dokumenty
                </span>
                <div>
                  <h1 className="text-3xl font-bold tracking-tight">Wybierz dokument służbowy</h1>
                  <p className="text-sm text-beige-100/80 mt-1">
                    Zebraliśmy wszystkie wzory raportów i formularzy w jednym miejscu. Skorzystaj z wyszukiwarki,
                    aby szybciej odnaleźć potrzebny dokument.
                  </p>
                </div>
              </div>

              <input
                className="input"
                placeholder="Szukaj dokumentu po nazwie lub słowach kluczowych..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />

              <div className="grid gap-4 md:grid-cols-2">
                {filtered.map((t, index) => {
                  const accent = accentPalette[index % accentPalette.length];
                  return (
                    <Link
                      key={t.slug}
                      href={`/doc/${t.slug}`}
                      className="card p-5 transition hover:-translate-y-1"
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
                        <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
                          <span className="text-xl" aria-hidden>📄</span>
                          {t.name}
                        </h2>
                        {t.description ? (
                          <p className="text-sm text-beige-100/80">{t.description}</p>
                        ) : (
                          <p className="text-sm text-beige-100/60">Kliknij, aby otworzyć szablon dokumentu.</p>
                        )}
                      </div>
                    </Link>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="card p-5 text-sm text-beige-100/70" data-section="documents">
                    Nie znaleziono dokumentu pasującego do wyszukiwania.
                  </div>
                )}
              </div>
            </div>
            </div>
            <AnnouncementSpotlight />
          </div>
        </PanelLayout>
      </>
    </AuthGate>
  );
}
