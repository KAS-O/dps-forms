import type { NextApiRequest, NextApiResponse } from "next";
import { adminAuth, adminDb, adminTimestamp } from "@/lib/firebaseAdmin";
import { deriveLoginFromEmail } from "@/lib/login";
import {
  firebaseAdminAvailable,
  verifyIdentityToken,
  writeLogsFallback,
  fetchProfile,
} from "@/lib/firebaseServer";

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
  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST,OPTIONS");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST,OPTIONS");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { token, events } = parseBody(req);
  if (!token || !events || !Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  try {
    let actorLogin = "";
    let actorName = "";
    let actorUid = "";

    if (!firebaseAdminAvailable || !adminAuth || !adminDb || !adminTimestamp) {
      const identity = await verifyIdentityToken(token);
      actorUid = identity.uid;
      actorLogin = deriveLoginFromEmail(identity.email || "");
      const profile = await fetchProfile(identity.uid);
      actorName = (profile?.fullName as string | undefined)?.trim() || identity.displayName || actorLogin;

      const normalizedEvents = events.map((event) => {
        const normalizedUid = (event.uid as string | undefined) || (event.actorUid as string | undefined) || identity.uid;
        const normalizedLogin =
          (event.actorLogin as string | undefined) ||
          (event.login as string | undefined) ||
          actorLogin;
        const normalizedName =
          (event.actorName as string | undefined)?.trim() ||
          (event.name as string | undefined)?.trim() ||
          actorName ||
          normalizedLogin;

        return {
          ...event,
          login: event.login || actorLogin,
          uid: normalizedUid,
          actorUid: normalizedUid,
          actorLogin: normalizedLogin,
          actorName: normalizedName,
        };
      });
      await writeLogsFallback(
        { uid: identity.uid, login: actorLogin, name: actorName },
        normalizedEvents
      );
      return res.status(200).json({ ok: true });
    }

    const decoded = await adminAuth.verifyIdToken(token);
    actorUid = decoded.uid;
    actorLogin = deriveLoginFromEmail(decoded.email || "");
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
    actorName = profileName || (decoded.name || "").trim() || actorLogin;

    const batch = adminDb.batch();

    events.forEach((event) => {
      const normalizedUid = (event.uid as string | undefined) || (event.actorUid as string | undefined) || actorUid;
      const normalizedLogin =
        (event.actorLogin as string | undefined) ||
        (event.login as string | undefined) ||
        actorLogin;
      const normalizedName =
        (event.actorName as string | undefined)?.trim() ||
        (event.name as string | undefined)?.trim() ||
        profileName ||
        (decoded.name || "").trim() ||
        normalizedLogin ||
        actorLogin;

      const sanitized: Record<string, any> = {
        ...event,
        login: event.login || actorLogin,
        uid: normalizedUid,
        actorUid: normalizedUid,
        actorLogin: normalizedLogin,
        actorName: normalizedName,
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
