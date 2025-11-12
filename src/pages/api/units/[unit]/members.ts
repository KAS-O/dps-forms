import type { NextApiRequest, NextApiResponse } from "next";
import {
  type InternalUnit,
  type AdditionalRank,
  normalizeInternalUnits,
  normalizeAdditionalRanks,
  getInternalUnitOption,
  getAdditionalRankOption,
  UNIT_RANK_HIERARCHY,
} from "@/lib/hr";
import {
  type IdentityToolkitUser,
  extractBearerToken,
  identityToolkitRequest,
  fetchFirestoreDocument,
  decodeFirestoreDocument,
  listFirestoreProfiles,
  updateFirestoreProfile,
  mapProfileDocument,
} from "@/lib/server/profiles";

const UNIT_KEYS = new Set<InternalUnit>(["iad", "swat-sert", "usms", "dtu", "gu", "ftd"]);

type MemberResponse = {
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

function parseUnitParam(value: unknown): InternalUnit | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return UNIT_KEYS.has(normalized as InternalUnit) ? (normalized as InternalUnit) : null;
}

async function ensureUnitLeadership(req: NextApiRequest, unit: InternalUnit) {
  const idToken = extractBearerToken(req);
  const lookup = await identityToolkitRequest<{ users: IdentityToolkitUser[] }>("/accounts:lookup", {
    idToken,
  });
  const user = lookup?.users?.[0];
  if (!user?.localId) {
    throw Object.assign(new Error("Nieautoryzowany"), { status: 401 });
  }
  const profileDoc = await fetchFirestoreDocument(`profiles/${user.localId}`, idToken);
  const profileData = decodeFirestoreDocument(profileDoc || {});
  const units = normalizeInternalUnits(profileData.units);
  const additionalRanks = normalizeAdditionalRanks(profileData.additionalRanks ?? profileData.additionalRank);
  const hierarchy = UNIT_RANK_HIERARCHY[unit] || [];

  const leadershipIndices = additionalRanks
    .map((rank) => hierarchy.indexOf(rank))
    .filter((index) => index >= 0);

  if (leadershipIndices.length === 0) {
    throw Object.assign(new Error("Brak uprawnień"), { status: 403 });
  }

  if (!units.includes(unit)) {
    throw Object.assign(new Error("Brak uprawnień"), { status: 403 });
  }

  const level = Math.min(...leadershipIndices);

  return { idToken, uid: user.localId, level, units, additionalRanks, profileData };
}

