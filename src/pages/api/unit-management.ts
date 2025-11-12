import type { NextApiRequest, NextApiResponse } from "next";
import {
  FIREBASE_API_KEY,
  FIREBASE_PROJECT_ID,
  extractBearerToken,
  identityToolkitRequest,
  fetchFirestoreDocument,
  decodeFirestoreDocument,
  updateFirestoreProfile,
  type IdentityToolkitUser,
} from "@/lib/server/firebaseRest";
import {
  normalizeAdditionalRanks,
  normalizeInternalUnits,
  getAdditionalRankOption,
  type AdditionalRank,
  type InternalUnit,
} from "@/lib/hr";
import {
  getUnitPanel,
  getUnitPermissionLevel,
  getUnitRankCategory,
  getAllUnitRanks,
} from "@/lib/unitAccess";

type UnitAction = "add-member" | "remove-member" | "assign-rank" | "remove-rank";

type UnitManagerContext = {
  idToken: string;
  uid: string;
  level: number;
  units: InternalUnit[];
  ranks: AdditionalRank[];
};

async function ensureUnitManager(
  req: NextApiRequest,
  unit: InternalUnit
): Promise<UnitManagerContext> {
  const idToken = extractBearerToken(req);
  const lookup = await identityToolkitRequest<{ users: IdentityToolkitUser[] }>("/accounts:lookup", {
    idToken,
  });
  const user = lookup?.users?.[0];
  if (!user?.localId) {
    throw Object.assign(new Error("Nieautoryzowany"), { status: 401 });
  }
  const profileDoc = await fetchFirestoreDocument(`profiles/${encodeURIComponent(user.localId)}`, idToken);
  if (!profileDoc) {
    throw Object.assign(new Error("Brak profilu użytkownika"), { status: 403 });
  }
  const profileData = decodeFirestoreDocument(profileDoc);
  const units = normalizeInternalUnits(profileData.units);
  const ranks = normalizeAdditionalRanks(profileData.additionalRanks ?? profileData.additionalRank);
  const level = getUnitPermissionLevel(unit, units, ranks);
  if (level < 1) {
    throw Object.assign(new Error("Brak dostępu do tej jednostki"), { status: 403 });
  }
  return { idToken, uid: user.localId, level, units, ranks };
}

type TargetProfile = {
  uid: string;
  units: InternalUnit[];
  ranks: AdditionalRank[];
};

async function loadTargetProfile(
  targetUid: string,
  idToken: string
): Promise<TargetProfile | null> {
  const profileDoc = await fetchFirestoreDocument(`profiles/${encodeURIComponent(targetUid)}`, idToken);
  if (!profileDoc) return null;
  const profileData = decodeFirestoreDocument(profileDoc);
  return {
    uid: targetUid,
    units: normalizeInternalUnits(profileData.units),
    ranks: normalizeAdditionalRanks(profileData.additionalRanks ?? profileData.additionalRank),
  };
}

