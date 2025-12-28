import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  writeBatch,
} from "firebase/firestore";
import type { DocumentData, QueryDocumentSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useProfile } from "@/hooks/useProfile";
import { useLogWriter } from "@/hooks/useLogWriter";
import { useDialog } from "@/components/DialogProvider";
import { useSessionActivity } from "@/components/ActivityLogger";
import { hasOfficerAccess } from "@/lib/roles";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { VirtualizedList } from "@/components/VirtualizedList";
import dynamic from "next/dynamic";

const DOSSIER_PAGE_SIZE = 100;

const UnitsPanel = dynamic(
  () => import("@/components/UnitsPanel").then((mod) => mod.UnitsPanel || mod.default),
  {
    ssr: false,
    loading: () => <div className="card p-4">Ładowanie panelu jednostek...</div>,
  }
);

const AccountPanel = dynamic(
  () => import("@/components/AccountPanel").then((mod) => mod.AccountPanel || mod.default),
  {
    ssr: false,
    loading: () => <div className="card p-4">Ładowanie profilu użytkownika...</div>,
  }
);

export default function Dossiers() {
  const [list, setList] = useState<any[]>([]);
  const [dossierCursor, setDossierCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [dossierHasMore, setDossierHasMore] = useState(false);
  const [dossierLoading, setDossierLoading] = useState(true);
  const [dossierLoadingMore, setDossierLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [qtxt, setQ] = useState("");
  const [form, setForm] = useState({ first: "", last: "", cid: "" });
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { role, adminPrivileges } = useProfile();
  const canManageDossiers = adminPrivileges || hasOfficerAccess(role);
  const { confirm, alert } = useDialog();
  const { logActivity, session } = useSessionActivity();
  const { writeLog } = useLogWriter();
  const accentPalette = ["#a855f7", "#38bdf8", "#f97316", "#22c55e", "#ef4444", "#eab308"];

  const loadDossiersPage = useCallback(
    async (cursor: QueryDocumentSnapshot<DocumentData> | null, append: boolean) => {
      const constraints = [orderBy("createdAt", "desc"), limit(DOSSIER_PAGE_SIZE)];
      if (cursor) {
        constraints.push(startAfter(cursor));
      }
      const snapshot = await getDocs(query(collection(db, "dossiers"), ...constraints));
      const docs = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

      setList((prev) => {
        const merged = append ? [...prev, ...docs] : docs;
        const unique = new Map<string, any>();
        merged.forEach((entry) => unique.set(entry.id, entry));
        return Array.from(unique.values());
      });
      setDossierCursor(snapshot.docs[snapshot.docs.length - 1] ?? null);
      setDossierHasMore(snapshot.size === DOSSIER_PAGE_SIZE);
      setListError(null);
    },
    []
  );

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setDossierLoading(true);
      try {
        await loadDossiersPage(null, false);
      } catch (error) {
        console.error("Nie udało się pobrać teczek", error);
        if (!mounted) return;
        setListError("Nie udało się pobrać teczek.");
      } finally {
        if (mounted) {
          setDossierLoading(false);
        }
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [loadDossiersPage]);

  const loadMoreDossiers = useCallback(async () => {
    if (!dossierHasMore || dossierLoadingMore) return;
    setDossierLoadingMore(true);
    try {
      await loadDossiersPage(dossierCursor, true);
    } catch (error) {
      console.error("Nie udało się pobrać kolejnej strony teczek", error);
      setListError("Nie udało się pobrać kolejnej strony teczek.");
    } finally {
      setDossierLoadingMore(false);
    }
  }, [dossierCursor, dossierHasMore, dossierLoadingMore, loadDossiersPage]);

  const filtered = useMemo(() => {
    const l = qtxt.toLowerCase();
    return list
      .filter((x) => x.category !== "criminal-group")
      .filter((x) =>
        (x.first || "").toLowerCase().includes(l) ||
        (x.last || "").toLowerCase().includes(l) ||
        (x.cid || "").toLowerCase().includes(l) ||
        (x.title || "").toLowerCase().includes(l)
      );
  }, [qtxt, list]);

  const create = async () => {
    try {
      setErr(null);
      setOk(null);
      setCreating(true);
      const user = auth.currentUser;

      const first = form.first.trim();
      const last = form.last.trim();
      const cid = form.cid.trim();
      if (!first || !last || !cid) {
        setErr("Uzupełnij imię, nazwisko i CID.");
        return;
      }
      const normalizedCid = cid.toLowerCase();
      if (list.some((d) => (d.cid || "").toString().toLowerCase() === normalizedCid)) {
        setErr("Teczka z tym CID już istnieje.");
        return;
      }
      const title = `Akta ${first} ${last} CID:${cid}`;
      const dossierId = normalizedCid;
      const dossierRef = doc(db, "dossiers", dossierId);
      await runTransaction(db, async (tx) => {
        const existing = await tx.get(dossierRef);
        if (existing.exists()) {
          throw new Error("Teczka z tym CID już istnieje.");
        }
        tx.set(dossierRef, {
          first,
          last,
          cid,
          title,
          createdAt: serverTimestamp(),
          createdBy: user?.email || "",
          createdByUid: user?.uid || "",
        });
      });
      const timestamp = serverTimestamp();
      await writeLog({
        type: "dossier_create",
        section: "teczki",
        action: "dossier.create",
        message: `Utworzono teczkę ${first} ${last} (CID ${cid}).`,
        details: {
          imie: first,
          nazwisko: last,
          cid,
          tytul: title,
        },
        first,
        last,
        cid,
        createdAt: timestamp,
        dossierId,
      });
      await loadDossiersPage(null, false);
      setForm({ first: "", last: "", cid: "" });
      setOk("Teczka została utworzona.");
    } catch (e: any) {
      setErr(e?.message || "Nie udało się utworzyć teczki");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (dossierId: string) => {
    if (!canManageDossiers) {
      await alert({
        title: "Brak uprawnień",
        message: "Teczki mogą usuwać tylko funkcjonariusze (Solo Cadet i Cadet są wyłączeni).",
        tone: "info",
      });
      return;
    }
    const ok = await confirm({
      title: "Usuń teczkę",
      message: "Czy na pewno chcesz usunąć tę teczkę wraz ze wszystkimi wpisami?",
      confirmLabel: "Usuń",
      tone: "danger",
    });
    if (!ok) return;
    try {
      setErr(null);
      setOk(null);
      setDeletingId(dossierId);
      const recordsSnap = await getDocs(collection(db, "dossiers", dossierId, "records"));
      const batch = writeBatch(db);
      recordsSnap.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      batch.delete(doc(db, "dossiers", dossierId));
      await batch.commit();
      const dossier = list.find((item) => item.id === dossierId);
      await writeLog({
        type: "dossier_delete",
        section: "teczki",
        action: "dossier.delete",
        message: `Usunięto teczkę ${dossier?.title || dossierId} wraz z ${recordsSnap.size} wpisami.`,
        details: {
          cid: dossier?.cid || dossierId,
          tytul: dossier?.title || null,
          imie: dossier?.first || null,
          nazwisko: dossier?.last || null,
          "liczba wpisów": recordsSnap.size,
        },
        dossierId,
        removedRecords: recordsSnap.size,
      });
      setOk("Teczka została usunięta.");
      setList((prev) => prev.filter((entry) => entry.id !== dossierId));
    } catch (e: any) {
      setErr(e?.message || "Nie udało się usunąć teczki.");
    } finally {
      setDeletingId(null);
    }
  };


  return (
    <AuthGate>
      <>
        <Head><title>LSPD 77RP — Teczki</title></Head>
        <Nav showSidebars={false} />
        <DashboardLayout
          left={<UnitsPanel />}
          center={(
            <section className="grid gap-6" data-section="dossiers">
              <div className="card p-6 space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <span className="section-chip">
                      <span className="section-chip__dot" style={{ background: "#a855f7" }} />
                      Teczki
                    </span>
                    <div>
                      <h1 className="text-3xl font-semibold tracking-tight">Archiwum teczek osobowych</h1>
                      <p className="text-sm text-beige-100/75">
                        Wyszukaj osobę po danych identyfikacyjnych i przejdź do jej szczegółowej dokumentacji.
                      </p>
                    </div>
                  </div>
                  <div className="w-full md:w-80">
                    <input
                      className="input"
                      placeholder="Szukaj po imieniu, nazwisku lub numerze CID..."
                      value={qtxt}
                      onChange={(e) => setQ(e.target.value)}
                    />
                  </div>
                </div>
                {err && <div className="card p-3 bg-red-50 text-red-700 mb-3">{err}</div>}
                {ok && <div className="card p-3 bg-green-50 text-green-700 mb-3">{ok}</div>}
                <div className="grid gap-3">
                  <h2 className="text-xs uppercase tracking-[0.3em] text-beige-100/60">Teczki osób</h2>
                  {listError && <div className="card p-3 bg-red-50 text-red-700">{listError}</div>}
                  {dossierLoading && <div className="text-sm text-beige-700">Wczytywanie teczek...</div>}
                  {!dossierLoading && filtered.length === 0 && (
                    <div className="card p-4 text-sm text-beige-100/70" data-section="dossiers">
                      Nie znaleziono teczki spełniającej kryteria wyszukiwania.
                    </div>
                  )}
                  {filtered.length > 0 && (
                    <VirtualizedList
                      items={filtered}
                      itemKey={(item) => item.id}
                      estimateSize={140}
                      overscan={6}
                      style={{ maxHeight: "70vh", minHeight: "320px" }}
                      renderItem={(d, index) => {
                        const accent = accentPalette[index % accentPalette.length];
                        return (
                          <div className="mb-2">
                            <div
                              key={d.id}
                              className="card p-4 transition hover:-translate-y-0.5"
                              data-section="dossiers"
                              style={{
                                borderColor: `${accent}90`,
                                boxShadow: `0 26px 60px -28px ${accent}aa`,
                              }}
                            >
                              <a
                                className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
                                href={`/dossiers/${d.id}`}
                                onClick={() => {
                                  if (!session) return;
                                  void logActivity({
                                    type: "dossier_link_open",
                                    dossierId: d.id,
                                    dossierTitle: d.title,
                                    dossierCid: d.cid,
                                  });
                                }}
                              >
                                <div>
                                  <div className="font-semibold text-lg flex items-center gap-2">
                                    <span className="text-base" aria-hidden>📁</span>
                                    {d.title}
                                  </div>
                                  <div className="text-sm text-beige-100/75">CID: {d.cid}</div>
                                </div>
                                {canManageDossiers && (
                                  <button
                                    className="btn bg-red-700 text-white w-full md:w-auto"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      remove(d.id);
                                    }}
                                    disabled={deletingId === d.id}
                                  >
                                    {deletingId === d.id ? "Usuwanie..." : "Usuń"}
                                  </button>
                                )}
                              </a>
                            </div>
                          </div>
                        );
                      }}
                    />
                  )}
                  {dossierHasMore && (
                    <div className="flex justify-center">
                      <button className="btn" onClick={loadMoreDossiers} disabled={dossierLoadingMore}>
                        {dossierLoadingMore ? "Ładowanie..." : "Załaduj więcej"}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="card p-6 space-y-4">
                <div>
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <span className="text-2xl" aria-hidden>✨</span>
                    Załóż nową teczkę
                  </h2>
                  <p className="text-sm text-beige-100/70">
                    Wypełnij podstawowe dane identyfikacyjne, aby rozpocząć dokumentację osoby.
                  </p>
                </div>
                <div className="grid md:grid-cols-3 gap-2">
                  <input
                    className="input"
                    placeholder="Imię"
                    value={form.first}
                    onChange={(e) => setForm({ ...form, first: e.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="Nazwisko"
                    value={form.last}
                    onChange={(e) => setForm({ ...form, last: e.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="CID"
                    value={form.cid}
                    onChange={(e) => setForm({ ...form, cid: e.target.value })}
                  />
                </div>
                <button className="btn w-full md:w-auto" onClick={create} disabled={creating}>
                  {creating ? "Tworzenie..." : "Utwórz teczkę"}
                </button>
              </div>
            </section>
          )}
          right={<AccountPanel />}
        />
      </>
    </AuthGate>
  );
}
