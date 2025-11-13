import type { NextApiRequest, NextApiResponse } from "next";
import {
  extractBearerToken,
  identityToolkitRequest,
  decodeFirestoreDocument,
  fetchFirestoreDocument,
  listFirestoreCollection,
  patchFirestoreDocument,
  type IdentityToolkitUser,
} from "@/lib/server/firebaseRest";
import {
  type InternalUnit,
  type AdditionalRank,
  normalizeInternalUnits,
  normalizeAdditionalRanks,
  normalizeDepartment,
  type Department,
} from "@/lib/hr";
import { normalizeRole, isHighCommand, type Role } from "@/lib/roles";
import { resolveUnitPermission, getUnitSection } from "@/lib/internalUnits";

const SUPPORTED_UNITS = new Set<InternalUnit>(["iad", "swat-sert", "usms", "dtu", "gu", "ftd"]);

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

type UpdatePayload = {
  uid?: string;
  membership?: boolean;
  ranks?: AdditionalRank[];
};

async function ensureUnitAccess(req: NextApiRequest, unit: InternalUnit) {
  const idToken = extractBearerToken(req);
  const lookup = await identityToolkitRequest<{ users: IdentityToolkitUser[] }>("/accounts:lookup", {
    idToken,
  });
  const user = lookup?.users?.[0];
  if (!user?.localId) {
    throw Object.assign(new Error("Nieautoryzowany"), { status: 401 });
  }
  const profileDoc = await fetchFirestoreDocument(`profiles/${user.localId}`, idToken);
  const profileData = decodeFirestoreDocument(profileDoc);
  const role = normalizeRole(profileData.role);
  const additionalRanks = normalizeAdditionalRanks(profileData.additionalRanks ?? profileData.additionalRank);
  let permission = resolveUnitPermission(unit, additionalRanks);
  if (!permission && isHighCommand(role)) {
    const section = getUnitSection(unit);
    if (section) {
      const hierarchy = section.rankHierarchy.slice();
      if (hierarchy.length > 0) {
        permission = {
          unit,
          highestRank: hierarchy[0],
          manageableRanks: hierarchy,
        };
      }
    }
  }
  if (!permission) {
    throw Object.assign(new Error("Brak uprawnień"), { status: 403 });
  }
  return { idToken, permission };
}

function parseUnitParam(value: string | string[] | undefined): InternalUnit | null {
  const slug = Array.isArray(value) ? value[0] : value;
  if (!slug) return null;
  const normalized = slug.trim().toLowerCase() as InternalUnit;
  return SUPPORTED_UNITS.has(normalized) ? normalized : null;
}

function buildMember(doc: any): UnitMember {
  const payload = decodeFirestoreDocument(doc);
  const uid = doc.name?.split("/").pop() || payload.uid || "";
  const loginRaw = typeof payload.login === "string" ? payload.login.trim() : "";
  const emailLogin =
    typeof payload.email === "string" && payload.email.includes("@")
      ? payload.email.split("@")[0]
      : "";
  const login = loginRaw || emailLogin || uid;
  const fullName = typeof payload.fullName === "string" ? payload.fullName.trim() : login;
  const role = normalizeRole(payload.role);
  const department = normalizeDepartment(payload.department) ?? null;
  const units = normalizeInternalUnits(payload.units);
  const additionalRanks = normalizeAdditionalRanks(payload.additionalRanks ?? payload.additionalRank);
  const badgeNumber = typeof payload.badgeNumber === "string" ? payload.badgeNumber.trim() : undefined;
  return {
    uid,
    login,
    fullName,
    role,
    department,
    units,
    additionalRanks,
    ...(badgeNumber ? { badgeNumber } : {}),
  };
}

function filterManageableRanks(
  requestedRanks: AdditionalRank[],
  manageableRanks: AdditionalRank[]
): AdditionalRank[] {
  const manageableSet = new Set(manageableRanks);
  return requestedRanks.filter((rank) => manageableSet.has(rank));
}

function assertNoHigherRanks(member: UnitMember, unit: InternalUnit, manageableRanks: AdditionalRank[]) {
  const config = getUnitSection(unit);
  if (!config) {
    return;
  }
  const manageableSet = new Set(manageableRanks);
  const higherRanks = config.rankHierarchy.filter((rank) => !manageableSet.has(rank));
  if (!higherRanks.length) {
    return;
  }
  const memberRankSet = new Set(member.additionalRanks);
  const blocking = higherRanks.filter((rank) => memberRankSet.has(rank));
  if (blocking.length) {
    throw Object.assign(
      new Error("Nie możesz usunąć członkostwa funkcjonariusza z wyższymi rangami w jednostce."),
      { status: 403 }
    );
  }
}

