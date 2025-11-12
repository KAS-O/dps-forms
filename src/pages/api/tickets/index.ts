import type { NextApiRequest, NextApiResponse } from "next";
import {
  createFirestoreDocument,
  decodeFirestoreDocument,
  extractBearerToken,
  fetchFirestoreDocument,
  identityToolkitRequest,
  listFirestoreCollection,
  type IdentityToolkitUser,
} from "@/lib/server/firebaseRest";
import { normalizeRole, hasBoardAccess, type Role } from "@/lib/roles";
import { normalizeDepartment, normalizeInternalUnits, type Department, type InternalUnit } from "@/lib/hr";

const COLLECTION_PATH = "tickets";

function sanitizeMessage(message: unknown): string {
  if (typeof message !== "string") return "";
  const trimmed = message.trim();
  return trimmed.length > 5000 ? trimmed.slice(0, 5000) : trimmed;
}

type TicketResponse = {
  id: string;
  message: string;
  createdAt?: string | null;
  author?: {
    uid?: string;
    login?: string;
    fullName?: string;
    badgeNumber?: string;
    role?: Role;
    department?: Department | null;
    units?: InternalUnit[];
  } | null;
};

async function resolveProfile(user: IdentityToolkitUser | undefined, idToken: string) {
  const uid = user?.localId;
  if (!uid) {
    throw Object.assign(new Error("Nieautoryzowany"), { status: 401 });
  }
  const profileDoc = await fetchFirestoreDocument(`profiles/${uid}`, idToken);
  const profileData = decodeFirestoreDocument(profileDoc);
  const role = normalizeRole(profileData.role);
  const fullName = typeof profileData.fullName === "string" ? profileData.fullName : user?.displayName || "";
  const badgeNumber = typeof profileData.badgeNumber === "string" ? profileData.badgeNumber : "";
  const login = typeof profileData.login === "string" ? profileData.login : user?.email?.split("@")[0] || "";
  const department = normalizeDepartment(profileData.department) ?? null;
  const units = normalizeInternalUnits(profileData.units);
  return { uid, role, fullName, badgeNumber, login, department, units };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const idToken = extractBearerToken(req);
    const lookup = await identityToolkitRequest<{ users: IdentityToolkitUser[] }>("/accounts:lookup", {
      idToken,
    });
    const user = lookup?.users?.[0];
    const profile = await resolveProfile(user, idToken);

    if (req.method === "GET") {
      if (!hasBoardAccess(profile.role)) {
        return res.status(403).json({ error: "Brak uprawnień." });
      }
      const docs = await listFirestoreCollection(COLLECTION_PATH, idToken, { pageSize: 200 });
      const tickets: TicketResponse[] = docs.map((docSnap) => {
        const payload = decodeFirestoreDocument(docSnap);
        const id = docSnap.name?.split("/").pop() || payload.id || "";
        return {
          id,
          message: typeof payload.message === "string" ? payload.message : "",
          createdAt: typeof payload.createdAt === "string" ? payload.createdAt : null,
          author: payload.author && typeof payload.author === "object" ? payload.author : null,
        };
      });
      tickets.sort((a, b) => {
        const timeA = a.createdAt ? Date.parse(a.createdAt) : 0;
        const timeB = b.createdAt ? Date.parse(b.createdAt) : 0;
        return timeB - timeA;
      });
      return res.status(200).json({ tickets });
    }

    if (req.method === "POST") {
      const message = sanitizeMessage(req.body?.message);
      if (!message) {
        return res.status(400).json({ error: "Treść ticketa jest wymagana." });
      }
      await createFirestoreDocument(COLLECTION_PATH, idToken, {
        message,
        createdAt: new Date().toISOString(),
        author: {
          uid: profile.uid,
          login: profile.login,
          fullName: profile.fullName,
          badgeNumber: profile.badgeNumber || null,
          role: profile.role,
          department: profile.department,
          units: profile.units,
        },
        status: "open",
      });
      return res.status(201).json({ ok: true });
    }

    if (req.method === "OPTIONS") {
      res.setHeader("Allow", "GET,POST,OPTIONS");
      return res.status(204).end();
    }

    return res.status(405).json({ error: "Metoda niedozwolona." });
  } catch (error: any) {
    const status = error?.status || 500;
    const message = error?.message || "Wewnętrzny błąd serwera.";
    return res.status(status).json({ error: message });
  }
}