function buildMemberPayload(raw: MemberResponse): MemberResponse {
  return {
    uid: raw.uid,
    login: raw.login,
    ...(raw.fullName ? { fullName: raw.fullName } : {}),
    ...(raw.badgeNumber ? { badgeNumber: raw.badgeNumber } : {}),
    units: raw.units,
    additionalRanks: raw.additionalRanks,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const unit = parseUnitParam(req.query.unit);
  if (!unit) {
    return res.status(404).json({ error: "Nie znaleziono jednostki." });
  }

  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "GET,PATCH,OPTIONS");
    return res.status(204).end();
  }

  const hierarchy = UNIT_RANK_HIERARCHY[unit] || [];

  try {
    const { idToken, level } = await ensureUnitLeadership(req, unit);

    if (req.method === "GET") {
      const accounts = await listFirestoreProfiles(idToken);
      const members = accounts.map((account) =>
        buildMemberPayload({
          uid: account.uid,
          login: account.login,
          fullName: account.fullName,
          badgeNumber: account.badgeNumber,
          units: account.units,
          additionalRanks: account.additionalRanks,
        })
      );
      return res.status(200).json({ members });
    }

    if (req.method === "PATCH") {
      const payload = req.body as UpdateRequest;
      if (!payload || typeof payload !== "object") {
        return res.status(400).json({ error: "Nieprawidłowe żądanie." });
      }

      const { uid, action, targetType } = payload as any;
      if (typeof uid !== "string" || !uid.trim()) {
        return res.status(400).json({ error: "Brak UID funkcjonariusza." });
      }
      if (action !== "add" && action !== "remove") {
        return res.status(400).json({ error: "Nieprawidłowe działanie." });
      }

      const manageableRanks = new Set(hierarchy.slice(level + 1));

      if (targetType === "unit") {
        if ((payload as any).target !== unit) {
          return res.status(400).json({ error: "Nieprawidłowa jednostka." });
        }
      } else if (targetType === "rank") {
        const targetRank = (payload as any).target as AdditionalRank;
        if (!hierarchy.includes(targetRank)) {
          const option = getAdditionalRankOption(targetRank);
          const label = option?.label || "Wybrany stopień";
          return res.status(400).json({ error: `${label} nie należy do tej jednostki.` });
        }
        if (!manageableRanks.has(targetRank)) {
          return res.status(403).json({ error: "Brak uprawnień do zmiany tego stopnia." });
        }
      } else {
        return res.status(400).json({ error: "Nieobsługiwany typ operacji." });
      }

      const profileDoc = await fetchFirestoreDocument(`profiles/${encodeURIComponent(uid)}`, idToken);
      if (!profileDoc) {
        return res.status(404).json({ error: "Nie znaleziono funkcjonariusza." });
      }

      const profileData = decodeFirestoreDocument(profileDoc);
      let units = normalizeInternalUnits(profileData.units);
      let ranks = normalizeAdditionalRanks(profileData.additionalRanks ?? profileData.additionalRank);

      let unitsChanged = false;
      let ranksChanged = false;

      if (targetType === "unit") {
        const hasUnit = units.includes(unit);
        if (action === "add") {
          if (!hasUnit) {
            units = [...units, unit];
            unitsChanged = true;
          }
        } else {
          if (hasUnit) {
            const targetLeadership = ranks
              .map((rank) => hierarchy.indexOf(rank))
              .filter((index) => index >= 0);
            if (targetLeadership.length > 0) {
              const highestRank = Math.min(...targetLeadership);
              if (highestRank <= level) {
                return res
                  .status(403)
                  .json({ error: "Nie możesz odebrać stopnia funkcjonariuszowi o równym lub wyższym stopniu." });
              }
            }
            units = units.filter((value) => value !== unit);
            unitsChanged = true;
            const unitRankSet = new Set(hierarchy);
            const filtered = ranks.filter((rank) => !unitRankSet.has(rank));
            if (filtered.length !== ranks.length) {
              ranks = filtered;
              ranksChanged = true;
            }
          }
        }
      } else {
        const targetRank = (payload as any).target as AdditionalRank;
        const hasUnit = units.includes(unit);
        if (!hasUnit) {
          const unitOption = getInternalUnitOption(unit);
          const label = unitOption?.abbreviation || unit.toUpperCase();
          return res.status(400).json({ error: `Najpierw dodaj funkcjonariusza do jednostki ${label}.` });
        }
        const hasRank = ranks.includes(targetRank);
        if (action === "add") {
          if (!hasRank) {
            ranks = [...ranks, targetRank];
            ranksChanged = true;
          }
        } else {
          if (hasRank) {
            ranks = ranks.filter((rank) => rank !== targetRank);
            ranksChanged = true;
          }
        }
      }

      if (!unitsChanged && !ranksChanged) {
        return res.status(200).json({
          member: buildMemberPayload({
            uid,
            login: profileData.login || uid,
            fullName: profileData.fullName,
            badgeNumber: typeof profileData.badgeNumber === "string" ? profileData.badgeNumber : undefined,
            units,
            additionalRanks: ranks,
          }),
        });
      }

      const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
      if (unitsChanged) {
        updates.units = units;
      }
      if (ranksChanged) {
        updates.additionalRanks = ranks;
        updates.additionalRank = ranks[0] ?? null;
      }

      await updateFirestoreProfile(uid, updates, idToken);

      profileData.units = units;
      profileData.additionalRanks = ranks;
      profileData.additionalRank = ranks[0] ?? null;

      const mapped = mapProfileDocument(uid, profileData);

      return res.status(200).json({
        member: buildMemberPayload({
          uid: mapped.uid,
          login: mapped.login,
          fullName: mapped.fullName,
          badgeNumber: mapped.badgeNumber,
          units: mapped.units,
          additionalRanks: mapped.additionalRanks,
        }),
      });
    }

    res.setHeader("Allow", "GET,PATCH,OPTIONS");
    return res.status(405).end();
  } catch (error: any) {
    const status = typeof error?.status === "number" ? error.status : 500;
    const message = error?.message || "Błąd serwera";
    if (status >= 500) {
      console.error("Unit members API error:", error);
    }
    return res.status(status).json({ error: message });
  }
}
