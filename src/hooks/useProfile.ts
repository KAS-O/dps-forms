import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";

export type Role = "director" | "chief" | "senior" | "agent" | "rookie";

export function useProfile() {
  const [role, setRole] = useState<Role | null>(null);
  const [login, setLogin] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const u = auth.currentUser;
    if (!u) { setReady(true); return; }

    const email = u.email || "";
    const domain = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dps.local";
    const suffix = `@${domain}`;
    const userLogin = email.endsWith(suffix) ? email.slice(0, -suffix.length) : email;
    setLogin(userLogin);

    const ref = doc(db, "profiles", u.uid);
    // Jeśli brak profilu – utwórz z rolą "rookie" (pierwsze logowanie)
    getDoc(ref).then(async (snap) => {
      if (!snap.exists()) {
        await setDoc(ref, { login: userLogin, role: "rookie" as Role, createdAt: new Date() });
      }
    });

    const unsub = onSnapshot(ref, (s) => {
      const r = (s.data()?.role || "rookie") as Role;
      setRole(r);
      setReady(true);
    });

    return () => unsub();
  }, []);

  return { role, login, ready };
}

export const can = {
  seeArchive: (role: Role | null) => role && ["director", "chief", "senior", "agent"].includes(role),
  deleteArchive: (role: Role | null) => role && ["director", "chief"].includes(role),
  seeLogs: (role: Role | null) => role && ["director", "chief"].includes(role),
  manageRoles: (role: Role | null) => role && ["director", "chief"].includes(role),
};
