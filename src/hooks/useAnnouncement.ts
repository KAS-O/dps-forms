import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import { doc, onSnapshot, Timestamp } from "firebase/firestore";

export type Announcement = {
  message: string;
  duration?: string | null;
  expiresAt: Timestamp | Date | string | null;
  expiresAtDate: Date | null;
  createdAt?: Timestamp | null;
  createdBy?: string | null;
  createdByName?: string | null;
};

function resolveTimestamp(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && "toDate" in (value as any) && typeof (value as any).toDate === "function") {
    try {
      const date = (value as Timestamp).toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    } catch (error) {
      console.error("resolveTimestamp: invalid toDate value", error);
      return null;
    }
  }
  return null;
}

export function useAnnouncement() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  useEffect(() => {
    const ref = doc(db, "configs", "announcement");
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as any;
        if (!data?.message) {
          setAnnouncement(null);
          return;
        }

        const expiresAtRaw = data.expiresAt ?? null;
        const expiresAtDate = resolveTimestamp(expiresAtRaw);

        if (expiresAtDate && expiresAtDate < new Date()) {
          setAnnouncement(null);
          return;
        }

        setAnnouncement({
          message: data.message as string,
          duration: data.duration ?? null,
          expiresAt: expiresAtRaw ?? null,
          expiresAtDate,
          createdAt: (data.createdAt as Timestamp) ?? null,
          createdBy: data.createdBy ?? null,
          createdByName: data.createdByName ?? null,
        });
      },
      (error) => {
        console.error("Announcement subscription error:", error);
        setAnnouncement(null);
      }
    );
    return () => unsub();
  }, []);

  const isActive = useMemo(
    () => !!announcement && (!announcement.expiresAtDate || announcement.expiresAtDate >= new Date()),
    [announcement]
  );

  return { announcement: isActive ? announcement : null };
}