function uniqueInternalUnits(values: InternalUnit[]): InternalUnit[] {
  const set = new Set<InternalUnit>();
  values.forEach((value) => {
    set.add(value);
  });
  return Array.from(set);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST,OPTIONS");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS");
    return res.status(405).json({ error: "Metoda niedozwolona" });
  }

  if (!FIREBASE_API_KEY || !FIREBASE_PROJECT_ID) {
    return res.status(500).json({
      error:
        "Brak konfiguracji Firebase REST. Ustaw zmienne FIREBASE_REST_API_KEY/NEXT_PUBLIC_FIREBASE_API_KEY oraz FIREBASE_REST_PROJECT_ID/NEXT_PUBLIC_FIREBASE_PROJECT_ID.",
    });
  }

  const { unit: unitRaw, action, targetUid, rank } = req.body || {};

  if (typeof unitRaw !== "string") {
    return res.status(400).json({ error: "Nieprawidłowa jednostka" });
  }

  const panel = getUnitPanel(unitRaw);
  if (!panel) {
    return res.status(400).json({ error: "Nieznana jednostka" });
  }

  const unit = panel.unit;

  if (!action || typeof action !== "string") {
    return res.status(400).json({ error: "Brak akcji" });
  }

  if (!targetUid || typeof targetUid !== "string") {
    return res.status(400).json({ error: "Brak identyfikatora funkcjonariusza" });
  }

  try {
    const manager = await ensureUnitManager(req, unit);
    if (manager.level < 2) {
      return res
        .status(403)
        .json({ error: "Brak uprawnień do zarządzania funkcjonariuszami w tej jednostce." });
    }

    const target = await loadTargetProfile(targetUid, manager.idToken);
    if (!target) {
      return res.status(404).json({ error: "Nie znaleziono profilu funkcjonariusza." });
    }

    const currentTargetLevel = getUnitPermissionLevel(unit, target.units, target.ranks);
    const allUnitRanks = getAllUnitRanks(unit);

    const updates: Record<string, any> = {};
    let updatedUnits = target.units.slice();
    let updatedRanks = target.ranks.slice();

    const ensureMember = () => {
      if (!updatedUnits.includes(unit)) {
        updatedUnits = uniqueInternalUnits([...updatedUnits, unit]);
      }
    };

    switch (action as UnitAction) {
      case "add-member": {
        if (manager.level < 2) {
          throw Object.assign(new Error("Brak uprawnień do dodawania funkcjonariuszy"), { status: 403 });
        }
        if (!updatedUnits.includes(unit)) {
          updatedUnits = uniqueInternalUnits([...updatedUnits, unit]);
        }
        break;
      }
      case "remove-member": {
        if (manager.level < 3) {
          throw Object.assign(new Error("Brak uprawnień do usuwania funkcjonariuszy"), { status: 403 });
        }
        if (currentTargetLevel >= manager.level) {
          throw Object.assign(new Error("Nie możesz usunąć osoby o równych lub wyższych uprawnieniach."), {
            status: 403,
          });
        }
        if (updatedUnits.includes(unit)) {
          updatedUnits = updatedUnits.filter((value) => value !== unit);
        }
        if (updatedRanks.some((value) => allUnitRanks.includes(value))) {
          updatedRanks = updatedRanks.filter((value) => !allUnitRanks.includes(value));
        }
        break;
      }
      case "assign-rank": {
        if (typeof rank !== "string") {
          throw Object.assign(new Error("Nieprawidłowa ranga"), { status: 400 });
        }
        const normalizedRank = rank.trim().toLowerCase() as AdditionalRank;
        const rankOption = getAdditionalRankOption(normalizedRank);
        if (!rankOption || rankOption.unit !== unit) {
          throw Object.assign(new Error("Wybrana ranga nie należy do tej jednostki."), { status: 400 });
        }
        const category = getUnitRankCategory(unit, normalizedRank);
        if (category === "caretaker") {
          throw Object.assign(new Error("Nadawanie tej rangi jest dostępne wyłącznie dla zarządu."), {
            status: 403,
          });
        }
        if (category === "commander" && manager.level < 4) {
          throw Object.assign(new Error("Tylko opiekun jednostki może nadawać rangę dowódczą."), {
            status: 403,
          });
        }
        if (category === "deputy" && manager.level < 3) {
          throw Object.assign(new Error("Brak uprawnień do nadawania tej rangi."), { status: 403 });
        }
        if (!updatedRanks.includes(normalizedRank)) {
          ensureMember();
          updatedRanks = [...updatedRanks, normalizedRank];
        }
        break;
      }
      case "remove-rank": {
        if (typeof rank !== "string") {
          throw Object.assign(new Error("Nieprawidłowa ranga"), { status: 400 });
        }
        const normalizedRank = rank.trim().toLowerCase() as AdditionalRank;
        if (!updatedRanks.includes(normalizedRank)) {
          break;
        }
        const category = getUnitRankCategory(unit, normalizedRank);
        if (category === "caretaker") {
          throw Object.assign(new Error("Nie możesz usunąć tej rangi"), { status: 403 });
        }
        if (category === "commander") {
          if (manager.level < 4) {
            throw Object.assign(new Error("Brak uprawnień do odebrania tej rangi."), { status: 403 });
          }
          if (currentTargetLevel >= manager.level) {
            throw Object.assign(new Error("Nie możesz odebrać rangi osobie o równych uprawnieniach."), {
              status: 403,
            });
          }
        }
        if (category === "deputy" && manager.level < 3) {
          throw Object.assign(new Error("Brak uprawnień do odebrania tej rangi."), { status: 403 });
        }
        updatedRanks = updatedRanks.filter((value) => value !== normalizedRank);
        break;
      }
      default:
        return res.status(400).json({ error: "Nieobsługiwana akcja" });
    }

    const ranksSet = new Set(updatedRanks);
    const normalizedRanks = Array.from(ranksSet);
    const normalizedUnits = uniqueInternalUnits(updatedUnits);

    const changed =
      normalizedUnits.length !== target.units.length ||
      normalizedUnits.some((value, index) => value !== target.units[index]) ||
      normalizedRanks.length !== target.ranks.length ||
      normalizedRanks.some((value, index) => value !== target.ranks[index]);

    if (!changed) {
      return res.status(200).json({ ok: true, message: "Brak zmian" });
    }

    const updatesPayload: Record<string, any> = {
      units: normalizedUnits,
      additionalRanks: normalizedRanks,
      additionalRank: normalizedRanks[0] ?? null,
      updatedAt: new Date().toISOString(),
    };

    await updateFirestoreProfile(target.uid, updatesPayload, manager.idToken);

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    const status = typeof error?.status === "number" ? error.status : 500;
    let message = error?.message || "Błąd serwera";
    if (status === 403) {
      message = error?.message || "Brak uprawnień";
    }
    if (status >= 500) {
      console.error("Unit management error:", error);
    }
    return res.status(status).json({ error: message });
  }
}
