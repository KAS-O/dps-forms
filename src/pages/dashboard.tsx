import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { TEMPLATES } from "@/lib/templates";
import Link from "next/link";
import { useMemo, useState } from "react";
import AnnouncementSpotlight from "@/components/AnnouncementSpotlight";

const QUICK_LINKS = [
  {
    href: "/dossiers",
    label: "Teczki",
    description: "Akta osobowe i grupowe",
    icon: "📂",
    border: "rgba(236, 72, 153, 0.45)",
    background: "linear-gradient(135deg, rgba(236,72,153,0.25), rgba(79,70,229,0.15))",
  },
  {
    href: "/vehicle-archive",
    label: "Archiwum pojazdów",
    description: "Historia rejestracji i właścicieli",
    icon: "🚓",
    border: "rgba(14, 165, 233, 0.45)",
    background: "linear-gradient(135deg, rgba(14,165,233,0.2), rgba(59,130,246,0.15))",
  },
  {
    href: "/chain-of-command",
    label: "Chain of Command",
    description: "Aktualna struktura dowodzenia",
    icon: "🧭",
    border: "rgba(251, 191, 36, 0.45)",
    background: "linear-gradient(135deg, rgba(251,191,36,0.2), rgba(251,146,60,0.15))",
  },
];

const TOTAL_TEMPLATES = TEMPLATES.length;

export default function Dashboard() {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return TEMPLATES.filter(t =>
      t.name.toLowerCase().includes(q.toLowerCase()) ||
      t.slug.includes(q.toLowerCase())
    );
  }, [q]);

  const accentPalette = ["#60a5fa", "#34d399", "#f472b6", "#facc15", "#f97316", "#818cf8"];

  const heroHighlights = [
    { label: "Szablony w systemie", value: TOTAL_TEMPLATES.toString() },
    { label: "Widoczne po filtrze", value: filtered.length.toString() },
    { label: "Aktywny filtr", value: q ? q : "Brak" },
  ];

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Dashboard</title>
        </Head>

        <Nav />

        <main className="layout-shell layout-shell--wide">
          <div className="dashboard-grid">
            <section className="card dashboard-hero" data-section="documents">
              <div className="dashboard-hero__content">
                <span className="section-chip">
                  <span className="section-chip__dot" style={{ background: "#60a5fa" }} />
                  Panel operacyjny
                </span>
                <div>
                  <h1 className="text-3xl font-bold tracking-tight">Wybierz dokument służbowy</h1>
                  <p className="text-sm text-beige-100/80 mt-1">
                    Zebraliśmy wszystkie wzory raportów i formularzy w jednym miejscu. Interfejs sam dopasowuje się do
                    rozmiaru ekranu, dzięki czemu widzisz komplet danych bez ręcznego oddalania widoku.
                  </p>
                </div>
                <div className="dashboard-hero__actions">
                  {QUICK_LINKS.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="dashboard-quick-link"
                      style={{
                        borderColor: link.border,
                        background: link.background,
                      }}
                    >
                      <span className="dashboard-quick-link__icon" aria-hidden>
                        {link.icon}
                      </span>
                      <div className="flex flex-col text-sm">
                        <span className="font-semibold text-base text-white/90">{link.label}</span>
                        <span className="text-white/70">{link.description}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
              <div className="dashboard-hero__search">
                <label className="label" htmlFor="documents-search">
                  Wyszukaj formularz
                </label>
                <input
                  id="documents-search"
                  className="input"
                  placeholder="Szukaj dokumentu po nazwie lub słowach kluczowych..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
                <p className="text-xs text-beige-100/70">
                  Wyniki odświeżają się automatycznie wraz z wpisywaniem zapytania.
                </p>
                <ul className="dashboard-hero__stats">
                  {heroHighlights.map((stat) => (
                    <li key={stat.label}>
                      <span>{stat.label}</span>
                      <strong>{stat.value}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
            <div className="dashboard-aside-stack">
              <AnnouncementSpotlight />
              <div className="card p-5 space-y-3">
                <h3 className="text-lg font-semibold tracking-tight">Elastyczny układ</h3>
                <p className="text-sm text-beige-100/80">
                  Układ panelu automatycznie dobiera skalę i rozmieszczenie elementów. Po zalogowaniu lub automatycznym
                  wylogowaniu strona odświeża się sama, dzięki czemu natychmiast widzisz aktualny zestaw funkcji.
                </p>
                <ul className="text-sm text-beige-100/80 space-y-1 list-disc list-inside">
                  <li>Skalowanie interfejsu dopasowane do szerokości okna.</li>
                  <li>Odsunięte moduły poprawiają czytelność na monitorach HD i 4K.</li>
                  <li>Przyciski i karty grupują się w responsyjną siatkę.</li>
                </ul>
              </div>
            </div>
          </div>

          <section className="card dashboard-docs-panel" data-section="documents">
            <div className="dashboard-docs-panel__header">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-white/60">Wszystkie wzory</p>
                <h2 className="text-2xl font-semibold tracking-tight">Dokumenty i raporty</h2>
                <p className="text-sm text-beige-100/70">
                  Wyniki: {filtered.length} / {TOTAL_TEMPLATES}
                </p>
              </div>
            </div>
            <div className="dashboard-docs-grid">
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
                        <span className="text-xl" aria-hidden>
                          📄
                        </span>
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
          </section>
        </main>
      </>
    </AuthGate>
  );
}
