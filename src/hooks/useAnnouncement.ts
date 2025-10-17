import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import { doc, onSnapshot, Timestamp } from "firebase/firestore";

export type Announcement = {
  message: string;
  duration?: string | null;
  expiresAt: Timestamp | null;
  createdAt?: Timestamp | null;
  createdBy?: string | null;
  createdByName?: string | null;
};

export function useAnnouncement() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);

  useEffect(() => {
    const ref = doc(db, "configs", "announcement");
    const unsub = onSnapshot(ref, (snap) => {
      const data = snap.data() as any;
      if (!data?.message) {
        setAnnouncement(null);
        return;
      }
      const expiresAt = data.expiresAt ?? null;
      if (expiresAt && expiresAt.toDate && expiresAt.toDate() < new Date()) {
        setAnnouncement(null);
        return;
      }
      setAnnouncement({
        message: data.message as string,
        duration: data.duration ?? null,
        expiresAt: (data.expiresAt as Timestamp) ?? null,
        createdAt: (data.createdAt as Timestamp) ?? null,
        createdBy: data.createdBy ?? null,
        createdByName: data.createdByName ?? null,
      });
      }, (error) => {
      console.error("Announcement subscription error:", error);
      setAnnouncement(null);
    });
    return () => unsub();
  }, []);

  const isActive = useMemo(() => !!announcement && (!announcement.expiresAt || announcement.expiresAt.toDate() >= new Date()), [announcement]);

  return { announcement: isActive ? announcement : null };
}
