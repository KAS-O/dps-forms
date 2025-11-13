import type { NextApiRequest, NextApiResponse } from "next";
import { adminAuth, adminDb, adminFieldValue, adminTimestamp } from "@/lib/firebaseAdmin";
import { normalizeRole, hasBoardAccess } from "@/lib/roles";

const ANNOUNCEMENT_WINDOWS: Record<string, number | null> = {
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "5h": 5 * 60 * 60 * 1000,
  "8h": 8 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "2d": 2 * 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  forever: null,
};

async function verifyManager(req: NextApiRequest) {
  if (!adminAuth || !adminDb || !adminFieldValue || !adminTimestamp) {
    throw new Error("Brak konfiguracji Firebase Admin");
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new Error("Brak tokenu uwierzytelniającego");
  }

  const token = header.slice(7);
  const decoded = await adminAuth.verifyIdToken(token);
  const profileSnap = await adminDb.collection("profiles").doc(decoded.uid).get();
  const profileData = profileSnap.data() || {};
  const role = normalizeRole(profileData.role);
  const adminPrivileges = profileData.adminPrivileges === true;

  if (!hasBoardAccess(role) && !adminPrivileges) {
    const err: Error & { code?: string } = new Error("FORBIDDEN");
    err.code = "FORBIDDEN";
    throw err;
  }

  return { decoded, profileData, role, adminPrivileges };
}

function computeExpiry(duration: string | null | undefined) {
  if (!duration) return null;
  const ms = ANNOUNCEMENT_WINDOWS[duration];
  if (!ms) return null;
  return adminTimestamp.fromMillis(Date.now() + ms);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  let context: Awaited<ReturnType<typeof verifyManager>>;
  try {
    context = await verifyManager(req);
  } catch (e: any) {
    if (e?.code === "FORBIDDEN" || e?.message === "FORBIDDEN") {
      return res.status(403).json({ error: "Brak uprawnień" });
    }
    return res.status(401).json({ error: e?.message || "Nieautoryzowany" });
  }

  if (!adminAuth || !adminDb || !adminFieldValue || !adminTimestamp) {
    return res.status(500).json({ error: "Brak konfiguracji Firebase Admin" });
  }

  try {
    if (req.method === "POST") {
      const { message, duration } = req.body || {};
      const trimmed = typeof message === "string" ? message.trim() : "";
      if (!trimmed) {
        return res.status(400).json({ error: "Treść ogłoszenia jest wymagana" });
      }

      const { decoded, profileData } = context;
      const expiresAt = computeExpiry(typeof duration === "string" ? duration : null);

      const login = profileData.login || decoded.email?.split("@")?.[0] || decoded.uid;
      const fullName = profileData.fullName || login;

      await adminDb
        .collection("configs")
        .doc("announcement")
        .set({
          message: trimmed,
          duration: typeof duration === "string" ? duration : null,
          expiresAt: expiresAt ?? null,
          createdAt: adminFieldValue.serverTimestamp(),
          createdBy: login,
          createdByUid: decoded.uid,
          createdByName: fullName,
        });

      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      await adminDb.collection("configs").doc("announcement").delete();
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "POST,DELETE");
    return res.status(405).end();
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "Błąd serwera" });
  }
}
