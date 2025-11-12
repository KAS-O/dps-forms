import Head from "next/head";
import Nav from "@/components/Nav";
import AuthGate from "@/components/AuthGate";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import {
  DEPARTMENTS,
  UNITS,
  ADDITIONAL_RANKS_BY_UNIT,
} from "@/lib/hr";

const CHAIN_TIERS: {
  title: string;
  description: string;
  roles: Role[];
  colorFrom: string;
  colorTo: string;
  accent: string;
}[] = [
  {
    title: "Administracja systemowa",
    description: "Zarządzanie panelem oraz zapleczem technicznym.",
    roles: ["admin"],
    colorFrom: "#6b21a8",
    colorTo: "#1f2937",
    accent: "#c084fc",
  },
  {
    title: "Dyrekcja Departamentu",
    description: "Najwyższe kierownictwo DPS odpowiedzialne za strategię i wizję.",
    roles: ["director"],
    colorFrom: "#312e81",
    colorTo: "#0f172a",
    accent: "#a5b4fc",
  },
  {
    title: "Komenda Główna",
    description: "Dowodzenie całym departamentem i koordynacja poszczególnych komórek.",
    roles: ["chief-of-police", "assistant-chief", "deputy-chief"],
    colorFrom: "#1e3a8a",
    colorTo: "#0b1120",
    accent: "#60a5fa",
  },
  {
    title: "Dowództwo Wykonawcze",
    description: "Sztab nadzorujący codzienne funkcjonowanie oraz procesy operacyjne.",
    roles: ["executive-commander", "staff-commander"],
    colorFrom: "#1d4ed8",
    colorTo: "#0f172a",
    accent: "#38bdf8",
  },
  {
    title: "Dowództwo Jednostek",
    description: "Dowódcy dywizji i biur odpowiadający za strukturę oddziałów.",
    roles: ["captain-iii", "captain-ii", "captain-i"],
    colorFrom: "#4338ca",
    colorTo: "#111827",
    accent: "#a855f7",
  },
  {
    title: "Dowództwo Liniowe",
    description: "Bezpośredni przełożeni dowodzący sekcjami i zmianami służbowymi.",
    roles: ["lieutenant-ii", "lieutenant-i", "sergeant-iii", "sergeant-ii", "sergeant-i"],
    colorFrom: "#4c1d95",
    colorTo: "#0f172a",
    accent: "#8b5cf6",
  },
  {
    title: "Służba Patrolowa",
    description: "Oficerowie oraz aplikanci pełniący służbę liniową.",
    roles: ["officer-iii-plus-i", "officer-iii", "officer-ii", "officer-i", "solo-cadet", "cadet"],
    colorFrom: "#0f766e",
    colorTo: "#022c22",
    accent: "#34d399",
  },
  {
    title: "Oddział Federalny",
    description: "Specjalistyczna ścieżka funkcjonariuszy FIB pracujących w ramach DPS.",
    roles: ["fib"],
    colorFrom: "#111827",
    colorTo: "#1e1b4b",
    accent: "#818cf8",
  },
];

const gradientCardStyle = (from: string, to: string) => ({
  background: `linear-gradient(135deg, ${from}, ${to})`,
  borderColor: "rgba(226, 232, 240, 0.2)",
  boxShadow: "0 32px 80px -40px rgba(15, 23, 42, 0.95)",
});

const roleChipClass =
  "inline-flex items-center rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-50 shadow-sm";

