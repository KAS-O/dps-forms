import type { NextApiRequest, NextApiResponse } from "next";
import { adminAuth, adminDb, adminTimestamp } from "@/lib/firebaseAdmin";
import { deriveLoginFromEmail } from "@/lib/login";

type ActivityEvent = { type: string; [key: string]: any };

type ActivityLogRequest = {
  token?: string;
  events?: ActivityEvent[];
};

function parseBody(req: NextApiRequest): ActivityLogRequest {
  const body = req.body;
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (error) {
      console.warn("Nie udało się sparsować treści logów aktywności:", error);
      return {};
    }
  }
  return body as ActivityLogRequest;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!adminAuth || !adminDb || !adminTimestamp) {
    return res.status(500).json({ error: "Firebase Admin not configured" });
  }

  const { token, events } = parseBody(req);
  if (!token || !events || !Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const login = deriveLoginFromEmail(decoded.email || "");
    let profileName = "";

    try {
      const profileSnap = await adminDb.collection("profiles").doc(decoded.uid).get();
      if (profileSnap.exists) {
        const fullName = (profileSnap.data()?.fullName as string | undefined) || "";
        profileName = fullName.trim();
      }
    } catch (error) {
      console.warn("Nie udało się pobrać profilu użytkownika dla logów aktywności:", error);
    }

    const batch = adminDb.batch();

    events.forEach((event) => {
      const actorUid = (event.uid as string | undefined) || (event.actorUid as string | undefined) || decoded.uid;
      const actorLogin =
        (event.actorLogin as string | undefined) ||
        (event.login as string | undefined) ||
        login;
      const actorName =
        (event.actorName as string | undefined)?.trim() ||
        (event.name as string | undefined)?.trim() ||
        profileName ||
        (decoded.name || "").trim() ||
        actorLogin ||
        login;

      const sanitized: Record<string, any> = {
        ...event,
        login: event.login || login,
        uid: actorUid,
        actorUid,
        actorLogin,
        actorName,
        ts: adminTimestamp.now(),
      };
      const ref = adminDb.collection("logs").doc();
      batch.set(ref, sanitized, { merge: true });
    });

    await batch.commit();
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error("Nie udało się zapisać logów aktywności:", error);
    return res.status(401).json({ error: error?.message || "Unauthorized" });
  }
}
