import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

export type CriminalGroupDetails = {
  name?: string;
  colorName?: string;
  colorHex?: string;
  organizationType?: string;
  base?: string;
  operations?: string;
};

export type CriminalGroup = {
  id: string;
  title?: string;
  group?: CriminalGroupDetails | null;
};

const BALLAS_INFO: CriminalGroupDetails = {
  name: "Ballas",
  colorName: "Fioletowa",
  colorHex: "#7c3aed",
  organizationType: "Gang uliczny",
  base: "Grove Street",
  operations:
    "Handel narkotykami, handel bronią, handel materiałami wybuchowymi, tworzenie materiałów wybuchowych, napady, wyłudzenia, porwania, strzelaniny, pranie pieniędzy",
};

export function useCriminalGroups() {
  const [groups, setGroups] = useState<CriminalGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ensureBallasExists = async () => {
      try {
        const dossierId = "group-ballas";
        const dossierRef = doc(db, "dossiers", dossierId);
        const snap = await getDoc(dossierRef);
        if (!snap.exists()) {
          const user = auth.currentUser;
          await setDoc(dossierRef, {
            title: "Organizacja Ballas",
            category: "criminal-group",
            group: BALLAS_INFO,
            createdAt: serverTimestamp(),
            createdBy: user?.email || "",
            createdByUid: user?.uid || "",
          });
        } else {
          const currentGroup = snap.data()?.group || {};
          const updatedGroup = { ...BALLAS_INFO, ...currentGroup };
          await setDoc(
            dossierRef,
            {
              title: "Organizacja Ballas",
              category: "criminal-group",
              group: updatedGroup,
            },
            { merge: true }
          );
        }
      } catch (err: any) {
        setError(err?.message || "Nie udało się przygotować danych grupy Ballas.");
      }
    };

    void ensureBallasExists();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "dossiers"), where("category", "==", "criminal-group"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setGroups(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })));
        setLoading(false);
      },
      (err) => {
        setError(err?.message || "Nie udało się pobrać grup przestępczych.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => {
      const nameA = a.group?.name || a.title || "";
      const nameB = b.group?.name || b.title || "";
      return nameA.localeCompare(nameB, "pl");
    });
  }, [groups]);

  return { groups: sortedGroups, loading, error };
}

export function withAlpha(hex: string | undefined, alpha: number): string {
  if (!hex) return `rgba(124, 58, 237, ${alpha})`;
  const normalized = hex.replace(/[^0-9a-f]/gi, "");
  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16);
    const g = parseInt(normalized[1] + normalized[1], 16);
    const b = parseInt(normalized[2] + normalized[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (normalized.length === 6) {
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgba(124, 58, 237, ${alpha})`;
}

