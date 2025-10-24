import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { deleteObject, ref } from "firebase/storage";
import { storage } from "@/lib/firebase";
import { useProfile, can } from "@/hooks/useProfile";
import { UnderlightGlow } from "@/components/UnderlightGlow";

type ArchiveItem = {
  id: string;
  templateName: string;
  userLogin: string;
  createdAt?: any;
  imagePath: string;
  imageUrl: string;
  imagePaths?: string[];
  imageUrls?: string[];
};

const ensureArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return [];
};

export default function ArchivePage() {
  const { role } = useProfile();
  const [items, setItems] = useState<ArchiveItem[]>([]);

  useEffect(() => {
    const q = query(collection(db, "archives"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setItems(
        snap.docs.map((d) => {
          const data = d.data() as any;
          const urls = ensureArray(data.imageUrls);
          const paths = ensureArray(data.imagePaths);
          return {
            id: d.id,
            ...data,
            imageUrl: urls[0] || data.imageUrl,
            imageUrls: urls.length ? urls : ensureArray(data.imageUrl),
            imagePath: paths[0] || data.imagePath,
            imagePaths: paths.length ? paths : ensureArray(data.imagePath),
          } as ArchiveItem;
        })
      );
    });
  }, []);

  const remove = async (id: string, path: string, extraPaths: string[] = []) => {
    if (!can.deleteArchive(role)) return;
    await deleteDoc(doc(db, "archives", id));
    const allPaths = [path, ...extraPaths].filter(Boolean);
    await Promise.all(
      allPaths.map(async (p) => {
        try {
          await deleteObject(ref(storage, p));
        } catch (error) {
          console.warn("Nie udało się usunąć pliku archiwum", error);
        }
      })
    );
  };

  return (
    <AuthGate>
     <Head>
        <title>LSPD 77RP — Archiwum</title>
      </Head>
      <Nav />
      <UnderlightGlow />
      <div className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Archiwum dokumentów</h1>
        <div className="grid gap-4">
          {items.map((it) => {
            const images = it.imageUrls?.length ? it.imageUrls : [it.imageUrl].filter(Boolean);
            return (
              <div key={it.id} className="card p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  {images[0] && (
                    <img src={images[0]} alt="" className="w-24 h-32 object-cover border" />
                  )}
                  <div className="flex-1">
                    <div className="font-semibold">{it.templateName}</div>
                    <div className="text-sm text-beige-700">
                      Wystawił: {it.userLogin} • {it.createdAt?.toDate?.().toLocaleString?.("pl-PL")}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-sm">
                      {images.map((url, idx) => (
                        <a key={`${it.id}-${idx}`} className="btn" href={url} target="_blank" rel="noreferrer">
                          Pobierz stronę {idx + 1}
                        </a>
                      ))}
                    </div>
                  </div>
                  {can.deleteArchive(role) && (
                    <button className="btn" onClick={() => remove(it.id, it.imagePath, it.imagePaths || [])}>
                      Usuń
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {items.length === 0 && <p>Brak pozycji.</p>}
        </div>
      </div>
    </AuthGate>
  );
}
