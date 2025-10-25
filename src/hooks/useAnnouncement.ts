import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import { doc, onSnapshot, Timestamp } from "firebase/firestore";

export type Announcement = {
  message: string;
  duration?: string | null;
  expiresAt: Timestamp | null;
  expiresAtDate: Date | null;
  createdAt?: Timestamp | null;
  createdAtDate?: Date | null;
  createdBy?: string | null;
  createdByName?: string | null;
};

function normalizeTimestamp(value: unknown): Timestamp | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  if (typeof (value as any)?.toDate === "function") {
    try {
      const date = (value as Timestamp).toDate();
      if (date instanceof Date && !Number.isNaN(date.getTime())) {
        return Timestamp.fromDate(date);
      }
    } catch (error) {
      console.warn("Nieprawidłowa wartość znacznika czasu w ogłoszeniu:", error);
    }
    return null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return Timestamp.fromDate(date);
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
        const expiresAtTimestamp = normalizeTimestamp(data.expiresAt);
        const createdAtTimestamp = normalizeTimestamp(data.createdAt);
        const expiresAtDate = expiresAtTimestamp?.toDate() ?? null;
        if (expiresAtDate && expiresAtDate < new Date()) {
          setAnnouncement(null);
          return;
        }
        setAnnouncement({
          message: data.message as string,
          duration: data.duration ?? null,
          expiresAt: expiresAtTimestamp,
          expiresAtDate,
          createdAt: createdAtTimestamp,
          createdAtDate: createdAtTimestamp?.toDate() ?? null,
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

  const isActive = useMemo(() => {
    if (!announcement) return false;
    if (!announcement.expiresAtDate) return true;
    return announcement.expiresAtDate.getTime() >= Date.now();
  }, [announcement]);

  return { announcement: isActive ? announcement : null };
}
