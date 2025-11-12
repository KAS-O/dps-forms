import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import { useProfile } from "@/hooks/useProfile";
import { auth, db } from "@/lib/firebase";
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
  type UnitSectionConfig,
} from "@/lib/internalUnits";
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";

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

type CriminalGroupRecord = {
  id: string;
  title?: string;
  group?: {
    name?: string;
    colorName?: string;
    colorHex?: string;
    organizationType?: string;
    base?: string;
    operations?: string;
  } | null;
};

type NewCriminalGroupInput = {
  name: string;
  title: string;
  colorName: string;
  colorHex: string;
  organizationType: string;
  base: string;
  operations: string;
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
  const { additionalRanks, ready, units: profileUnits, role } = useProfile();
  const [activeTab, setActiveTab] = useState<"home" | "management">("home");
  const [members, setMembers] = useState<UnitMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [mutating, setMutating] = useState<string | null>(null);
  const [criminalGroups, setCriminalGroups] = useState<CriminalGroupRecord[]>([]);
  const [criminalGroupsLoading, setCriminalGroupsLoading] = useState(false);
  const [criminalGroupsError, setCriminalGroupsError] = useState<string | null>(null);
  const [groupForm, setGroupForm] = useState<NewCriminalGroupInput>({
    name: "",
    title: "",
    colorName: "",
    colorHex: "#7c3aed",
    organizationType: "",
    base: "",
    operations: "",
  });
  const [groupSaving, setGroupSaving] = useState(false);
  const [groupFormError, setGroupFormError] = useState<string | null>(null);

  const unit = section?.unit ?? null;

  const permission = useMemo(
    () => (section ? resolveUnitPermission(section.unit, additionalRanks) : null),
    [section, additionalRanks]
  );

  const managementPermission = useMemo(() => {
    if (permission) return permission;
    if (!section) return null;
    if (isHighCommand(role)) {
      const hierarchy = section.rankHierarchy;
      if (!hierarchy.length) return null;
      return {
        unit: section.unit,
        highestRank: hierarchy[0],
        manageableRanks: hierarchy.slice(),
      };
    }
    return null;
  }, [permission, section, role]);

  const belongsToUnit = useMemo(() => {
    if (!section) return false;
    if (!Array.isArray(profileUnits)) return false;
    return profileUnits.includes(section.unit);
  }, [section, profileUnits]);

  const canViewMembers = useMemo(() => {
    if (!section) return false;
    if (managementPermission) return true;
    if (!ready) return false;
    if (isHighCommand(role)) return true;
    return belongsToUnit;
  }, [section, managementPermission, ready, role, belongsToUnit]);

  const tabs = useMemo(() => {
    const entries: { id: "home" | "management"; label: string }[] = [];
    const baseLabel = section?.shortLabel || section?.label || "";
    const homeLabel = `Strona główna ${baseLabel}`.trim() || "Strona jednostki";
    entries.push({ id: "home", label: homeLabel });
    if (managementPermission) {
      entries.push({ id: "management", label: "Zarządzanie jednostką" });
    }
    return entries;
  }, [section, managementPermission]);

  useEffect(() => {
    if (!router.isReady) return;
    const viewParam = typeof router.query.view === "string" ? router.query.view.toLowerCase() : "";
    if (viewParam === "management" && managementPermission) {
      setActiveTab("management");
      return;
    }
    setActiveTab("home");
    if (viewParam === "management" && !managementPermission) {
      const nextQuery = { ...router.query };
      delete nextQuery.view;
      router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true });
    }
  }, [router.isReady, router.query.view, router.pathname, router, managementPermission]);

  const handleTabChange = useCallback(
    (tab: "home" | "management") => {
      if (tab === "management" && !managementPermission) return;
      setActiveTab(tab);
      const nextQuery = { ...router.query };
      if (tab === "home") {
        delete nextQuery.view;
      } else {
        nextQuery.view = tab;
      }
      router.replace({ pathname: router.pathname, query: nextQuery }, undefined, { shallow: true });
    },
    [router, managementPermission]
  );

  const loadMembers = useCallback(async () => {
    if (!unit || !canViewMembers) return;
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
  }, [unit, canViewMembers]);

  useEffect(() => {
    if (unit && canViewMembers) {
      loadMembers();
    } else if (ready) {
      setMembers([]);
      setLoading(false);
      setError(null);
    }
  }, [unit, canViewMembers, loadMembers, ready]);

  const handleSubmit = useCallback(
    async (uid: string, update: MemberUpdate) => {
      if (!unit || !managementPermission) return;
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
    [unit, managementPermission]
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

  const manageableRanks = managementPermission?.manageableRanks ?? [];
  const highestRankOption = managementPermission ? getAdditionalRankOption(managementPermission.highestRank) : null;
  const manageableList = managementPermission ? formatManageableRankList(managementPermission.manageableRanks) : "";

  const managementMessage = managementPermission
    ? managementPermission.manageableRanks.length
      ? `Jako ${highestRankOption?.label || "opiekun"} możesz zarządzać członkostwem w ${
          section?.shortLabel || "jednostce"
        } oraz rangami: ${manageableList}.`
      : `Jako ${highestRankOption?.label || "opiekun"} możesz zarządzać członkostwem w ${
          section?.shortLabel || "jednostce"
        }.`
    : "Brak uprawnień do zarządzania tą jednostką.";

  const unitMembers = useMemo(() => {
    if (!unit) return [] as UnitMember[];
    return members.filter((member) => member.units.includes(unit));
  }, [members, unit]);

  const sortedCriminalGroups = useMemo(() => {
    return [...criminalGroups].sort((a, b) => {
      const nameA = a.group?.name || a.title || "";
      const nameB = b.group?.name || b.title || "";
      return nameA.localeCompare(nameB, "pl", { sensitivity: "base" });
    });
  }, [criminalGroups]);

  useEffect(() => {
    if (!section || section.unit !== "gu" || !managementPermission) {
      setCriminalGroups([]);
      setCriminalGroupsError(null);
      setCriminalGroupsLoading(false);
      return;
    }

    setCriminalGroupsLoading(true);
    const groupsQuery = query(collection(db, "dossiers"), where("category", "==", "criminal-group"));
    const unsubscribe = onSnapshot(
      groupsQuery,
      (snapshot) => {
        setCriminalGroups(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })));
        setCriminalGroupsError(null);
        setCriminalGroupsLoading(false);
      },
      (err) => {
        console.error("Nie udało się pobrać grup przestępczych", err);
        setCriminalGroupsError("Nie udało się wczytać grup przestępczych. Spróbuj ponownie później.");
        setCriminalGroupsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [section, managementPermission]);

  const handleGroupSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!section || section.unit !== "gu" || !managementPermission || groupSaving) return;

      const name = groupForm.name.trim();
      const title = groupForm.title.trim();
      const colorName = groupForm.colorName.trim();
      const rawColorHex = groupForm.colorHex.trim();
      const colorHex = rawColorHex.startsWith("#") ? rawColorHex : `#${rawColorHex}`;
      const organizationType = groupForm.organizationType.trim();
      const base = groupForm.base.trim();
      const operations = groupForm.operations.trim();

      if (!name) {
        setGroupFormError("Podaj nazwę grupy.");
        return;
      }

      if (!/^#[0-9a-fA-F]{6}$/.test(colorHex)) {
        setGroupFormError("Kolor (HEX) musi mieć format #RRGGBB.");
        return;
      }

      setGroupFormError(null);
      setGroupSaving(true);

      try {
        const user = auth.currentUser;
        if (!user) throw new Error("Brak zalogowanego użytkownika.");
        const groupRef = doc(collection(db, "dossiers"));
        await setDoc(groupRef, {
          title: title || `Organizacja ${name}`,
          category: "criminal-group",
          group: {
            name,
            colorName,
            colorHex,
            organizationType,
            base,
            operations,
          },
          createdAt: serverTimestamp(),
          createdBy: user.email || "",
          createdByUid: user.uid || "",
        });

        setGroupForm({
          name: "",
          title: "",
          colorName: "",
          colorHex,
          organizationType: "",
          base: "",
          operations: "",
        });
      } catch (err: any) {
        console.error(err);
        setGroupFormError(err?.message || "Nie udało się utworzyć grupy.");
      } finally {
        setGroupSaving(false);
      }
    },
    [groupForm, groupSaving, section, managementPermission]
  );

  return (
    <AuthGate>
      <>
        <Head>
          <title>Panel jednostki — {section?.label || "Jednostka"}</title>
        </Head>
        <Nav />
        <main className="min-h-screen px-4 py-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-6">
            <div className="flex flex-wrap items-center gap-3">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => handleTabChange(tab.id)}
                    className={`nav-pill ${isActive ? "border-white/60 bg-white/15 text-white" : "text-white/60 hover:text-white"}`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {activeTab === "home" && (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <section className="card space-y-5 p-6" data-section="unit-home">
                  <span className="section-chip">
                    <span
                      className="section-chip__dot"
                      style={{ background: section ? section.navColor : "#38bdf8" }}
                      aria-hidden
                    />
                    {tabs[0]?.label || "Strona jednostki"}
                  </span>
                  <div className="space-y-3">
                    <h1 className="text-3xl font-bold tracking-tight">
                      {section ? section.label : "Nieznana jednostka"}
                    </h1>
                    <p className="text-sm text-white/70">
                      Panel informacji pozwala na przygotowanie materiałów i ogłoszeń specyficznych dla jednostki.
                    </p>
                    {!section && (
                      <p className="text-sm text-red-300">Nie znaleziono konfiguracji dla podanej jednostki.</p>
                    )}
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
                    <h2 className="text-base font-semibold text-white">Panel informacji</h2>
                    <p className="mt-2 text-sm text-white/60">
                      Dodaj tutaj kluczowe informacje operacyjne, procedury lub komunikaty dla funkcjonariuszy tej jednostki.
                    </p>
                  </div>
                </section>

                <aside className="card space-y-5 p-6" data-section="unit-roster">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold text-white">Funkcjonariusze jednostki</h2>
                    <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">
                      {canViewMembers ? unitMembers.length : 0}
                    </span>
                  </div>
                  {loading ? (
                    <p className="text-sm text-white/60">Ładowanie danych...</p>
                  ) : !canViewMembers ? (
                    <p className="text-sm text-white/60">
                      Nie masz uprawnień do podglądu listy funkcjonariuszy tej jednostki.
                    </p>
                  ) : unitMembers.length === 0 ? (
                    <p className="text-sm text-white/60">Brak przypisanych funkcjonariuszy.</p>
                  ) : (
                    <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                      {unitMembers.map((member) => (
                        <div
                          key={member.uid}
                          className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                        >
                          <div>
                            <p className="text-sm font-semibold text-white">{member.fullName}</p>
                            <p className="text-xs text-white/60">
                              {member.login} • {ROLE_LABELS[member.role] || member.role}
                            </p>
                          </div>
                          {member.badgeNumber ? (
                            <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/70">
                              #{member.badgeNumber}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </aside>
              </div>
            )}

            {activeTab === "management" && (
              <div className="grid gap-6">
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
                    <p className="text-sm text-white/70">{managementMessage}</p>
                  </div>

                  {!section && (
                    <div className="text-sm text-red-300">Nie znaleziono konfiguracji dla podanej jednostki.</div>
                  )}

                  {ready && !managementPermission && section && (
                    <div className="text-sm text-red-300">Nie masz uprawnień do zarządzania tą jednostką.</div>
                  )}

                  {managementPermission && (
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

                {section?.unit === "gu" && managementPermission && (
                  <div className="grid gap-6">
                    <div className="card bg-gradient-to-br from-fuchsia-900/85 via-indigo-900/80 to-slate-900/85 p-6 text-white shadow-xl">
                      <h2 className="text-xl font-semibold">Gang Unit — rejestr organizacji</h2>
                      <p className="text-sm text-white/70">
                        Zarządzaj profilem grup przestępczych obserwowanych przez jednostkę. Dodawaj nowe wpisy, aktualizuj
                        informacje operacyjne i kieruj funkcjonariuszy do odpowiednich kart.
                      </p>
                    </div>

                    <form className="card bg-white/95 p-6 shadow" onSubmit={handleGroupSubmit}>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="grid gap-1 text-sm">
                          <span className="font-semibold text-slate-700">Nazwa grupy *</span>
                          <input
                            className="input bg-white"
                            value={groupForm.name}
                            onChange={(e) => setGroupForm((prev) => ({ ...prev, name: e.target.value }))}
                            placeholder="np. Vagos"
                            required
                          />
                        </label>
                        <label className="grid gap-1 text-sm">
                          <span className="font-semibold text-slate-700">Tytuł (opcjonalnie)</span>
                          <input
                            className="input bg-white"
                            value={groupForm.title}
                            onChange={(e) => setGroupForm((prev) => ({ ...prev, title: e.target.value }))}
                            placeholder="np. Organizacja Vagos"
                          />
                        </label>
                        <label className="grid gap-1 text-sm">
                          <span className="font-semibold text-slate-700">Kolor — nazwa</span>
                          <input
                            className="input bg-white"
                            value={groupForm.colorName}
                            onChange={(e) => setGroupForm((prev) => ({ ...prev, colorName: e.target.value }))}
                            placeholder="np. Żółta"
                          />
                        </label>
                        <label className="grid gap-1 text-sm">
                          <span className="font-semibold text-slate-700">Kolor — HEX *</span>
                          <div className="flex items-center gap-3">
                            <input
                              className="input bg-white"
                              value={groupForm.colorHex}
                              onChange={(e) => setGroupForm((prev) => ({ ...prev, colorHex: e.target.value }))}
                              placeholder="#7c3aed"
                              pattern="#?[0-9a-fA-F]{6}"
                              required
                            />
                            <span
                              className="h-10 w-10 rounded-full border border-slate-300"
                              style={{
                                background: /^#?[0-9a-fA-F]{6}$/i.test(groupForm.colorHex.trim())
                                  ? groupForm.colorHex.trim().startsWith("#")
                                    ? groupForm.colorHex.trim()
                                    : `#${groupForm.colorHex.trim()}`
                                  : "#7c3aed",
                              }}
                            />
                          </div>
                        </label>
                        <label className="grid gap-1 text-sm">
                          <span className="font-semibold text-slate-700">Rodzaj organizacji</span>
                          <input
                            className="input bg-white"
                            value={groupForm.organizationType}
                            onChange={(e) => setGroupForm((prev) => ({ ...prev, organizationType: e.target.value }))}
                            placeholder="np. Gang uliczny"
                          />
                        </label>
                        <label className="grid gap-1 text-sm">
                          <span className="font-semibold text-slate-700">Baza operacyjna</span>
                          <input
                            className="input bg-white"
                            value={groupForm.base}
                            onChange={(e) => setGroupForm((prev) => ({ ...prev, base: e.target.value }))}
                            placeholder="np. Grove Street"
                          />
                        </label>
                      </div>
                      <label className="mt-4 grid gap-1 text-sm">
                        <span className="font-semibold text-slate-700">Zakres działalności</span>
                        <textarea
                          className="input min-h-[120px] bg-white"
                          value={groupForm.operations}
                          onChange={(e) => setGroupForm((prev) => ({ ...prev, operations: e.target.value }))}
                          placeholder="Opis działań, np. handel narkotykami, bronią, napady"
                        />
                      </label>
                      {groupFormError && (
                        <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                          {groupFormError}
                        </div>
                      )}
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <span className="text-xs text-slate-500">Pola oznaczone * są wymagane.</span>
                        <button
                          type="submit"
                          className="btn bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-60"
                          disabled={groupSaving}
                        >
                          {groupSaving ? "Zapisywanie..." : "Dodaj grupę"}
                        </button>
                      </div>
                    </form>

                    {criminalGroupsError && (
                      <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                        {criminalGroupsError}
                      </div>
                    )}

                    {criminalGroupsLoading ? (
                      <div className="card bg-white/10 p-5 text-sm text-white/70">Wczytywanie profili grup...</div>
                    ) : sortedCriminalGroups.length === 0 ? (
                      <div className="card bg-white/10 p-5 text-sm text-white/70">
                        Brak zapisanych grup przestępczych. Dodaj pierwszą organizację, aby rozpocząć ewidencję.
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2">
                        {sortedCriminalGroups.map((group) => {
                          const rawColor = group.group?.colorHex || "#7c3aed";
                          const normalizedColor = /^#?[0-9a-fA-F]{6}$/i.test(rawColor)
                            ? rawColor.startsWith("#")
                              ? rawColor
                              : `#${rawColor}`
                            : "#7c3aed";
                          const gradient = `linear-gradient(135deg, ${normalizedColor}33, rgba(15, 23, 42, 0.92))`;
                          const organizationName = group.group?.name || group.title || group.id;
                          return (
                            <div
                              key={group.id}
                              className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-5 text-white shadow-lg"
                              style={{ background: gradient }}
                            >
                              <span
                                className="pointer-events-none absolute inset-0 opacity-40"
                                style={{ background: `radial-gradient(circle at 20% 20%, ${normalizedColor}33, transparent 65%)` }}
                              />
                              <div className="relative flex flex-col gap-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <h3 className="text-xl font-semibold tracking-tight">{organizationName}</h3>
                                    <p className="text-xs uppercase tracking-[0.3em] text-white/70">
                                      Kolorystyka: {group.group?.colorName || "—"}
                                    </p>
                                  </div>
                                  <span className="rounded-full border border-white/30 bg-black/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                                    {group.group?.organizationType || "Nieokreślono"}
                                  </span>
                                </div>
                                <div className="grid gap-2 text-sm text-white/85">
                                  <div className="flex items-center gap-2">
                                    <span aria-hidden>📍</span>
                                    <span>Baza: {group.group?.base || "—"}</span>
                                  </div>
                                  {group.group?.operations && (
                                    <div className="flex items-start gap-2">
                                      <span aria-hidden>⚔️</span>
                                      <span className="leading-relaxed">Zakres działalności: {group.group.operations}</span>
                                    </div>
                                  )}
                                </div>
                                <a
                                  href={`/criminal-groups/${group.id}`}
                                  className="mt-2 inline-flex w-max items-center gap-2 rounded-full border border-white/40 bg-white/15 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:bg-white/25"
                                >
                                  Otwórz kartę
                                </a>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </>
    </AuthGate>
  );
}
