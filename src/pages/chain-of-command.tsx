import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import {
  AUXILIARY_RANK_MAP,
  AUXILIARY_RANKS_BY_UNIT,
  DEPARTMENT_OPTIONS,
  INTERNAL_UNIT_OPTIONS,
  type AuxiliaryRankValue,
  type BadgeTheme,
  type InternalUnitValue,
} from "@/lib/personnel";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import { CSSProperties } from "react";

const badgeBaseClass =
  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide shadow-sm";
const badgeDotClass = "h-2.5 w-2.5 flex-shrink-0 rounded-full shadow";

const createBadgeStyle = (theme: BadgeTheme): CSSProperties => ({
  background: theme.background,
  color: theme.color,
  borderColor: theme.border,
  boxShadow: `0 18px 32px -22px ${theme.shadow}`,
});

const createBadgeDotStyle = (theme: BadgeTheme): CSSProperties => ({
  background: theme.background,
  boxShadow: "0 0 0 2px rgba(255, 255, 255, 0.25)",
});

const makeTheme = (background: string, color: string, border: string, shadow: string): BadgeTheme => ({
  background,
  color,
  border,
  shadow,
});

const COMMAND_THEME = makeTheme(
  "linear-gradient(135deg, #facc15, #f97316)",
  "#1f2937",
  "rgba(250, 204, 21, 0.7)",
  "rgba(249, 115, 22, 0.55)"
);

const EXECUTIVE_THEME = makeTheme(
  "linear-gradient(135deg, #c084fc, #7c3aed)",
  "#f5f3ff",
  "rgba(192, 132, 252, 0.6)",
  "rgba(124, 58, 237, 0.55)"
);

const SUPERVISOR_THEME = makeTheme(
  "linear-gradient(135deg, #38bdf8, #1e40af)",
  "#e0f2fe",
  "rgba(56, 189, 248, 0.55)",
  "rgba(30, 64, 175, 0.55)"
);

const FIELD_THEME = makeTheme(
  "linear-gradient(135deg, #1f2937, #0f172a)",
  "#e2e8f0",
  "rgba(148, 163, 184, 0.45)",
  "rgba(15, 23, 42, 0.55)"
);

const FIB_THEME = makeTheme(
  "linear-gradient(135deg, #1e293b, #6366f1)",
  "#e0e7ff",
  "rgba(99, 102, 241, 0.6)",
  "rgba(79, 70, 229, 0.55)"
);

const ROLE_THEME_MAP: Partial<Record<Role, BadgeTheme>> = {
  "chief-of-police": COMMAND_THEME,
  "assistant-chief": COMMAND_THEME,
  "deputy-chief": COMMAND_THEME,
  "executive-commander": EXECUTIVE_THEME,
  "staff-commander": EXECUTIVE_THEME,
  "captain-iii": SUPERVISOR_THEME,
  "captain-ii": SUPERVISOR_THEME,
  "captain-i": SUPERVISOR_THEME,
  "lieutenant-ii": FIELD_THEME,
  "lieutenant-i": FIELD_THEME,
  "sergeant-iii": FIELD_THEME,
  "sergeant-ii": FIELD_THEME,
  "sergeant-i": FIELD_THEME,
  "officer-iii-plus-i": makeTheme(
    "linear-gradient(135deg, #334155, #1e293b)",
    "#e2e8f0",
    "rgba(100, 116, 139, 0.45)",
    "rgba(30, 41, 59, 0.5)"
  ),
  "officer-iii": makeTheme(
    "linear-gradient(135deg, #334155, #1e293b)",
    "#e2e8f0",
    "rgba(100, 116, 139, 0.45)",
    "rgba(30, 41, 59, 0.5)"
  ),
  "officer-ii": makeTheme(
    "linear-gradient(135deg, #334155, #1e293b)",
    "#e2e8f0",
    "rgba(100, 116, 139, 0.45)",
    "rgba(30, 41, 59, 0.5)"
  ),
  "officer-i": makeTheme(
    "linear-gradient(135deg, #334155, #1e293b)",
    "#e2e8f0",
    "rgba(100, 116, 139, 0.45)",
    "rgba(30, 41, 59, 0.5)"
  ),
  "solo-cadet": makeTheme(
    "linear-gradient(135deg, #475569, #1f2937)",
    "#f8fafc",
    "rgba(148, 163, 184, 0.45)",
    "rgba(15, 23, 42, 0.45)"
  ),
  "cadet": makeTheme(
    "linear-gradient(135deg, #475569, #1f2937)",
    "#f8fafc",
    "rgba(148, 163, 184, 0.45)",
    "rgba(15, 23, 42, 0.45)"
  ),
  fib: FIB_THEME,
};

