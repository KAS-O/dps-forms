import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ROLE_LABELS, ROLE_VALUES, normalizeRole, type Role } from "@/lib/roles";
import {
  DEPARTMENTS,
  INTERNAL_UNITS,
  getDepartmentOption,
  getInternalUnitOption,
  getAdditionalRankOption,
  normalizeDepartment,
  normalizeInternalUnits,
  normalizeAdditionalRanks,
  formatPersonLabel,
  type Department,
  type InternalUnit,
  type AdditionalRank,
} from "@/lib/hr";
import { useProfile } from "@/hooks/useProfile";
import { useSessionActivity } from "@/components/ActivityLogger";

const ROLE_ORDER = new Map<Role, number>(ROLE_VALUES.map((role, index) => [role, index]));

const ROLE_GROUPS: { id: string; title: string; accent: string; roles: Role[] }[] = [
  {
    id: "directors-fib",
    title: "Directors & FIB",
    accent: "#f97316",
    roles: ["director", "fib"],
  },
  {
    id: "command",
    title: "High Command",
    accent: "#fb7185",
    roles: ["chief-of-police", "assistant-chief", "deputy-chief", "executive-commander", "staff-commander"],
  },
  {
    id: "executive",
    title: "Command",
    accent: "#38bdf8",
    roles: ["captain-iii", "captain-ii", "captain-i", "lieutenant-ii", "lieutenant-i"],
  },
  {
    id: "supervisors",
    title: "Supervisors",
    accent: "#22c55e",
    roles: ["sergeant-iii", "sergeant-ii", "sergeant-i"],
  },
  {
    id: "officers",
    title: "Officers",
    accent: "#6366f1",
    roles: ["officer-iii-plus-i", "officer-iii", "officer-ii", "officer-i"],
  },
  {
    id: "trainee",
    title: "Trainee",
    accent: "#f59e0b",
    roles: ["solo-cadet", "cadet"],
  },
];

const CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide";

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace(/[^0-9a-fA-F]/g, "");
  const expand = (value: string) => (value.length === 1 ? value + value : value);
  if (normalized.length === 3) {
    const r = parseInt(expand(normalized[0]), 16);
    const g = parseInt(expand(normalized[1]), 16);
    const b = parseInt(expand(normalized[2]), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (normalized.length === 6) {
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgba(59, 130, 246, ${alpha})`;
}

type ChainMember = {
  uid: string;
  login: string;
  fullName: string;
  role: Role;
  badgeNumber?: string;
  department: Department | null;
  units: InternalUnit[];
  additionalRanks: AdditionalRank[];
  adminPrivileges: boolean;
};

type RoleEntry = { role: Role; members: ChainMember[] };

type RoleGroup = { id: string; title: string; accent: string; roles: RoleEntry[] };

function MemberBadge({ member, highlight }: { member: ChainMember; highlight: boolean }) {
  const departmentOption = getDepartmentOption(member.department);
  const unitOptions = member.units
    .map((unit) => getInternalUnitOption(unit))
    .filter((option): option is NonNullable<ReturnType<typeof getInternalUnitOption>> => !!option);
  const additionalRankOptions = member.additionalRanks
    .map((rank) => getAdditionalRankOption(rank))
    .filter((option): option is NonNullable<ReturnType<typeof getAdditionalRankOption>> => !!option);
  const label = formatPersonLabel(member.fullName, member.login);

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/5 px-3 py-2 transition ${
        highlight ? "ring-2 ring-blue-400/70" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-white/90">
          {label}
          {member.adminPrivileges && (
            <span
              className="ml-2 inline-flex h-4 w-4 items-center justify-center rounded-full border border-yellow-300/60 bg-yellow-400/20 text-[9px] font-semibold text-yellow-300"
              title="Uprawnienia administratora"
              aria-label="Uprawnienia administratora"
            >
              ★
            </span>
          )}
        </span>
        {member.badgeNumber && (
          <span className="text-[11px] font-mono text-white/60">#{member.badgeNumber}</span>
        )}
      </div>
      <div className="text-[11px] text-white/50">{ROLE_LABELS[member.role] || member.role}</div>
      <div className="mt-2 flex flex-wrap gap-1">
        {departmentOption && (
          <span
            className={CHIP_CLASS}
            style={{
              background: departmentOption.background,
              color: departmentOption.color,
              borderColor: departmentOption.borderColor,
            }}
          >
            {departmentOption.abbreviation}
          </span>
        )}
        {unitOptions.map((unit) => (
          <span
            key={unit.value}
            className={CHIP_CLASS}
            style={{
              background: unit.background,
              color: unit.color,
              borderColor: unit.borderColor,
            }}
          >
            {unit.shortLabel || unit.abbreviation}
          </span>
        ))}
        {additionalRankOptions.map((option) => (
          <span
            key={`rank-${option.value}`}
            className={`${CHIP_CLASS} text-[9px]`}
            style={{
              background: option.background,
              color: option.color,
              borderColor: option.borderColor,
            }}
          >
            {option.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ChainOfCommandPage() {
  const [members, setMembers] = useState<ChainMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { login } = useProfile();
  const { logActivity, session } = useSessionActivity();

  useEffect(() => {
    const ref = collection(db, "profiles");
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        const records: ChainMember[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() as any;
          const loginRaw = typeof data?.login === "string" ? data.login.trim() : "";
          const emailLogin =
            typeof data?.email === "string" && data.email.includes("@")
              ? data.email.split("@")[0]
              : "";
          const baseLogin = loginRaw || emailLogin || docSnap.id || "";
          const fullName = typeof data?.fullName === "string" ? data.fullName.trim() : "";
          const role = normalizeRole(data?.role);
          const department = normalizeDepartment(data?.department);
          const units = normalizeInternalUnits(data?.units);
          const additionalRanks = normalizeAdditionalRanks(data?.additionalRanks ?? data?.additionalRank);
          const badge =
            typeof data?.badgeNumber === "string" ? data.badgeNumber.trim() : undefined;

          return {
            uid: docSnap.id,
            login: baseLogin,
            fullName: fullName || baseLogin,
            role,
            badgeNumber: badge,
            department: department ?? null,
            units,
            additionalRanks,
            adminPrivileges: !!data?.adminPrivileges,
          };
        });

        records.sort((a, b) => {
          const orderA = ROLE_ORDER.get(a.role) ?? ROLE_VALUES.length;
          const orderB = ROLE_ORDER.get(b.role) ?? ROLE_VALUES.length;
          if (orderA !== orderB) return orderA - orderB;
          const nameA = formatPersonLabel(a.fullName, a.login).toLowerCase();
          const nameB = formatPersonLabel(b.fullName, b.login).toLowerCase();
          return nameA.localeCompare(nameB, "pl", { sensitivity: "base" });
        });

        setMembers(records);
        setError(null);
        setLoading(false);
      },
      (err) => {
        console.error("Nie udało się pobrać spisu funkcjonariuszy", err);
        setError("Nie udało się wczytać spisu funkcjonariuszy. Spróbuj ponownie później.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    void logActivity({ type: "page_view", path: "/chain-of-command", title: "Chain of Command" });
  }, [logActivity, session]);

  const normalizedLogin = login ? login.toLowerCase() : null;

  const membersByRole = useMemo(() => {
    const map = new Map<Role, ChainMember[]>();
    members.forEach((member) => {
      const list = map.get(member.role) ?? [];
      list.push(member);
      map.set(member.role, list);
    });
    map.forEach((list) => {
      list.sort((a, b) =>
        formatPersonLabel(a.fullName, a.login).localeCompare(formatPersonLabel(b.fullName, b.login), "pl", {
          sensitivity: "base",
        })
      );
    });
    return map;
  }, [members]);

  const roleGroups: RoleGroup[] = useMemo(() => {
    return ROLE_GROUPS.map((group) => ({
      ...group,
      roles: group.roles.map((role) => ({
        role,
        members: membersByRole.get(role) ?? [],
      })),
    }));
  }, [membersByRole]);

  const compareMembers = (a: ChainMember, b: ChainMember) =>
    formatPersonLabel(a.fullName, a.login).localeCompare(formatPersonLabel(b.fullName, b.login), "pl", {
      sensitivity: "base",
    });

  const departmentAssignments = useMemo(
    () =>
      DEPARTMENTS.map((dept) => ({
        option: dept,
        members: members
          .filter((member) => member.department === dept.value)
          .slice()
          .sort(compareMembers),
      })),
    [members]
  );

  const unassignedDepartments = useMemo(
    () => members.filter((member) => !member.department).slice().sort(compareMembers),
    [members]
  );

  const unitAssignments = useMemo(
    () =>
      INTERNAL_UNITS.map((unit) => ({
        option: unit,
        members: members
          .filter((member) => {
            if (member.units.includes(unit.value)) {
              return true;
            }
            return member.additionalRanks.some((rank) => {
              const rankOption = getAdditionalRankOption(rank);
              return rankOption?.unit === unit.value;
            });
          })
          .slice()
          .sort(compareMembers),
      })),
    [members]
  );

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Chain of Command</title>
        </Head>
        <Nav />

        <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
          <div className="card p-6 space-y-6" data-section="chain-of-command">
            <div className="space-y-2">
              <span className="section-chip">
                <span className="section-chip__dot" style={{ background: "#facc15" }} aria-hidden />
                Chain of Command
              </span>
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-white">Spis Funkcjonariuszy</h1>
                <p className="text-sm text-white/70">
                  Aktualny wykaz funkcjonariuszy wraz z przypisaniami departamentów i jednostek specjalistycznych.
                </p>
              </div>
            </div>

            {error && (
              <div className="rounded-2xl border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                {error}
              </div>
            )}

            <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
              <div className="space-y-4">
                {roleGroups.map((group) => (
                  <section
                    key={group.id}
                    className="rounded-3xl border border-white/10 bg-white/5 p-5 shadow-inner"
                    style={{
                      borderColor: withAlpha(group.accent, 0.4),
                      boxShadow: `0 18px 38px -24px ${withAlpha(group.accent, 0.6)}`,
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className={`${CHIP_CLASS} text-[11px]`}
                        style={{
                          background: withAlpha(group.accent, 0.25),
                          color: "#f8fafc",
                          borderColor: withAlpha(group.accent, 0.55),
                        }}
                      >
                        {group.title}
                      </span>
                      <span className="text-xs text-white/60">
                        {group.roles.reduce((acc, entry) => acc + entry.members.length, 0)} funkcjonariuszy
                      </span>
                    </div>

                    <div className="mt-4 space-y-4">
                      {group.roles.map((entry) => (
                        <div key={entry.role} className="relative border-l border-white/10 pl-4">
                          <div className="text-sm font-semibold uppercase tracking-wide text-white/70">
                            {ROLE_LABELS[entry.role] || entry.role}
                          </div>
                          {entry.members.length ? (
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              {entry.members.map((member) => (
                                <MemberBadge
                                  key={member.uid}
                                  member={member}
                                  highlight={normalizedLogin ? normalizedLogin === member.login.toLowerCase() : false}
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="mt-2 text-xs text-white/40">Brak przypisanych funkcjonariuszy.</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                ))}

                {loading && members.length === 0 && (
                  <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/60">
                    Ładowanie struktury dowodzenia…
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-lg font-semibold text-white">Departamenty</h2>
                    <span className="text-xs text-white/50">{members.length} osób</span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {departmentAssignments.map(({ option, members: deptMembers }) => (
                      <div key={option.value} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={CHIP_CLASS}
                            style={{
                              background: option.background,
                              color: option.color,
                              borderColor: option.borderColor,
                            }}
                          >
                            {option.abbreviation}
                          </span>
                          <span className="text-xs text-white/60">{option.label}</span>
                        </div>
                        {deptMembers.length ? (
                          <ul className="mt-3 space-y-1 text-[13px] text-white/80">
                            {deptMembers.map((member) => (
                              <li key={`${option.value}-${member.uid}`} className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{formatPersonLabel(member.fullName, member.login)}</span>
                                {member.badgeNumber && (
                                  <span className="text-[11px] font-mono text-white/50">#{member.badgeNumber}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="mt-3 text-xs text-white/40">Brak przypisanych osób.</div>
                        )}
                      </div>
                    ))}
                    {unassignedDepartments.length > 0 && (
                      <div className="rounded-2xl border border-dashed border-white/25 bg-white/5 p-3">
                        <div className="text-xs font-semibold uppercase text-white/60">Nieprzypisani</div>
                        <ul className="mt-2 space-y-1 text-[13px] text-white/70">
                          {unassignedDepartments.map((member) => (
                            <li key={`unassigned-${member.uid}`}>{formatPersonLabel(member.fullName, member.login)}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </section>

                <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
                  <h2 className="text-lg font-semibold text-white">Jednostki specjalistyczne</h2>
                  <p className="text-xs text-white/60">
                    Przypisania do jednostek wewnętrznych wraz z dodatkowymi stopniami funkcyjnymi.
                  </p>
                  <div className="mt-4 space-y-3">
                    {unitAssignments.map(({ option, members: unitMembers }) => (
                      <div key={option.value} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={CHIP_CLASS}
                            style={{
                              background: option.background,
                              color: option.color,
                              borderColor: option.borderColor,
                            }}
                          >
                            {option.abbreviation}
                          </span>
                          <span className="text-xs text-white/60">{option.label}</span>
                        </div>
                        {unitMembers.length ? (
                          <ul className="mt-3 space-y-1 text-[13px] text-white/80">
                            {unitMembers.map((member) => {
                              const rankOptions = member.additionalRanks
                                .map((rank) => getAdditionalRankOption(rank))
                                .filter(
                                  (rankOption): rankOption is NonNullable<ReturnType<typeof getAdditionalRankOption>> =>
                                    !!rankOption && rankOption.unit === option.value
                                );
                              return (
                                <li key={`${option.value}-${member.uid}`} className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium">
                                    {formatPersonLabel(member.fullName, member.login)}
                                  </span>
                                  {rankOptions.map((rankOption) => (
                                    <span
                                      key={`unit-rank-${member.uid}-${rankOption.value}`}
                                      className={`${CHIP_CLASS} text-[9px]`}
                                      style={{
                                        background: rankOption.background,
                                        color: rankOption.color,
                                        borderColor: rankOption.borderColor,
                                      }}
                                    >
                                      {rankOption.label}
                                    </span>
                                  ))}
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <div className="mt-3 text-xs text-white/40">Brak przypisanych osób.</div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </div>
        </div>
      </>
    </AuthGate>
  );
}
