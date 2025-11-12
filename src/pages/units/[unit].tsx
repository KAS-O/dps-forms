import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import { useProfile } from "@/hooks/useProfile";
import { auth } from "@/lib/firebase";
import GangUnitCriminalGroups from "@/components/units/GangUnitCriminalGroups";
import {
  getAdditionalRankOption,
  getDepartmentOption,
  getInternalUnitOption,
  type AdditionalRank,
  type Department,
  type InternalUnit,
} from "@/lib/hr";
import { ROLE_LABELS, isHighCommand, type Role } from "@/lib/roles";
import {
  getUnitSection,
  resolveUnitPermission,
  formatManageableRankList,
  type UnitPermission,
  type UnitSectionConfig,
} from "@/lib/internalUnits";

const CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide shadow-sm";

type TabKey = "home" | "management" | "criminal-groups";

type TabDefinition = {
  value: TabKey;
  label: string;
  description: string;
  chip: string;
};

function formatInitials(fullName?: string | null, login?: string | null): string {
  const source = fullName && fullName.trim().length > 0 ? fullName : login || "";
  if (!source) return "?";
  const parts = source
    .replace(/[^a-ząćęłńóśźż0-9\s]/gi, " ")
    .split(" ")
    .filter(Boolean);
  if (parts.length === 0) {
    return source.slice(0, 2).toUpperCase();
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

async function readErrorResponse(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const data = await res.json();
      const message = data?.error || data?.message;
      if (message) return String(message);
    } catch (err) {
      console.warn("Nie udało się sparsować JSON z odpowiedzi:", err);
    }
  }
  return fallback;
}

type UnitMember = {
  uid: string;
  login: string;
  fullName: string;
  role: Role;
  badgeNumber?: string;
  department: Department | null;
  units: InternalUnit[];
  additionalRanks: AdditionalRank[];
};

type MemberUpdate = { membership: boolean; ranks: AdditionalRank[] };