const getRoleTheme = (role: Role): BadgeTheme =>
  ROLE_THEME_MAP[role] || makeTheme("linear-gradient(135deg, #2563eb, #1e3a8a)", "#e2e8f0", "rgba(59, 130, 246, 0.55)", "rgba(30, 64, 175, 0.5)");

type ChainNode = {
  id: string;
  label: string;
  description?: string;
  theme?: BadgeTheme;
  roles?: Role[];
  units?: InternalUnitValue[];
  auxiliaryRanks?: AuxiliaryRankValue[];
  children?: ChainNode[];
};

const STRUCTURE: ChainNode[] = [
  {
    id: "hq",
    label: "Dowództwo główne",
    description: "Najwyższy szczebel dowodzenia odpowiedzialny za kierunek strategiczny DPS.",
    theme: COMMAND_THEME,
    roles: ["chief-of-police", "assistant-chief", "deputy-chief"],
    children: [
      {
        id: "executive",
        label: "Komenda wykonawcza",
        description: "Koordynacja działań i polityki służby.",
        theme: EXECUTIVE_THEME,
        roles: ["executive-commander", "staff-commander"],
      },
      {
        id: "captains",
        label: "Dowódcy wydziałów",
        description: "Zarządzanie wydziałami operacyjnymi i wsparcia.",
        theme: SUPERVISOR_THEME,
        roles: ["captain-iii", "captain-ii", "captain-i"],
        children: [
          {
            id: "lieutenants",
            label: "Sekcje i dywizje",
            description: "Nadzór nad poszczególnymi sekcjami i zmianami.",
            theme: FIELD_THEME,
            roles: ["lieutenant-ii", "lieutenant-i"],
            children: [
              {
                id: "sergeants",
                label: "Przełożeni terenowi",
                description: "Bezpośredni nadzór nad funkcjonariuszami w służbie.",
                theme: makeTheme(
                  "linear-gradient(135deg, #fb923c, #f97316)",
                  "#1f2937",
                  "rgba(251, 146, 60, 0.6)",
                  "rgba(249, 115, 22, 0.55)"
                ),
                roles: ["sergeant-iii", "sergeant-ii", "sergeant-i"],
                children: [
                  {
                    id: "officers",
                    label: "Oficerowie liniowi",
                    description: "Podstawowy skład wykonujący zadania patrolowe i reagowanie na zdarzenia.",
                    theme: makeTheme(
                      "linear-gradient(135deg, #1f2937, #111827)",
                      "#e5e7eb",
                      "rgba(59, 130, 246, 0.35)",
                      "rgba(30, 41, 59, 0.45)"
                    ),
                    roles: [
                      "officer-iii-plus-i",
                      "officer-iii",
                      "officer-ii",
                      "officer-i",
                      "solo-cadet",
                      "cadet",
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "departments",
    label: "Departamenty terenowe",
    description: "Komórki operacyjne odpowiadające za realizację zadań na obszarze miasta i hrabstw.",
    children: DEPARTMENT_OPTIONS.map((dept) => ({
      id: `dept-${dept.value}`,
      label: dept.label,
      description: dept.description,
      theme: dept.theme,
      roles: [
        "captain-iii",
        "captain-ii",
        "captain-i",
        "lieutenant-ii",
        "lieutenant-i",
        "sergeant-iii",
        "sergeant-ii",
        "sergeant-i",
        "officer-iii-plus-i",
        "officer-iii",
        "officer-ii",
        "officer-i",
        "solo-cadet",
        "cadet",
      ],
    })),
  },
  {
    id: "special",
    label: "Jednostki specjalistyczne",
    description: "Wyspecjalizowane komórki taktyczne i śledcze wspierające wszystkie departamenty.",
    children: INTERNAL_UNIT_OPTIONS.map((unit) => ({
      id: `unit-${unit.value}`,
      label: unit.label,
      description: unit.description,
      theme: unit.theme,
      auxiliaryRanks: (AUXILIARY_RANKS_BY_UNIT[unit.value] || []).map((rank) => rank.value),
    })),
  },
  {
    id: "fib",
    label: "FIB",
    description: "Federal Investigation Bureau — równoległa linia dowodzenia współpracująca z DPS.",
    theme: FIB_THEME,
    roles: ["fib"],
  },
];

type ChainNodeCardProps = {
  node: ChainNode;
  depth?: number;
};

function ChainNodeCard({ node, depth = 0 }: ChainNodeCardProps) {
  return (
    <div className={`relative ${depth > 0 ? "pl-6" : ""}`}>
      {depth > 0 && (
        <span className="absolute left-3 top-0 bottom-0 border-l border-white/10" aria-hidden />
      )}
      <div className={`relative card p-5 ${depth > 0 ? "ml-3" : ""}`}>
        {depth > 0 && (
          <span className="absolute -left-6 top-6 w-6 border-t border-white/10" aria-hidden />
        )}
        <div className="flex flex-wrap items-center gap-3">
          {node.theme ? (
            <span className="inline-flex items-center gap-2 rounded-full border px-4 py-1 text-sm font-semibold tracking-wide" style={createBadgeStyle(node.theme)}>
              <span className="h-2.5 w-2.5 rounded-full" style={createBadgeDotStyle(node.theme)} aria-hidden />
              {node.label}
            </span>
          ) : (
            <h3 className="text-lg font-semibold">{node.label}</h3>
          )}
        </div>
        {node.theme && node.description && (
          <p className="mt-2 text-sm text-white/70">{node.description}</p>
        )}
        {!node.theme && node.description && (
          <p className="mt-2 text-sm text-white/70">{node.description}</p>
        )}
        {node.roles && node.roles.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {node.roles.map((role) => {
              const theme = getRoleTheme(role);
              return (
                <span key={role} className={badgeBaseClass} style={createBadgeStyle(theme)}>
                  <span className={badgeDotClass} style={createBadgeDotStyle(theme)} aria-hidden />
                  {ROLE_LABELS[role] || role}
                </span>
              );
            })}
          </div>
        )}
        {node.units && node.units.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {node.units.map((unit) => {
              const option = INTERNAL_UNIT_OPTIONS.find((opt) => opt.value === unit);
              if (!option) return null;
              return (
                <span
                  key={unit}
                  className={badgeBaseClass}
                  style={createBadgeStyle(option.theme)}
                  title={option.description}
                >
                  <span className={badgeDotClass} style={createBadgeDotStyle(option.theme)} aria-hidden />
                  {option.label}
                </span>
              );
            })}
          </div>
        )}
        {node.auxiliaryRanks && node.auxiliaryRanks.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {node.auxiliaryRanks.map((rank) => {
              const option = AUXILIARY_RANK_MAP.get(rank);
              if (!option) return null;
              const unit = INTERNAL_UNIT_OPTIONS.find((u) => u.value === option.unit);
              return (
                <span
                  key={rank}
                  className={badgeBaseClass}
                  style={createBadgeStyle(option.theme)}
                  title={unit ? `Jednostka: ${unit.label}` : undefined}
                >
                  <span className={badgeDotClass} style={createBadgeDotStyle(option.theme)} aria-hidden />
                  {option.label}
                </span>
              );
            })}
          </div>
        )}
        {node.children && node.children.length > 0 && (
          <div className="mt-4 space-y-4">
            {node.children.map((child) => (
              <ChainNodeCard key={child.id} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChainOfCommandPage() {
  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Chain of Command</title>
        </Head>
        <Nav />
        <div className="min-h-screen px-4 py-8 max-w-6xl mx-auto space-y-6">
          <div className="card p-6 space-y-3" data-section="documents">
            <span className="text-sm uppercase tracking-wide text-beige-500">Struktura dowodzenia</span>
            <h1 className="text-3xl font-bold tracking-tight">Chain of Command</h1>
            <p className="text-sm text-white/70">
              Graficzne przedstawienie struktury dowodzenia DPS oraz wyspecjalizowanych jednostek wspierających.
              Skorzystaj z drzewa, aby szybko zlokalizować odpowiedzialne osoby i ścieżkę raportowania.
            </p>
          </div>

          <div className="grid gap-5">
            {STRUCTURE.map((node) => (
              <ChainNodeCard key={node.id} node={node} />
            ))}
          </div>
        </div>
      </>
    </AuthGate>
  );
}
