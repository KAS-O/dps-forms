import { useEffect, useState } from "react";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import {
  Role,
  normalizeRole,
  hasBoardAccess,
  DEFAULT_ROLE,
  hasOfficerPrivileges,
} from "@/lib/roles";
import { normalizeAdditionalRanks, normalizeInternalUnits, type AdditionalRank, type InternalUnit } from "@/lib/hr";
export type { Role } from "@/lib/roles";

export function useProfile() {
  const [role, setRole] = useState<Role | null>(null);
  const [login, setLogin] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [badgeNumber, setBadgeNumber] = useState<string | null>(null);
  const [units, setUnits] = useState<InternalUnit[]>([]);
  const [additionalRanks, setAdditionalRanks] = useState<AdditionalRank[]>([]);
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [isAdministrator, setIsAdministrator] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const u = auth.currentUser;
    if (!u) {
      setRole(null);
      setLogin(null);
      setFullName(null);
      setBadgeNumber(null);
      setUnits([]);
      setAdditionalRanks([]);
      setIsAdministrator(false);
      setReady(true);
      return;
    }

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
          role: DEFAULT_ROLE,
          fullName: userLogin, // domyślnie = login, można potem zmienić w panelu
          createdAt: serverTimestamp(),
        });
      }
    });

    const unsub = onSnapshot(ref, (s) => {
      const d = s.data() || {};
      setRole(normalizeRole(d.role));
      setFullName(d.fullName || userLogin);
      if (typeof d.badgeNumber === "string") {
        const trimmed = d.badgeNumber.trim();
        setBadgeNumber(trimmed ? trimmed : null);
      } else {
        setBadgeNumber(null);
      }
      setUnits(normalizeInternalUnits(d.units));
      setAdditionalRanks(normalizeAdditionalRanks(d.additionalRanks ?? d.additionalRank));
      setIsAdministrator(d.isAdministrator === true);
      const rawPhotoURL = typeof d.photoURL === "string" ? d.photoURL.trim() : "";
      setPhotoURL(rawPhotoURL ? rawPhotoURL : null);
      const rawPhotoPath = typeof d.photoPath === "string" ? d.photoPath.trim() : "";
      setPhotoPath(rawPhotoPath ? rawPhotoPath : null);
      setReady(true);
    });

    return () => unsub();
  }, []);

  return {
    role,
    login,
    fullName,
    badgeNumber,
    units,
    additionalRanks,
    photoURL,
    photoPath,
    ready,
    isAdministrator,
  };
}

// Uprawnienia
export const can = {
  seeArchive: (role: Role | null) => !!role,
  deleteArchive: (role: Role | null) => hasBoardAccess(role),
  seeLogs: (role: Role | null) => hasBoardAccess(role),
  manageRoles: (role: Role | null) => hasBoardAccess(role),
  manageFinance: (role: Role | null) => hasBoardAccess(role),
  editRecords: (role: Role | null) => hasOfficerPrivileges(role), // edycja/usuwanie wpisów w teczkach
};