export default function ChainOfCommandPage() {
  return (
    <AuthGate>
      <Head>
        <title>LSPD 77RP — Chain of Command</title>
      </Head>
      <Nav />
      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid gap-8">
          <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-6 text-white shadow-2xl">
            <h1 className="text-3xl font-semibold">Chain of Command</h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-200/80">
              Struktura dowodzenia przedstawia pełną hierarchię Departamentu Policyjnego Stanu San Andreas wraz z podziałem
              na stopnie, departamenty i jednostki specjalne. Wykorzystaj to drzewko, aby szybko ustalić przełożonych,
              odpowiedzialne komórki oraz ścieżki awansu.
            </p>
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-900/80 p-6 text-slate-100 shadow-xl">
            <header className="mb-6">
              <h2 className="text-2xl font-semibold text-white">Hierarchia stopni</h2>
              <p className="mt-1 text-sm text-slate-300/80">
                Zestawienie stopni służbowych od najwyższych szczebli zarządzających po funkcjonariuszy linii frontu.
              </p>
            </header>
            <div className="relative">
              {CHAIN_TIERS.map((tier, index) => {
                const isLast = index === CHAIN_TIERS.length - 1;
                return (
                  <div
                    key={tier.title}
                    className={`relative pl-12 ${isLast ? "pb-0" : "pb-10"}`}
                  >
                    <span
                      className="absolute left-4 top-4 h-4 w-4 -translate-x-1/2 rounded-full border-2 border-white/70 shadow-lg"
                      style={{ background: tier.accent }}
                    />
                    {!isLast && (
                      <span
                        className="pointer-events-none absolute left-4 top-8 w-px"
                        style={{
                          height: "calc(100% - 0.5rem)",
                          background: `linear-gradient(180deg, ${tier.accent} 0%, rgba(129, 140, 248, 0.1) 90%)`,
                          opacity: 0.8,
                        }}
                      />
                    )}
                    <div
                      className="rounded-3xl border px-5 py-6 text-white transition"
                      style={gradientCardStyle(tier.colorFrom, tier.colorTo)}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <h3 className="text-xl font-semibold tracking-wide">{tier.title}</h3>
                          <p className="mt-2 max-w-2xl text-sm text-slate-100/75">{tier.description}</p>
                        </div>
                        <span className="inline-flex items-center rounded-full border border-white/40 bg-black/30 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide">
                          {tier.roles.length === 1 ? "1 stopień" : `${tier.roles.length} stopnie`}
                        </span>
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {tier.roles.map((role) => (
                          <span key={role} className={roleChipClass}>
                            {ROLE_LABELS[role] || role}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-900/80 p-6 text-slate-100 shadow-xl">
            <header className="mb-6">
              <h2 className="text-2xl font-semibold text-white">Departamenty</h2>
              <p className="mt-1 text-sm text-slate-300/80">
                Główne piony DPS, do których przypisywani są funkcjonariusze w zależności od charakteru służby.
              </p>
            </header>
            <div className="grid gap-4 md:grid-cols-3">
              {DEPARTMENTS.map((dept) => (
                <div
                  key={dept.id}
                  className="rounded-3xl border px-5 py-5 text-white shadow-lg"
                  style={gradientCardStyle(dept.colorFrom, dept.colorTo)}
                >
                  <h3 className="text-lg font-semibold uppercase tracking-wide">{dept.label}</h3>
                  <p className="mt-1 text-sm text-white/80">{dept.fullLabel}</p>
                  <p className="mt-3 text-xs text-white/70">{dept.description}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-slate-900/80 p-6 text-slate-100 shadow-xl">
            <header className="mb-6">
              <h2 className="text-2xl font-semibold text-white">Jednostki specjalne i stopnie dodatkowe</h2>
              <p className="mt-1 text-sm text-slate-300/80">
                Jednostki wewnętrzne DPS wraz z kolorystycznie wyróżnionymi dodatkowymi stopniami służbowymi.
              </p>
            </header>
            <div className="grid gap-4 md:grid-cols-2">
              {UNITS.map((unit) => {
                const ranks = ADDITIONAL_RANKS_BY_UNIT[unit.id] || [];
                return (
                  <div
                    key={unit.id}
                    className="rounded-3xl border px-5 py-5 text-white shadow-lg"
                    style={gradientCardStyle(unit.colorFrom, unit.colorTo)}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold uppercase tracking-wide">{unit.label}</h3>
                        <p className="mt-2 text-sm text-white/80">{unit.description}</p>
                      </div>
                      <span className="inline-flex items-center rounded-full border border-white/40 bg-black/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide">
                        {ranks.length ? `${ranks.length} stopnie` : "Brak dodatkowych stopni"}
                      </span>
                    </div>
                    {ranks.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {ranks.map((rank) => (
                          <span key={rank.id} className={roleChipClass}>
                            {rank.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </main>
    </AuthGate>
  );
}
