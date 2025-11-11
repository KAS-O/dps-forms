import { useCallback, useMemo } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { deriveLoginFromEmail } from "@/lib/login";
import { useProfile } from "@/hooks/useProfile";

type LogEntryInput = {
  type: string;
  section: string;
  action: string;
  message: string;
  details?: Record<string, any> | null;
} & Record<string, any>;

export function useLogWriter() {
  const { login, fullName } = useProfile();

  const actor = useMemo(() => {
    const user = auth?.currentUser || null;
    const derivedLogin = deriveLoginFromEmail(user?.email || "");
    const actorLogin = login || derivedLogin || "";
    const actorName = fullName || actorLogin || "Nieznany użytkownik";

    return {
      actorUid: user?.uid || "",
      actorLogin,
      actorName,
    };
  }, [fullName, login]);

  const writeLog = useCallback(
    async (entry: LogEntryInput) => {
      if (!db) {
        console.warn("Brak połączenia z bazą danych — log nie został zapisany.");
        return;
      }
      const { details = null, ...rest } = entry;
      await addDoc(collection(db, "logs"), {
        ...rest,
        details,
        ...actor,
        ts: serverTimestamp(),
      });
    },
    [actor]
  );

  return { writeLog, actor };
}

