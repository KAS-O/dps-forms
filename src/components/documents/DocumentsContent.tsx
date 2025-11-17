import Link from "next/link";
import { useMemo, useState } from "react";
import { TEMPLATES } from "@/lib/templates";

const accentPalette = ["#60a5fa", "#34d399", "#f472b6", "#facc15", "#f97316", "#818cf8"];

export function DocumentsContent() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    return TEMPLATES.filter((template) =>
      template.name.toLowerCase().includes(query.toLowerCase()) || template.slug.includes(query.toLowerCase())
    );
  }, [query]);

  return (
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
              Zebraliśmy wszystkie wzory raportów i formularzy w jednym miejscu. Skorzystaj z wyszukiwarki, aby szybciej
              odnaleźć potrzebny dokument.
            </p>
          </div>
        </div>

        <input
          className="input w-full text-base sm:text-lg"
          placeholder="Szukaj dokumentu po nazwie lub słowach kluczowych..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="flex-1 overflow-y-auto pr-1">
          <div className="module-grid pb-2">
            {filtered.map((template, index) => {
              const accent = accentPalette[index % accentPalette.length];
              return (
                <Link
                  key={template.slug}
                  href={`/doc/${template.slug}`}
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
                      <span className="text-lg sm:text-xl" aria-hidden>
                        📄
                      </span>
                      {template.name}
                    </h2>
                    {template.description ? (
                      <p className="text-sm text-beige-100/80 sm:text-base">{template.description}</p>
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
  );
}