function removeUnitRanks(
  ranks: AdditionalRank[],
  unit: InternalUnit,
  manageableRanks: AdditionalRank[]
): AdditionalRank[] {
  const manageableSet = new Set(manageableRanks);
  const config = getUnitSection(unit);
  if (!config) {
    return ranks;
  }
  const unitRankSet = new Set(config.rankHierarchy);
  return ranks.filter((rank) => {
    if (!unitRankSet.has(rank)) return true;
    return !manageableSet.has(rank);
  });
}

function readBody(req: NextApiRequest): UpdatePayload {
  if (req.method !== "PATCH") {
    return {};
  }
  if (!req.body || typeof req.body !== "object") {
    return {};
  }
  return req.body as UpdatePayload;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "GET,PATCH,OPTIONS");
    return res.status(204).end();
  }

  const unit = parseUnitParam(req.query.unit);
  if (!unit) {
    return res.status(404).json({ error: "Nieznana jednostka." });
  }

  if (req.method !== "GET" && req.method !== "PATCH") {
    return res.status(405).json({ error: "Metoda niedozwolona." });
  }

  try {
    const { idToken, permission } = await ensureUnitAccess(req, unit);

    if (req.method === "GET") {
      const documents = await listFirestoreCollection("profiles", idToken, { pageSize: 200 });
      const members = documents.map(buildMember);
      members.sort((a, b) => a.fullName.localeCompare(b.fullName, "pl", { sensitivity: "base" }));
      return res.status(200).json({ members });
    }

    const payload = readBody(req);
    const targetUid = typeof payload.uid === "string" ? payload.uid.trim() : "";
    if (!targetUid) {
      return res.status(400).json({ error: "Wskaż funkcjonariusza do aktualizacji." });
    }
    if (typeof payload.membership !== "boolean") {
      return res.status(400).json({ error: "Brak informacji o członkostwie." });
    }
    const requestedRanks = Array.isArray(payload.ranks)
      ? normalizeAdditionalRanks(payload.ranks)
      : [];
    const manageableRanks = permission.manageableRanks;
    const allowedRanks = filterManageableRanks(requestedRanks, manageableRanks);
    if (allowedRanks.length !== requestedRanks.length) {
      return res.status(400).json({ error: "Próba nadania rangi spoza zakresu uprawnień." });
    }

    const targetDoc = await fetchFirestoreDocument(`profiles/${encodeURIComponent(targetUid)}`, idToken);
    if (!targetDoc) {
      return res.status(404).json({ error: "Nie znaleziono profilu funkcjonariusza." });
    }
    const member = buildMember(targetDoc);

    if (!payload.membership && requestedRanks.length) {
      return res
        .status(400)
        .json({ error: "Nie można przypisać rang funkcjonariuszowi bez członkostwa w jednostce." });
    }

    if (!payload.membership) {
      assertNoHigherRanks(member, unit, manageableRanks);
    }

    const currentUnits = member.units;
    const hasUnit = currentUnits.includes(unit);
    let nextUnits = currentUnits.slice();
    if (payload.membership && !hasUnit) {
      nextUnits.push(unit);
    }
    if (!payload.membership && hasUnit) {
      nextUnits = nextUnits.filter((value) => value !== unit);
    }

    const manageableSet = new Set(manageableRanks);
    let nextRanks = member.additionalRanks.filter((rank) => !manageableSet.has(rank));
    if (payload.membership) {
      allowedRanks.forEach((rank) => {
        if (!nextRanks.includes(rank)) {
          nextRanks.push(rank);
        }
      });
    } else {
      nextRanks = removeUnitRanks(nextRanks, unit, manageableRanks);
    }

    const updates: Record<string, any> = {};
    const normalizedNextUnits = Array.from(new Set(nextUnits));
    const normalizedNextRanks = Array.from(new Set(nextRanks));

    const unitsChanged =
      normalizedNextUnits.length !== member.units.length ||
      normalizedNextUnits.some((value, index) => member.units[index] !== value);
    const ranksChanged =
      normalizedNextRanks.length !== member.additionalRanks.length ||
      normalizedNextRanks.some((value, index) => member.additionalRanks[index] !== value);

    if (unitsChanged) {
      updates.units = normalizedNextUnits;
    }
    if (ranksChanged) {
      updates.additionalRanks = normalizedNextRanks;
      updates.additionalRank = normalizedNextRanks[0] ?? null;
    }

    if (!Object.keys(updates).length) {
      return res.status(200).json({
        member: {
          uid: member.uid,
          units: member.units,
          additionalRanks: member.additionalRanks,
        },
      });
    }

    await patchFirestoreDocument(`profiles/${encodeURIComponent(targetUid)}`, idToken, updates);

    return res.status(200).json({
      member: {
        uid: member.uid,
        units: updates.units ?? member.units,
        additionalRanks: updates.additionalRanks ?? member.additionalRanks,
      },
    });
  } catch (error: any) {
    const status = typeof error?.status === "number" ? error.status : 500;
    const message = error?.message || "Wystąpił nieoczekiwany błąd.";
    return res.status(status).json({ error: message });
  }
}
