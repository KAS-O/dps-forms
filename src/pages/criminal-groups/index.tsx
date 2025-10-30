import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import AnnouncementSpotlight from "@/components/AnnouncementSpotlight";
import { useSessionActivity } from "@/components/ActivityLogger";

const DEFAULT_GROUP_ID = "group-ballas";

const DEFAULT_GROUP_OPERATIONS = [
  "Handel narkotykami",
  "handel bronią",
  "handel materiałami wybuchowymi",
  "tworzenie materiałów wybuchowych",
  "napady",
  "wyłudzenia",
  "porwania",
  "strzelaniny",
  "pranie pieniędzy",
].join(", ");

const DEFAULT_GROUP_DATA = {
  title: "Organizacja Ballas",
  category: "criminal-group",
  group: {
    name: "Ballas",
    colorName: "Fioletowa",
    colorHex: "#7c3aed",
    organizationType: "Gang uliczny",
    base: "Grove Street",
    operations: DEFAULT_GROUP_OPERATIONS,
  },
};

type CriminalGroup = {
  id: string;
  title?: string;
  group?: {
    name?: string;
    colorHex?: string;
    colorName?: string;
    organizationType?: string;
    base?: string;
    operations?: string;
  } | null;
};

export default function CriminalGroupsPage() {
  const [groups, setGroups] = useState<CriminalGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { session, logActivity } = useSessionActivity();

  useEffect(() => {
    const ensureDefaultGroup = async () => {
      try {
        const dossierRef = doc(db, "dossiers", DEFAULT_GROUP_ID);
        let created = false;
        await runTransaction(db, async (tx) => {
          const existing = await tx.get(dossierRef);
          if (existing.exists()) return;
          const user = auth.currentUser;
          tx.set(dossierRef, {
            ...DEFAULT_GROUP_DATA,
            createdAt: serverTimestamp(),
            createdBy: user?.email || "system",
            createdByUid: user?.uid || "system",
          });
          created = true;
        });
        if (created) {
          await addDoc(collection(db, "logs"), {
            type: "dossier_create",
            dossierId: DEFAULT_GROUP_ID,
            category: "criminal-group",
            groupName: DEFAULT_GROUP_DATA.group.name,
            createdAt: serverTimestamp(),
            ts: serverTimestamp(),
            author: auth.currentUser?.email || "system",
            authorUid: auth.currentUser?.uid || "system",
          });
        }
      } catch (e: any) {
        if (process.env.NODE_ENV !== "production") {
          console.error(e);
        }
      }
    };

    void ensureDefaultGroup();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "dossiers"), where("category", "==", "criminal-group"));
    return onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }));
        docs.sort((a, b) => {
          const nameA = a.group?.name || a.title || "";
          const nameB = b.group?.name || b.title || "";
          return nameA.localeCompare(nameB, "pl", { sensitivity: "base" });
        });
        setGroups(docs as CriminalGroup[]);
        setError(null);
      },
      (err) => {
        setError(err.message || "Nie udało się pobrać grup przestępczych.");
      }
    );
  }, []);

  const enrichedGroups = useMemo(() => groups, [groups]);

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Grupy przestępcze</title>
        </Head>
        <Nav />
        <div className="max-w-6xl mx-auto px-4 py-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid gap-4">
            <div className="card p-4">
              <h1 className="text-xl font-bold mb-2">Grupy przestępcze</h1>
              <p className="text-sm text-beige-700">
                Dedykowana baza organizacji przestępczych. Obecnie dostępna jest wyłącznie główna grupa Ballas.
                Dodawanie nowych grup jest zablokowane — wszystkie informacje uzupełniamy bezpośrednio w teczce grupy.
              </p>
            </div>

            {error && <div className="card p-3 bg-red-50 text-red-700">{error}</div>}

            <div className="grid gap-3">
              {enrichedGroups.map((group) => {
                const href = `/criminal-groups/${group.id}`;
                const accent = group.group?.colorHex || "#7c3aed";
                return (
                  <a
                    key={group.id}
                    href={href}
                    className="card p-4 border-l-4 hover:shadow transition"
                    style={{ borderColor: accent }}
                    onClick={() => {
                      if (!session) return;
                      void logActivity({ type: "dossier_link_open", dossierId: group.id });
                    }}
                  >
                    <div className="flex flex-col gap-1">
                      <div className="text-lg font-semibold">{group.group?.name || group.title}</div>
                      <div className="text-sm text-beige-700">
                        Kolorystyka: {group.group?.colorName || "—"} • Rodzaj: {group.group?.organizationType || "—"}
                      </div>
                      {group.group?.base && (
                        <div className="text-sm text-beige-700">Baza: {group.group.base}</div>
                      )}
                      {group.group?.operations && (
                        <div className="text-sm text-beige-600">Działalność: {group.group.operations}</div>
                      )}
                    </div>
                  </a>
                );
              })}
              {enrichedGroups.length === 0 && !error && (
                <div className="card p-4 text-sm text-beige-700">Brak zdefiniowanych grup przestępczych.</div>
              )}
            </div>
          </div>

          <div className="grid gap-4">
            <div className="card p-4">
              <h2 className="font-semibold text-lg mb-2">Baza Ballas</h2>
              <p className="text-sm text-beige-700">
                Teczka zawiera wszystkie dane operacyjne gangu Ballas, w tym członków, pojazdy, notatki oraz dowody rzeczowe.
                Korzystaj z przycisków w teczce, aby dodawać nowe wpisy w odpowiednich kategoriach.
              </p>
            </div>
            <AnnouncementSpotlight />
          </div>
        </div>
      </>
    </AuthGate>
  );
}
