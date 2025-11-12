import { useRouter } from "next/router";
import Head from "next/head";
import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import { useProfile } from "@/hooks/useProfile";
import {
  INTERNAL_UNITS,
  getInternalUnitOption,
  getAdditionalRankOption,
  UNIT_RANK_HIERARCHY,
  type InternalUnit,
  type AdditionalRank,
  type AdditionalRankOption,
} from "@/lib/hr";
import { auth } from "@/lib/firebase";

const UNIT_SET = new Set(INTERNAL_UNITS.map((unit) => unit.value));

type UnitMember = {
  uid: string;
  login: string;
  fullName?: string;
  badgeNumber?: string;
  units: InternalUnit[];
  additionalRanks: AdditionalRank[];
};

type UpdateRequest =
  | {
      uid: string;
      action: "add" | "remove";
      targetType: "unit";
      target: InternalUnit;
    }
  | {
      uid: string;
      action: "add" | "remove";
      targetType: "rank";
      target: AdditionalRank;
    };

function isInternalUnitValue(value: string): value is InternalUnit {
  return UNIT_SET.has(value as InternalUnit);
}

function getLeadershipIndex(member: UnitMember, hierarchy: AdditionalRank[]): number | null {
  const indices = member.additionalRanks
    .map((rank) => hierarchy.indexOf(rank))
    .filter((index) => index >= 0);
  return indices.length ? Math.min(...indices) : null;
}

function sortMembers(list: UnitMember[], unit: InternalUnit, hierarchy: AdditionalRank[]): UnitMember[] {
  return list
    .slice()
    .sort((a, b) => {
      const aInUnit = a.units.includes(unit) ? 0 : 1;
      const bInUnit = b.units.includes(unit) ? 0 : 1;
      if (aInUnit !== bInUnit) return aInUnit - bInUnit;

      const aLevel = getLeadershipIndex(a, hierarchy);
      const bLevel = getLeadershipIndex(b, hierarchy);
      if (aLevel !== bLevel) {
        if (aLevel == null) return 1;
        if (bLevel == null) return -1;
        return aLevel - bLevel;
      }

      const nameA = (a.fullName || a.login).toLowerCase();
      const nameB = (b.fullName || b.login).toLowerCase();
      return nameA.localeCompare(nameB, "pl", { sensitivity: "base" });
    });
}

