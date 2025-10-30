import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
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

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Dashboard</title>
        </Head>

        <Nav />

        <div className="min-h-screen px-4 py-8 max-w-6xl mx-auto grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="section-shell section-shell--docs">
            <div className="section-shell__inner p-6 md:p-8 space-y-6">
              <div className="space-y-2">
                <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.4em] text-sky-200/80">
                  📄 Dokumenty służbowe
                </span>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-sky-200 via-white to-sky-400 bg-clip-text text-transparent">
                  Wybierz dokument
                </h1>
                <p className="text-sm text-sky-100/70 max-w-2xl">
                  Przeglądaj szablony dokumentów, korzystaj z wyszukiwarki lub odkrywaj nowe formularze przygotowane dla funkcjonariuszy.
                </p>
              </div>

              <input
                className="input mb-2 bg-black/40 border-sky-300/30 focus:border-sky-200/60"
                placeholder="Szukaj dokumentu po nazwie lub słowie kluczowym..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((t) => (
                  <Link
                    key={t.slug}
                    href={`/doc/${t.slug}`}
                    className="group relative overflow-hidden rounded-2xl border border-sky-200/20 bg-gradient-to-br from-black/30 via-slate-900/40 to-slate-900/20 p-5 shadow-lg transition-all duration-300 hover:border-sky-200/60 hover:shadow-2xl"
                  >
                    <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: "radial-gradient(circle at 20% -10%, rgba(94, 234, 212, 0.35), transparent 45%)" }} />
                    <div className="relative space-y-2">
                      <h2 className="text-lg font-semibold text-sky-50 flex items-center gap-2">
                        <span className="text-xl">🗂️</span> {t.name}
                      </h2>
                      {t.description && (
                        <p className="text-sm text-sky-100/70 leading-relaxed">{t.description}</p>
                      )}
                      <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sky-200/80">
                        Otwórz formularz →
                      </span>
                    </div>
                  </Link>
                ))}
                {filtered.length === 0 && (
                  <div className="col-span-full rounded-2xl border border-sky-200/20 bg-black/30 p-6 text-center text-sm text-sky-100/70">
                    Brak wyników. Spróbuj innego zapytania lub skrótu nazwy dokumentu.
                  </div>
                )}
              </div>
            </div>
          </div>
          <AnnouncementSpotlight />
        </div>
      </>
    </AuthGate>
  );
}