type MemberRowProps = {
  member: UnitMember;
  unit: InternalUnit;
  manageableRanks: AdditionalRank[];
  onSubmit: (uid: string, update: MemberUpdate) => Promise<void>;
  saving: boolean;
};

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function MemberRow({ member, unit, manageableRanks, onSubmit, saving }: MemberRowProps) {
  const originalMembership = useMemo(() => member.units.includes(unit), [member.units, unit]);
  const originalRanks = useMemo(
    () => manageableRanks.filter((rank) => member.additionalRanks.includes(rank)),
    [manageableRanks, member.additionalRanks]
  );
  const [membership, setMembership] = useState<boolean>(originalMembership);
  const [selectedRanks, setSelectedRanks] = useState<AdditionalRank[]>(originalRanks);

  useEffect(() => {
    setMembership(originalMembership);
  }, [originalMembership]);

  useEffect(() => {
    setSelectedRanks(originalRanks);
  }, [originalRanks]);

  const departmentOption = getDepartmentOption(member.department);
  const unitOptions = member.units
    .map((value) => getInternalUnitOption(value))
    .filter((option): option is NonNullable<ReturnType<typeof getInternalUnitOption>> => !!option);
  const rankOptions = member.additionalRanks
    .map((rank) => getAdditionalRankOption(rank))
    .filter((option): option is NonNullable<ReturnType<typeof getAdditionalRankOption>> => !!option);

  const manageableOptions = manageableRanks
    .map((rank) => getAdditionalRankOption(rank))
    .filter((option): option is NonNullable<ReturnType<typeof getAdditionalRankOption>> => !!option);

  const sortedSelectedRanks = useMemo(() => {
    const set = new Set(selectedRanks);
    return manageableRanks.filter((rank) => set.has(rank));
  }, [selectedRanks, manageableRanks]);

  const dirty = membership !== originalMembership || !arraysEqual(sortedSelectedRanks, originalRanks);

  const toggleRank = (rank: AdditionalRank) => {
    setSelectedRanks((prev) => {
      if (prev.includes(rank)) {
        return prev.filter((value) => value !== rank);
      }
      const next = [...prev, rank];
      const nextSet = new Set(next);
      return manageableRanks.filter((value) => nextSet.has(value));
    });
  };

  const handleReset = () => {
    setMembership(originalMembership);
    setSelectedRanks(originalRanks);
  };

  const handleSave = async () => {
    if (saving || !dirty) return;
    await onSubmit(member.uid, { membership, ranks: sortedSelectedRanks });
  };

  const highestRankLabels = manageableOptions.map((option) => option.label);

  return (
    <div className="card p-4 space-y-3" data-section="unit-management">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-base font-semibold text-white/90">
            {member.fullName}
            {member.badgeNumber ? (
              <span className="ml-2 text-xs font-mono text-white/50">#{member.badgeNumber}</span>
            ) : null}
          </div>
          <div className="text-xs text-white/60">
            {member.login} • {ROLE_LABELS[member.role] || member.role}
          </div>
        </div>
        <div className="flex gap-2 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="accent-blue-400"
              checked={membership}
              onChange={(e) => setMembership(e.target.checked)}
              disabled={saving}
            />
            Członek {getInternalUnitOption(unit)?.abbreviation || unit.toUpperCase()}
          </label>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
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
        {unitOptions.map((option) => (
          <span
            key={`unit-${option.value}`}
            className={CHIP_CLASS}
            style={{
              background: option.background,
              color: option.color,
              borderColor: option.borderColor,
            }}
          >
            {option.shortLabel || option.abbreviation}
          </span>
        ))}
        {rankOptions.map((option) => (
          <span
            key={`rank-${option.value}`}
            className={`${CHIP_CLASS} text-[11px]`}
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

      {manageableOptions.length > 0 && (
        <div className="flex flex-wrap gap-4 text-sm text-white/80">
          {manageableOptions.map((option) => (
            <label key={option.value} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-blue-400"
                checked={sortedSelectedRanks.includes(option.value)}
                onChange={() => toggleRank(option.value)}
                disabled={saving || !membership}
              />
              {option.label}
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn--primary btn--small"
          disabled={saving || !dirty}
          onClick={handleSave}
        >
          Zapisz zmiany
        </button>
        <button className="btn btn--ghost btn--small" disabled={saving || !dirty} onClick={handleReset}>
          Anuluj
        </button>
        {!membership && manageableOptions.length > 0 && highestRankLabels.length > 0 && (
          <span className="text-[11px] text-white/50">
            Po odebraniu członkostwa usunięte zostaną rangi: {highestRankLabels.join(", ")}
          </span>
        )}
      </div>
    </div>
  );
}

export default function UnitPanelPage() {
  const router = useRouter();
  const unitSlug = Array.isArray(router.query.unit) ? router.query.unit[0] : router.query.unit;
  const normalizedUnit = (unitSlug ? unitSlug.toLowerCase() : "") as InternalUnit;
  const section: UnitSectionConfig | null = unitSlug ? getUnitSection(normalizedUnit) : null;
  const { additionalRanks, ready, units: profileUnits = [], role } = useProfile();
  const isHighCommandRole = isHighCommand(role);
  const basePermission = useMemo(
    () => (section ? resolveUnitPermission(section.unit, additionalRanks) : null),
    [section, additionalRanks]
  );
  const highCommandPermission = useMemo<UnitPermission | null>(() => {
    if (!section || !isHighCommandRole) {
      return null;
    }
    const [highest, ...rest] = section.rankHierarchy;
    if (!highest) {
      return null;
    }
    return {
      unit: section.unit,
      highestRank: highest,
      manageableRanks: rest,
    };
  }, [section, isHighCommandRole]);
  const permission: UnitPermission | null = basePermission ?? highCommandPermission;

  const [members, setMembers] = useState<UnitMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [mutating, setMutating] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("home");

  const membershipUnits = useMemo(
    () => (Array.isArray(profileUnits) ? profileUnits : []),
    [profileUnits]
  );
  const unit = section?.unit ?? null;
  const isMember = useMemo(
    () => (section ? membershipUnits.includes(section.unit) : false),
    [membershipUnits, section]
  );
  const canViewRoster = Boolean(section && (isMember || permission || isHighCommandRole));
  const canManage = Boolean(permission);

  const tabDefinitions = useMemo<TabDefinition[]>(() => {
    if (!section) {
      return [
        {
          value: "home",
          label: "Strona główna jednostki",
          description: "Przegląd informacji o jednostce oraz jej obsady.",
          chip: "Panel jednostki",
        },
      ];
    }
    const entries: TabDefinition[] = [
      {
        value: "home",
        label: `Strona główna ${section.label}`,
        description: "Ogólny widok jednostki, obsada i najważniejsze informacje.",
        chip: section.shortLabel || "Panel jednostki",
      },
    ];
    if (canManage) {
      entries.push({
        value: "management",
        label: "Zarządzanie jednostką",
        description: "Zarządzaj członkostwem funkcjonariuszy i rangami jednostki.",
        chip: "Zarządzanie",
      });
      if (section.unit === "gu") {
        entries.push({
          value: "criminal-groups",
          label: "Grupy przestępcze",
          description: "Rejestr organizacji monitorowanych przez Gang Unit.",
          chip: "Operacje GU",
        });
      }
    }
    return entries;
  }, [section, canManage]);

  useEffect(() => {
    if (!tabDefinitions.length) {
      return;
    }
    if (!tabDefinitions.some((definition) => definition.value === tab)) {
      setTab(tabDefinitions[0].value);
    }
  }, [tabDefinitions, tab]);

  const activeTabDefinition = tabDefinitions.find((definition) => definition.value === tab) ?? tabDefinitions[0];

  const loadMembers = useCallback(async () => {
    if (!unit || !canViewRoster) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Brak zalogowanego użytkownika.");
      const token = await user.getIdToken();
      const res = await fetch(`/api/internal-units/${unit}/members`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error(await readErrorResponse(res, "Nie udało się pobrać listy funkcjonariuszy."));
      }
      const data = await res.json();
      const entries = Array.isArray(data?.members) ? (data.members as UnitMember[]) : [];
      setMembers(entries);
    } catch (err: any) {
      setError(err?.message || "Nie udało się pobrać listy funkcjonariuszy.");
    } finally {
      setLoading(false);
    }
  }, [unit, canViewRoster]);

  useEffect(() => {
    if (!unit) {
      setLoading(false);
      return;
    }
    if (!ready) {
      return;
    }
    if (canViewRoster) {
      loadMembers();
    } else {
      setLoading(false);
    }
  }, [unit, ready, canViewRoster, loadMembers]);

  const handleSubmit = useCallback(
    async (uid: string, update: MemberUpdate) => {
      if (!unit || !permission) return;
      setMutating(uid);
      setActionError(null);
      try {
        const user = auth.currentUser;
        if (!user) throw new Error("Brak zalogowanego użytkownika.");
        const token = await user.getIdToken();
        const res = await fetch(`/api/internal-units/${unit}/members`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ uid, membership: update.membership, ranks: update.ranks }),
        });
        if (!res.ok) {
          throw new Error(await readErrorResponse(res, "Nie udało się zapisać zmian."));
        }
        const data = await res.json();
        const payload = data?.member;
        if (payload && typeof payload === "object") {
          setMembers((prev) =>
            prev.map((member) =>
              member.uid === uid
                ? {
                    ...member,
                    units: Array.isArray(payload.units) ? (payload.units as InternalUnit[]) : member.units,
                    additionalRanks: Array.isArray(payload.additionalRanks)
                      ? (payload.additionalRanks as AdditionalRank[])
                      : member.additionalRanks,
                  }
                : member
            )
          );
        }
      } catch (err: any) {
        setActionError(err?.message || "Nie udało się zapisać zmian.");
      } finally {
        setMutating(null);
      }
    },
    [unit, permission]
  );

  const filteredMembers = useMemo(() => {
    if (!search.trim()) return members;
    const q = search.trim().toLowerCase();
    return members.filter((member) => {
      if (member.fullName.toLowerCase().includes(q)) return true;
      if (member.login.toLowerCase().includes(q)) return true;
      if (member.badgeNumber && member.badgeNumber.toLowerCase().includes(q)) return true;
      const departmentLabel = getDepartmentOption(member.department)?.abbreviation?.toLowerCase();
      if (departmentLabel && departmentLabel.includes(q)) return true;
      const unitLabels = member.units
        .map((value) => getInternalUnitOption(value)?.abbreviation?.toLowerCase())
        .filter(Boolean);
      if (unitLabels.some((label) => label && label.includes(q))) return true;
      const rankLabels = member.additionalRanks
        .map((rank) => getAdditionalRankOption(rank)?.label.toLowerCase())
        .filter(Boolean);
      if (rankLabels.some((label) => label && label.includes(q))) return true;
      return false;
    });
  }, [members, search]);

  const manageableRanks = permission?.manageableRanks ?? [];
  const highestRankOption = permission ? getAdditionalRankOption(permission.highestRank) : null;
  const manageableList = permission ? formatManageableRankList(permission.manageableRanks) : "";

  const accessMessage = permission
    ? permission.manageableRanks.length
      ? `Jako ${highestRankOption?.label || "opiekun"} możesz zarządzać członkostwem w ${
          section?.shortLabel || "jednostce"
        } oraz rangami: ${manageableList}.`
      : `Jako ${highestRankOption?.label || "opiekun"} możesz zarządzać członkostwem w ${
          section?.shortLabel || "jednostce"
        }.`
    : "Brak uprawnień do zarządzania tą jednostką.";

  return (
    <AuthGate>
      <>
        <Head>
          <title>Panel jednostki — {section?.label || "Jednostka"}</title>
        </Head>
        <Nav />
        <main className="min-h-screen px-4 py-8">
          <div className="mx-auto w-full max-w-6xl">
            <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
              <aside className="card space-y-4 p-5 text-white" aria-label="Nawigacja jednostki">
                <div className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.3em] text-white/70">Sekcje jednostki</span>
                  <h1 className="text-2xl font-semibold text-white">{section?.label || "Jednostka"}</h1>
                  <p className="text-sm text-white/60">
                    Wybierz obszar pracy jednostki i przełączaj się między modułami bez przewijania bocznego panelu.
                  </p>
                </div>
                <nav className="flex flex-col gap-2">
                  {tabDefinitions.map((definition) => {
                    const active = definition.value === tab;
                    return (
                      <button
                        key={definition.value}
                        type="button"
                        onClick={() => setTab(definition.value)}
                        className={`rounded-2xl border px-4 py-3 text-left transition ${
                          active
                            ? "border-white/50 bg-white/15 shadow-[0_18px_40px_-28px_rgba(59,130,246,0.8)]"
                            : "border-white/10 bg-white/5 hover:bg-white/10"
                        }`}
                      >
                        <div className="text-sm font-semibold text-white">{definition.label}</div>
                        <p className="mt-1 text-xs text-white/70">{definition.description}</p>
                      </button>
                    );
                  })}
                </nav>
              </aside>

              <div className="space-y-6">
                <div className="card space-y-4 p-6" data-section={tab}>
                  <span className="section-chip">
                    <span
                      className="section-chip__dot"
                      style={{ background: section ? section.navColor : "#38bdf8" }}
                      aria-hidden
                    />
                    {activeTabDefinition?.chip || "Panel jednostki"}
                  </span>
                  <div className="space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight">
                      {activeTabDefinition?.label || section?.label || "Jednostka"}
                    </h2>
                    <p className="text-sm text-white/70">
                      {activeTabDefinition?.description || "Wybierz sekcję, aby rozpocząć pracę w tej jednostce."}
                    </p>
                  </div>
                  {!section && (
                    <div className="text-sm text-red-300">Nie znaleziono konfiguracji dla podanej jednostki.</div>
                  )}
                  {ready && !canManage && tab === "management" && section && (
                    <div className="text-sm text-red-300">Nie masz uprawnień do zarządzania tą jednostką.</div>
                  )}
                </div>

                {tab === "home" && (
                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="space-y-6">
                      <div className="card p-6">
                        <h3 className="text-xl font-semibold text-white">Panel informacji</h3>
                        <p className="mt-2 text-sm text-white/70">
                          Sekcja przeznaczona na komunikaty, procedury oraz dokumenty operacyjne jednostki.
                        </p>
                        <div className="mt-4 rounded-2xl border border-white/15 bg-white/5 p-4 text-sm text-white/60">
                          Dodaj tutaj kluczowe informacje i aktualizacje — moduł jest gotowy na uzupełnienie.
                        </div>
                      </div>
                      <div className="card p-6">
                        <h3 className="text-xl font-semibold text-white">Zadania jednostki</h3>
                        <p className="mt-2 text-sm text-white/70">
                          W tym miejscu możesz wypisać bieżące cele, priorytety i wskaźniki dla zespołu.
                        </p>
                        <div className="mt-4 grid gap-3 text-sm text-white/70 md:grid-cols-2">
                          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
                            <div className="text-xs uppercase tracking-[0.3em] text-white/50">Priorytet</div>
                            <div className="mt-2 text-lg font-semibold text-white">Do ustalenia</div>
                            <p className="mt-1 text-xs text-white/60">Uzupełnij priorytety, aby funkcjonariusze wiedzieli nad czym pracować.</p>
                          </div>
                          <div className="rounded-2xl border border-white/15 bg-white/5 p-4">
                            <div className="text-xs uppercase tracking-[0.3em] text-white/50">Kontakt</div>
                            <div className="mt-2 text-lg font-semibold text-white">Do uzupełnienia</div>
                            <p className="mt-1 text-xs text-white/60">Dodaj dane kontaktowe dowództwa oraz kanały komunikacji.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="card bg-white/95 p-5 text-slate-900 shadow">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold text-slate-900">Skład jednostki</h3>
                          <p className="text-xs text-slate-500">Lista funkcjonariuszy przypisanych do sekcji.</p>
                        </div>
                        <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                          {loading ? "—" : members.length}
                        </span>
                      </div>
                      <div className="mt-4 space-y-3">
                        {loading ? (
                          <div className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600">
                            Ładowanie danych...
                          </div>
                        ) : !canViewRoster ? (
                          <div className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600">
                            Brak dostępu do listy funkcjonariuszy tej jednostki.
                          </div>
                        ) : error ? (
                          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
                        ) : members.length === 0 ? (
                          <div className="rounded-2xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-600">
                            Brak przypisanych funkcjonariuszy.
                          </div>
                        ) : (
                          <ul className="space-y-2">
                            {members.map((member) => (
                              <li
                                key={member.uid}
                                className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2"
                              >
                                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white">
                                  {formatInitials(member.fullName, member.login)}
                                </span>
                                <div className="flex flex-col">
                                  <span className="text-sm font-semibold text-slate-900">{member.fullName || "Bez nazwy"}</span>
                                  <span className="text-xs text-slate-500">
                                    {member.login}
                                    {member.badgeNumber ? ` • #${member.badgeNumber}` : ""}
                                  </span>
                                  <span className="text-xs text-slate-500">{ROLE_LABELS[member.role] || member.role}</span>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {tab === "management" && canManage && section && (
                  <div className="card space-y-5 p-6" data-section="unit-management">
                    <p className="text-sm text-white/70">{accessMessage}</p>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        className="input flex-1 min-w-[200px]"
                        placeholder="Wyszukaj funkcjonariusza..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      <button className="btn btn--ghost btn--small" onClick={loadMembers} disabled={loading}>
                        Odśwież
                      </button>
                    </div>

                    {!loading && error && <div className="text-sm text-red-300">{error}</div>}
                    {actionError && <div className="text-sm text-red-300">{actionError}</div>}

                    {loading ? (
                      <div className="text-sm text-white/60">Ładowanie danych...</div>
                    ) : filteredMembers.length === 0 ? (
                      <div className="text-sm text-white/60">Brak funkcjonariuszy spełniających kryteria.</div>
                    ) : (
                      <div className="space-y-4">
                        {filteredMembers.map((member) => (
                          <MemberRow
                            key={member.uid}
                            member={member}
                            unit={section.unit}
                            manageableRanks={manageableRanks}
                            onSubmit={handleSubmit}
                            saving={mutating === member.uid}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {tab === "criminal-groups" && canManage && section?.unit === "gu" && <GangUnitCriminalGroups />}
              </div>
            </div>
          </div>
        </main>
      </>
    </AuthGate>
  );
}
