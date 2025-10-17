import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { Role, normalizeRole } from "@/lib/roles";
export type { Role } from "@/lib/roles";

export function useProfile() {
  const [role, setRole] = useState<Role | null>(null);
  const [login, setLogin] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
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

    getDoc(ref).then(async (snap) => {
      if (!snap.exists()) {
        await setDoc(ref, {
          login: userLogin,
          role: "rookie" as Role,
          fullName: userLogin, // domyślnie = login, można potem zmienić w panelu
          createdAt: serverTimestamp(),
        });
      }
    });

    const unsub = onSnapshot(ref, (s) => {
      const d = s.data() || {};
      setRole(normalizeRole(d.role));
      setFullName(d.fullName || userLogin);
      setReady(true);
    });

    return () => unsub();
  }, []);

  return { role, login, fullName, ready };
}

// Uprawnienia
export const can = {
  seeArchive: (role: Role | null) => !!role && ["director", "chief", "senior", "agent"].includes(role),
  deleteArchive: (role: Role | null) => role === "director",
  seeLogs: (role: Role | null) => !!role && ["director", "chief"].includes(role),
  manageRoles: (role: Role | null) => !!role && ["director", "chief"].includes(role),
  manageFinance: (role: Role | null) => !!role && ["director"].includes(role),
  editRecords: (role: Role | null) => !!role && ["director", "chief"].includes(role), // edycja/usuwanie wpisów w teczkach
};