function UnitPageContent() {
  const router = useRouter();
  const { units, additionalRanks, ready } = useProfile();
  const [members, setMembers] = useState<UnitMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const unitSlug = Array.isArray(router.query.unit) ? router.query.unit[0] : router.query.unit;

  const unit: InternalUnit | null = useMemo(() => {
    if (typeof unitSlug !== "string") return null;
    const normalized = unitSlug.trim().toLowerCase();
    if (!normalized) return null;
    return isInternalUnitValue(normalized) ? (normalized as InternalUnit) : null;
  }, [unitSlug]);

  const unitOption = useMemo(() => (unit ? getInternalUnitOption(unit) : null), [unit]);
  const hierarchy = useMemo<AdditionalRank[]>(() => {
    if (!unit) return [];
    return UNIT_RANK_HIERARCHY[unit] || [];
  }, [unit]);

  const accessibleUnits = useMemo(() => {
    const set = new Set<InternalUnit>();
    units.forEach((value) => set.add(value));
    additionalRanks.forEach((rank) => {
      const option = getAdditionalRankOption(rank);
      if (option) {
        set.add(option.unit);
      }
    });
    return set;
  }, [units, additionalRanks]);

  const hasAccess = unit ? accessibleUnits.has(unit) : false;

  const leadershipIndices = useMemo(() => {
    if (!unit) return [] as number[];
    return additionalRanks
      .map((rank) => hierarchy.indexOf(rank))
      .filter((index) => index >= 0);
  }, [additionalRanks, hierarchy, unit]);

  const leadershipLevel = leadershipIndices.length ? Math.min(...leadershipIndices) : null;
  const canManage = leadershipLevel !== null;
  const manageableRanks = useMemo(() => {
    if (!unit || leadershipLevel === null) return [] as AdditionalRank[];
    return hierarchy.slice(leadershipLevel + 1);
  }, [hierarchy, leadershipLevel, unit]);

  const manageableRankOptions: AdditionalRankOption[] = useMemo(
    () => manageableRanks.map((rank) => getAdditionalRankOption(rank)).filter(Boolean) as AdditionalRankOption[],
    [manageableRanks]
  );

  const fetchMembers = useCallback(async () => {
    if (!unit || !canManage) return;
    try {
      setLoadingMembers(true);
      setError(null);
      const user = auth.currentUser;
      if (!user) {
        throw new Error("Brak uwierzytelnienia.");
      }
      const token = await user.getIdToken();
      const res = await fetch(`/api/units/${unit}/members`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Nie udało się pobrać listy funkcjonariuszy.");
      }
      const list = Array.isArray(data?.members) ? (data.members as UnitMember[]) : [];
      setMembers(sortMembers(list, unit, hierarchy));
    } catch (err: any) {
      setError(err?.message || "Nie udało się pobrać listy funkcjonariuszy.");
    } finally {
      setLoadingMembers(false);
    }
  }, [hierarchy, unit, canManage]);

  useEffect(() => {
    if (!unit || !canManage) {
      setMembers([]);
      return;
    }
    fetchMembers();
  }, [unit, canManage, fetchMembers]);

  useEffect(() => {
    if (unit) {
      setMembers((prev) => sortMembers(prev, unit, hierarchy));
    }
  }, [unit, hierarchy]);

  const filteredMembers = useMemo(() => {
    if (!unit) return [] as UnitMember[];
    const query = search.trim().toLowerCase();
    const base = sortMembers(members, unit, hierarchy);
    if (!query) return base;
    return base.filter((member) => {
      const name = (member.fullName || "").toLowerCase();
      const login = member.login.toLowerCase();
      const badge = (member.badgeNumber || "").toLowerCase();
      const rankLabels = member.additionalRanks
        .map((rank) => getAdditionalRankOption(rank)?.label || "")
        .map((label) => label.toLowerCase())
        .filter(Boolean);
      return (
        name.includes(query) ||
        login.includes(query) ||
        (badge ? badge.includes(query) : false) ||
        rankLabels.some((label) => label.includes(query))
      );
    });
  }, [members, search, hierarchy, unit]);

  const handleUpdate = useCallback(
    async (update: UpdateRequest) => {
      if (!unit) return;
      try {
        const user = auth.currentUser;
        if (!user) {
          throw new Error("Brak uwierzytelnienia.");
        }
        const key = update.targetType === "unit" ? `${update.uid}-unit` : `${update.uid}-${update.target}`;
        setPendingKey(key);
        setError(null);
        const token = await user.getIdToken();
        const res = await fetch(`/api/units/${unit}/members`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(update),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || "Nie udało się zaktualizować funkcjonariusza.");
        }
        const member = data?.member as UnitMember | undefined;
        if (!member) {
          throw new Error("Brak danych odpowiedzi.");
        }
        setMembers((prev) => {
          const existing = prev.some((item) => item.uid === member.uid);
          const list = existing
            ? prev.map((item) => (item.uid === member.uid ? member : item))
            : [...prev, member];
          return sortMembers(list, unit, hierarchy);
        });
      } catch (err: any) {
        setError(err?.message || "Nie udało się zaktualizować funkcjonariusza.");
      } finally {
        setPendingKey(null);
      }
    },
    [hierarchy, unit]
  );

  if (!router.isReady) {
    return (
      <>
        <Head>
          <title>LSPD 77RP — Panel jednostki</title>
        </Head>
        <Nav />
        <div className="min-h-screen flex items-center justify-center">
          <div className="card p-6">Ładowanie...</div>
        </div>
      </>
    );
  }

  if (!unit || !unitOption) {
    return (
      <>
        <Head>
          <title>LSPD 77RP — Panel jednostki</title>
        </Head>
        <Nav />
        <div className="min-h-screen flex items-center justify-center">
          <div className="card p-6">Nie znaleziono wskazanej jednostki.</div>
        </div>
      </>
    );
  }

  const title = `${unitOption.shortLabel || unitOption.abbreviation} — Panel jednostki`;

  if (ready && !hasAccess) {
    return (
      <>
        <Head>
          <title>LSPD 77RP — {unitOption.shortLabel || unitOption.abbreviation}</title>
        </Head>
        <Nav />
        <div className="min-h-screen flex items-center justify-center px-4">
          <div className="card p-6 max-w-lg text-center space-y-3">
            <h1 className="text-xl font-semibold">Brak dostępu</h1>
            <p className="text-sm text-beige-100/70">
              Ta sekcja jest dostępna wyłącznie dla członków jednostki {unitOption.abbreviation}.
            </p>
          </div>
        </div>
      </>
    );
  }

  const membershipCapability = leadershipLevel !== null;
  const rankCapability = manageableRankOptions.length > 0;

  const capabilityDescription = (() => {
    if (!membershipCapability) return "Brak uprawnień do zarządzania.";
    if (membershipCapability && !rankCapability) {
      return "Możesz dodawać i usuwać funkcjonariuszy z tej jednostki.";
    }
    if (membershipCapability && rankCapability) {
      const rankList = manageableRankOptions.map((option) => option.label).join(", ");
      return `Możesz zarządzać członkostwem jednostki oraz stopniami: ${rankList}.`;
    }
    return "";
  })();

  return (
    <>
      <Head>
        <title>LSPD 77RP — {title}</title>
      </Head>
      <Nav />
      <main className="min-h-screen px-4 py-8 max-w-6xl mx-auto space-y-6">
        <section
          className="card p-6 shadow-lg"
          style={{
            background: unitOption.background,
            color: unitOption.color,
            borderColor: unitOption.borderColor,
          }}
        >
          <div className="space-y-2">
            <span className="text-xs uppercase tracking-wider opacity-80">Jednostka specjalistyczna</span>
            <h1 className="text-3xl font-bold tracking-tight">{unitOption.label}</h1>
            <p className="text-sm opacity-80">
              Panel operacyjny jednostki {unitOption.abbreviation}. Skoncentrowany na zarządzaniu personelem i wewnętrznymi
              uprawnieniami.
            </p>
          </div>
        </section>

        {canManage ? (
          <section className="card p-6 space-y-5">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3 justify-between">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">Zarządzanie funkcjonariuszami</h2>
                  <p className="text-sm text-beige-100/70">{capabilityDescription}</p>
                </div>
                <button
                  className="btn h-9 px-4 text-sm"
                  onClick={() => fetchMembers()}
                  disabled={loadingMembers}
                >
                  Odśwież listę
                </button>
              </div>
              <input
                className="input"
                placeholder="Szukaj po nazwisku, loginie lub numerze odznaki..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {error && <div className="text-sm text-red-400">{error}</div>}
            {loadingMembers ? (
              <div className="card p-5 bg-white/5 text-sm">Ładowanie listy funkcjonariuszy…</div>
            ) : (
              <div className="grid gap-3">
                {filteredMembers.map((member) => {
                  const inUnit = member.units.includes(unit);
                  const unitRanks = hierarchy
                    .map((rank) => (member.additionalRanks.includes(rank) ? getAdditionalRankOption(rank)?.label || null : null))
                    .filter(Boolean) as string[];
                  const memberLeadership = getLeadershipIndex(member, hierarchy);
                  const membershipKey = `${member.uid}-unit`;
                  return (
                    <div key={member.uid} className="card p-4 bg-white/5 border border-white/10 space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-lg font-semibold tracking-tight">{member.fullName || member.login}</div>
                          <div className="text-xs text-beige-100/60">
                            {member.badgeNumber ? `#${member.badgeNumber} • ` : ""}
                            {member.login}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 items-center">
                          <span
                            className={`px-2 py-1 text-xs rounded-full ${inUnit ? "bg-emerald-500/20 text-emerald-200" : "bg-white/10 text-white/70"}`}
                          >
                            {inUnit ? "W jednostce" : "Poza jednostką"}
                          </span>
                          {memberLeadership !== null && (
                            <span className="px-2 py-1 text-xs rounded-full bg-white/10 text-white/80">
                              {unitRanks[0] || "Dowództwo"}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="btn h-8 px-3 text-xs"
                            disabled={pendingKey === membershipKey}
                            onClick={() =>
                              handleUpdate({
                                uid: member.uid,
                                targetType: "unit",
                                target: unit,
                                action: inUnit ? "remove" : "add",
                              })
                            }
                          >
                            {inUnit ? "Usuń z jednostki" : "Dodaj do jednostki"}
                          </button>
                        </div>
                        {manageableRankOptions.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {manageableRankOptions.map((rankOption) => {
                              const hasRank = member.additionalRanks.includes(rankOption.value);
                              const key = `${member.uid}-${rankOption.value}`;
                              return (
                                <button
                                  key={rankOption.value}
                                  className={`btn h-8 px-3 text-xs ${hasRank ? "bg-red-600/30" : "bg-white/10"}`}
                                  disabled={pendingKey === key || (!inUnit && !hasRank)}
                                  onClick={() =>
                                    handleUpdate({
                                      uid: member.uid,
                                      targetType: "rank",
                                      target: rankOption.value,
                                      action: hasRank ? "remove" : "add",
                                    })
                                  }
                                >
                                  {hasRank ? `Zabierz: ${rankOption.label}` : `Nadaj: ${rankOption.label}`}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <div className="text-xs text-beige-100/70">
                          Aktualne stopnie: {unitRanks.length ? unitRanks.join(", ") : "brak"}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {filteredMembers.length === 0 && (
                  <div className="card p-5 bg-white/5 text-sm">Brak funkcjonariuszy spełniających kryteria wyszukiwania.</div>
                )}
              </div>
            )}
          </section>
        ) : (
          <section className="card p-6">
            <h2 className="text-lg font-semibold">Brak uprawnień zarządczych</h2>
            <p className="text-sm text-beige-100/70">
              Obecnie nie posiadasz przyznanego stopnia dowódczego tej jednostki. Skontaktuj się z przełożonym, aby uzyskać dostęp
              do narzędzi zarządzania personelem.
            </p>
          </section>
        )}
      </main>
    </>
  );
}

export default function UnitPage() {
  return (
    <AuthGate>
      <UnitPageContent />
    </AuthGate>
  );
}
