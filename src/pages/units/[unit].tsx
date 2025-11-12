import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import { useProfile } from "@/hooks/useProfile";
import { auth, db } from "@/lib/firebase";
import { collection, onSnapshot } from "firebase/firestore";
import {
  formatPersonLabel,
  getAdditionalRankOption,
  getInternalUnitOption,
  normalizeAdditionalRanks,
  normalizeInternalUnits,
  type AdditionalRank,
  type InternalUnit,
} from "@/lib/hr";
import {
  UNIT_PANELS,
  getUnitPanel,
  getUnitPermissionLevel,
  describePermissionLevel,
  type UnitPermissionLevel,
  type UnitPanelDefinition,
} from "@/lib/unitAccess";

type OfficerRecord = {
  uid: string;
  login: string;
  fullName: string;
  badgeNumber?: string;
  units: InternalUnit[];
  additionalRanks: AdditionalRank[];
};

type PendingKey = string | null;

const CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide";

function createPendingKey(action: string, uid: string, rank?: string) {
  return `${action}:${uid}:${rank ?? ""}`;
}

function UnitManagementSection({
  panel,
  level,
  currentUid,
}: {
  panel: UnitPanelDefinition;
  level: UnitPermissionLevel;
  currentUid: string | null;
}) {
  const [members, setMembers] = useState<OfficerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingKey>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const ref = collection(db, "profiles");
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        const data: OfficerRecord[] = snapshot.docs.map((docSnap) => {
          const raw = docSnap.data() as any;
          const loginRaw = typeof raw?.login === "string" ? raw.login.trim() : "";
          const emailLogin =
            typeof raw?.email === "string" && raw.email.includes("@")
              ? raw.email.split("@")[0]
              : "";
          const login = (loginRaw || emailLogin || docSnap.id || "").toLowerCase();
          const fullName = typeof raw?.fullName === "string" ? raw.fullName.trim() : "";
          const badgeNumber =
            typeof raw?.badgeNumber === "string" ? raw.badgeNumber.trim() : undefined;
          return {
            uid: docSnap.id,
            login,
            fullName,
            badgeNumber: badgeNumber || undefined,
            units: normalizeInternalUnits(raw?.units),
            additionalRanks: normalizeAdditionalRanks(raw?.additionalRanks ?? raw?.additionalRank),
          };
        });
        data.sort((a, b) => {
          const labelA = formatPersonLabel(a.fullName, a.login);
          const labelB = formatPersonLabel(b.fullName, b.login);
          return labelA.localeCompare(labelB, "pl", { sensitivity: "base" });
        });
        setMembers(data);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error(err);
        setError("Nie udało się pobrać listy funkcjonariuszy.");
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const filteredMembers = useMemo(() => {
    const phrase = search.trim().toLowerCase();
    if (!phrase) return members;
    return members.filter((member) => {
      const label = formatPersonLabel(member.fullName, member.login).toLowerCase();
      const badge = member.badgeNumber ? member.badgeNumber.toLowerCase() : "";
      const hasRank = member.additionalRanks.some((rank) => rank.includes(phrase));
      return label.includes(phrase) || badge.includes(phrase) || hasRank;
    });
  }, [members, search]);

  const unitOption = getInternalUnitOption(panel.unit);

  const sendAction = async (
    payload: { action: "add-member" | "remove-member" | "assign-rank" | "remove-rank"; rank?: string },
    target: OfficerRecord
  ) => {
    const key = createPendingKey(payload.action, target.uid, payload.rank);
    setPending(key);
    setActionError(null);
    setActionSuccess(null);
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error("Brak zalogowanego użytkownika.");
      }
      const token = await user.getIdToken();
      const res = await fetch("/api/unit-management", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ unit: panel.unit, targetUid: target.uid, ...payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Nie udało się zapisać zmian.");
      }
      setActionSuccess(typeof data?.message === "string" ? data.message : "Zapisano zmiany.");
    } catch (err: any) {
      setActionError(err?.message || "Nie udało się zapisać zmian.");
    } finally {
      setPending(null);
    }
  };

  const canAddMember = level >= 2;
  const canRemoveMember = level >= 3;
  const canManageDeputy = level >= 3;
  const canManageCommander = level >= 4;

  if (level < 2) {
    return null;
  }

  return (
    <section className="mt-10">
      <div className="card bg-white/5 border border-white/10 p-6 shadow-lg">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white/90">Zarządzanie funkcjonariuszami</h2>
            <p className="text-sm text-white/60">
              Twoje uprawnienia: <span className="font-semibold text-white/80">{describePermissionLevel(level)}</span>
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filtruj po nazwisku, loginie lub numerze odznaki"
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 sm:w-72"
            />
            {actionError && <p className="text-xs text-red-400">{actionError}</p>}
            {actionSuccess && !actionError && <p className="text-xs text-emerald-400">{actionSuccess}</p>}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4">
          {loading && <p className="text-sm text-white/60">Ładowanie listy funkcjonariuszy...</p>}
          {error && <p className="text-sm text-red-400">{error}</p>}
          {!loading && !error && filteredMembers.length === 0 && (
            <p className="text-sm text-white/60">Brak funkcjonariuszy spełniających kryteria wyszukiwania.</p>
          )}
          {!loading && !error &&
            filteredMembers.map((member) => {
              const isSelf = currentUid != null && member.uid === currentUid;
              const isMember = member.units.includes(panel.unit);
              const targetLevel = getUnitPermissionLevel(panel.unit, member.units, member.additionalRanks);
              const hasCommanderRanks = panel.commanderRanks.filter((rank) => member.additionalRanks.includes(rank));
              const hasDeputyRanks = panel.deputyRanks.filter((rank) => member.additionalRanks.includes(rank));
              const hasCaretakerRanks = panel.caretakerRanks.filter((rank) => member.additionalRanks.includes(rank));
              const label = formatPersonLabel(member.fullName, member.login);
              const cardClasses = `rounded-2xl border bg-white/5 p-4 transition ${
                isSelf ? "border-blue-400/60 ring-1 ring-blue-400/40" : "border-white/10"
              }`;

              const membershipPending = pending === createPendingKey("add-member", member.uid);
              const removalPending = pending === createPendingKey("remove-member", member.uid);

              return (
                <div key={member.uid} className={cardClasses}>
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-white/90">{label}</h3>
                        {isSelf && (
                          <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-200">
                            To Ty
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-white/60">
                        {member.badgeNumber ? `#${member.badgeNumber}` : "Brak numeru odznaki"}
                      </div>
                      <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-white/50">
                        {targetLevel > 0
                          ? `Status: ${describePermissionLevel(targetLevel)}`
                          : "Poza jednostką"}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {isMember && unitOption && (
                          <span
                            className={CHIP_CLASS}
                            style={{
                              background: unitOption.background,
                              color: unitOption.color,
                              borderColor: unitOption.borderColor,
                            }}
                          >
                            {panel.abbreviation}
                          </span>
                        )}
                        {[...hasCaretakerRanks, ...hasCommanderRanks, ...hasDeputyRanks].map((rank) => {
                          const option = getAdditionalRankOption(rank);
                          if (!option) return null;
                          return (
                            <span
                              key={rank}
                              className={`${CHIP_CLASS} text-[9px]`}
                              style={{
                                background: option.background,
                                color: option.color,
                                borderColor: option.borderColor,
                              }}
                            >
                              {option.label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 md:justify-end">
                      {canAddMember && !isMember && (
                        <button
                          onClick={() => sendAction({ action: "add-member" }, member)}
                          className="btn btn-primary h-9 px-3 text-xs"
                          disabled={membershipPending}
                        >
                          {membershipPending ? "Dodawanie..." : `Dodaj do ${panel.abbreviation}`}
                        </button>
                      )}
                      {canRemoveMember && isMember && targetLevel < level && (
                        <button
                          onClick={() => sendAction({ action: "remove-member" }, member)}
                          className="btn btn-danger h-9 px-3 text-xs"
                          disabled={removalPending}
                        >
                          {removalPending ? "Usuwanie..." : `Usuń z ${panel.abbreviation}`}
                        </button>
                      )}
                      {panel.deputyRanks.map((rank) => {
                        const option = getAdditionalRankOption(rank);
                        if (!option || !canManageDeputy) return null;
                        const hasRank = member.additionalRanks.includes(rank);
                        const key = createPendingKey(
                          hasRank ? "remove-rank" : "assign-rank",
                          member.uid,
                          rank
                        );
                        const isPending = pending === key;
                        return (
                          <button
                            key={`deputy-${rank}-${member.uid}`}
                            onClick={() =>
                              sendAction(
                                { action: hasRank ? "remove-rank" : "assign-rank", rank },
                                member
                              )
                            }
                            className={`btn h-9 px-3 text-xs ${hasRank ? "btn-secondary" : "btn-outline"}`}
                            disabled={isPending}
                          >
                            {isPending
                              ? hasRank
                                ? "Usuwanie..."
                                : "Nadawanie..."
                              : hasRank
                              ? `Usuń ${option.shortLabel || option.label}`
                              : `Nadaj ${option.shortLabel || option.label}`}
                          </button>
                        );
                      })}
                      {panel.commanderRanks.map((rank) => {
                        const option = getAdditionalRankOption(rank);
                        if (!option || !canManageCommander) return null;
                        const hasRank = member.additionalRanks.includes(rank);
                        const key = createPendingKey(
                          hasRank ? "remove-rank" : "assign-rank",
                          member.uid,
                          rank
                        );
                        const isPending = pending === key;
                        return (
                          <button
                            key={`commander-${rank}-${member.uid}`}
                            onClick={() =>
                              sendAction(
                                { action: hasRank ? "remove-rank" : "assign-rank", rank },
                                member
                              )
                            }
                            className={`btn h-9 px-3 text-xs ${hasRank ? "btn-secondary" : "btn-outline"}`}
                            disabled={isPending}
                          >
                            {isPending
                              ? hasRank
                                ? "Usuwanie..."
                                : "Nadawanie..."
                              : hasRank
                              ? `Usuń ${option.shortLabel || option.label}`
                              : `Nadaj ${option.shortLabel || option.label}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </section>
  );
}

export default function UnitPanelPage() {
  const router = useRouter();
  const { unit: unitParam } = router.query;
  const { ready, units, additionalRanks, uid } = useProfile();

  const panel = useMemo(
    () => getUnitPanel(typeof unitParam === "string" ? unitParam : null),
    [unitParam]
  );

  const level = useMemo(() => {
    return panel ? getUnitPermissionLevel(panel.unit, units, additionalRanks) : 0;
  }, [panel, units, additionalRanks]);

  const hasAccess = level > 0;
  const isReady = ready && router.isReady;

  return (
    <AuthGate>
      <Head>
        <title>{panel ? `${panel.abbreviation} • Panel jednostki` : "Jednostka"}</title>
      </Head>
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-10">
        {!isReady && <p className="text-sm text-white/70">Ładowanie...</p>}
        {isReady && !panel && (
          <div className="card border border-red-500/40 bg-red-500/10 p-6 text-center text-sm text-red-200">
            Nie znaleziono jednostki.
          </div>
        )}
        {isReady && panel && !hasAccess && (
          <div className="card border border-yellow-400/40 bg-yellow-500/10 p-6 text-center text-sm text-yellow-200">
            Nie posiadasz uprawnień do sekcji {panel.abbreviation}.
          </div>
        )}
        {isReady && panel && hasAccess && (
          <div className="flex flex-col gap-8">
            <section className="card border border-white/10 bg-white/5 p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-white/90">{panel.title}</h1>
                  <p className="text-sm text-white/60">
                    Dostępny poziom uprawnień: {describePermissionLevel(level)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {UNIT_PANELS[panel.unit] && (
                    <span className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/70">
                      Sekcja {panel.abbreviation}
                    </span>
                  )}
                </div>
              </div>
              <p className="mt-4 text-sm text-white/60">
                Panel jednostki umożliwia zarządzanie członkami i rangami specjalnymi. Kolejne
                moduły zostaną dodane w przyszłości.
              </p>
            </section>
            <UnitManagementSection panel={panel} level={level} currentUid={uid} />
          </div>
        )}
      </main>
    </AuthGate>
  );
}
