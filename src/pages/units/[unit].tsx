import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import AuthGate from "@/components/AuthGate";
import PanelLayout from "@/components/PanelLayout";
import { useProfile } from "@/hooks/useProfile";
import { auth } from "@/lib/firebase";
import {
  getAdditionalRankOption,
  getDepartmentOption,
  getInternalUnitOption,
  type AdditionalRank,
  type Department,
  type InternalUnit,
} from "@/lib/hr";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import {
  getUnitSection,
  resolveUnitPermission,
  formatManageableRankList,
  type UnitSectionConfig,
} from "@/lib/internalUnits";

const CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide shadow-sm";

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
  const { additionalRanks, ready } = useProfile();
  const permission = useMemo(
    () => (section ? resolveUnitPermission(section.unit, additionalRanks) : null),
    [section, additionalRanks]
  );
  const [members, setMembers] = useState<UnitMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [mutating, setMutating] = useState<string | null>(null);

  const unit = section?.unit ?? null;

  const loadMembers = useCallback(async () => {
    if (!unit || !permission) return;
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
  }, [unit, permission]);

  useEffect(() => {
    if (unit && permission) {
      loadMembers();
    } else {
      setLoading(false);
    }
  }, [unit, permission, loadMembers]);

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
        <PanelLayout>
          <div className="flex max-w-5xl flex-col gap-6">
            <div className="card space-y-5 p-6" data-section="unit-management">
              <span className="section-chip">
                <span
                  className="section-chip__dot"
                  style={{ background: section ? section.navColor : "#38bdf8" }}
                  aria-hidden
                />
                Zarządzanie funkcjonariuszami
              </span>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tight">
                  {section ? section.label : "Nieznana jednostka"}
                </h1>
                <p className="text-sm text-white/70">{accessMessage}</p>
              </div>

              {!section && (
                <div className="text-sm text-red-300">
                  Nie znaleziono konfiguracji dla podanej jednostki.
                </div>
              )}

              {ready && !permission && section && (
                <div className="text-sm text-red-300">
                  Nie masz uprawnień do zarządzania tą jednostką.
                </div>
              )}

              {permission && (
                <>
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

                  {error && <div className="text-sm text-red-300">{error}</div>}
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
                          unit={unit!}
                          manageableRanks={manageableRanks}
                          onSubmit={handleSubmit}
                          saving={mutating === member.uid}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </PanelLayout>
      </>
    </AuthGate>
  );
}
