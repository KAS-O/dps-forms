import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  limit,
  startAfter,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import type { DocumentData, QueryConstraint, QueryDocumentSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useProfile } from "@/hooks/useProfile";
import { useLogWriter } from "@/hooks/useLogWriter";
import { useDialog } from "@/components/DialogProvider";
import { useSessionActivity } from "@/components/ActivityLogger";
import { hasOfficerAccess } from "@/lib/roles";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { VirtualList } from "@/components/VirtualList";

const DOSSIERS_PAGE_SIZE = 100;

const UnitsPanelLazy = dynamic(() => import("@/components/UnitsPanel"), {
  loading: () => <div className="card p-4">Ładowanie panelu jednostek...</div>,
});

const AccountPanelLazy = dynamic(() => import("@/components/AccountPanel"), {
  loading: () => <div className="card p-4">Ładowanie panelu konta...</div>,
});

export default function Dossiers() {
  const [list, setList] = useState<any[]>([]);
  const [qtxt, setQ] = useState("");
  const [form, setForm] = useState({
    first: "",
    last: "",
    cid: "",
    workplace: "",
    skinColor: "",
    nationality: "",
    hairColor: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const { role, adminPrivileges } = useProfile();
  const canManageDossiers = adminPrivileges || hasOfficerAccess(role);
  const { confirm, alert } = useDialog();
  const { logActivity, session } = useSessionActivity();
  const { writeLog } = useLogWriter();
  const accentPalette = ["#a855f7", "#38bdf8", "#f97316", "#22c55e", "#ef4444", "#eab308"];
  const mountedRef = useRef(true);

  const fetchDossiers = useCallback(
    async (after: QueryDocumentSnapshot<DocumentData> | null, append: boolean) => {
      const setBusy = append ? setLoadingMore : setLoading;
      setBusy(true);
      try {
        if (!append) {
          setErr(null);
        }
        const constraints: QueryConstraint[] = [orderBy("createdAt", "desc"), limit(DOSSIERS_PAGE_SIZE)];
        if (after) constraints.push(startAfter(after));
        const snap = await getDocs(query(collection(db, "dossiers"), ...constraints));
        if (!mountedRef.current) return;
        const page = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        setList((prev) => {
          if (!append) return page;
          const existing = new Set(prev.map((item) => item.id));
          const merged = [...prev];
          page.forEach((item) => {
            if (!existing.has(item.id)) {
              merged.push(item);
            }
          });
          return merged;
        });
        setCursor(snap.docs.length ? snap.docs[snap.docs.length - 1] : null);
        setHasMore(snap.size === DOSSIERS_PAGE_SIZE);
      } catch (e: any) {
        console.error("Nie udało się pobrać teczek", e);
        if (!mountedRef.current) return;
        setErr(e?.message || "Nie udało się wczytać teczek. Spróbuj ponownie później.");
        setHasMore(false);
      } finally {
        if (mountedRef.current) {
          setBusy(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    void fetchDossiers(null, false);
    return () => {
      mountedRef.current = false;
    };
  }, [fetchDossiers]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    void fetchDossiers(cursor, true);
  }, [cursor, fetchDossiers, hasMore, loading, loadingMore]);

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

  const dossierListHeight = useMemo(() => {
    if (filtered.length === 0) return 240;
    const estimated = filtered.length * 150;
    return Math.min(720, Math.max(320, estimated));
  }, [filtered.length]);
  const useVirtualDossiers = filtered.length > 25;

  const DossierCard = ({ dossier, index }: { dossier: any; index: number }) => {
    const accent = accentPalette[index % accentPalette.length];
    return (
      <div
        className="card p-4 transition hover:-translate-y-0.5"
        data-section="dossiers"
        style={{
          borderColor: `${accent}90`,
          boxShadow: `0 26px 60px -28px ${accent}aa`,
        }}
      >
        <a
          className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
          href={`/dossiers/${dossier.id}`}
          onClick={() => {
            if (!session) return;
            void logActivity({
              type: "dossier_link_open",
              dossierId: dossier.id,
              dossierTitle: dossier.title,
              dossierCid: dossier.cid,
            });
          }}
        >
          <div>
            <div className="font-semibold text-lg flex items-center gap-2">
              <span className="text-base" aria-hidden>📁</span>
              {dossier.title}
            </div>
            <div className="text-sm text-beige-100/75">CID: {dossier.cid}</div>
          </div>
          {canManageDossiers && (
            <button
              className="btn bg-red-700 text-white w-full md:w-auto"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                remove(dossier.id);
              }}
              disabled={deletingId === dossier.id}
            >
              {deletingId === dossier.id ? "Usuwanie..." : "Usuń"}
            </button>
          )}
        </a>
      </div>
    );
  };

  const create = async () => {
    try {
      setErr(null);
      setOk(null);
      setCreating(true);
      const user = auth.currentUser;

      const first = form.first.trim();
      const last = form.last.trim();
      const cid = form.cid.trim();
      const workplace = form.workplace.trim();
      const skinColor = form.skinColor.trim();
      const nationality = form.nationality.trim();
      const hairColor = form.hairColor.trim();
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
          workplace,
          skinColor,
          nationality,
          hairColor,
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
          miejscePracy: workplace,
          kolorSkory: skinColor,
          narodowosc: nationality,
          kolorWlosow: hairColor,
        },
        first,
        last,
        cid,
        createdAt: timestamp,
        dossierId,
      });
      setList((prev) => {
        const exists = prev.some((item) => item.id === dossierId);
        if (exists) return prev;
        const createdAt = new Date();
        return [
          {
            id: dossierId,
            first,
            last,
            cid,
            title,
            workplace,
            skinColor,
            nationality,
            hairColor,
            createdAt,
            createdBy: user?.email || "",
            createdByUid: user?.uid || "",
          },
          ...prev,
        ];
      });
      setHasMore(true);
      setForm({ first: "", last: "", cid: "", workplace: "", skinColor: "", nationality: "", hairColor: "" });
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
      setList((prev) => prev.filter((item) => item.id !== dossierId));
      setOk("Teczka została usunięta.");
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
          left={<UnitsPanelLazy />}
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
                  {loading && list.length === 0 ? (
                    <div className="card p-4 text-sm text-beige-100/70" data-section="dossiers">
                      Ładowanie teczek...
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="card p-4 text-sm text-beige-100/70" data-section="dossiers">
                      Nie znaleziono teczki spełniającej kryteria wyszukiwania.
                    </div>
                  ) : useVirtualDossiers ? (
                    <VirtualList
                      items={filtered}
                      height={dossierListHeight}
                      estimateItemHeight={150}
                      itemKey={(item) => item.id}
                      renderItem={(item, index) => (
                        <div className="pb-3">
                          <DossierCard dossier={item} index={index} />
                        </div>
                      )}
                    />
                  ) : (
                    filtered.map((d, index) => (
                      <div key={d.id} className="pb-2">
                        <DossierCard dossier={d} index={index} />
                      </div>
                    ))
                  )}
                  {hasMore && (
                    <button className="btn w-full md:w-auto" onClick={loadMore} disabled={loadingMore || loading}>
                      {loadingMore ? "Ładowanie..." : "Załaduj więcej"}
                    </button>
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
                <div className="grid md:grid-cols-2 gap-2">
                  <input
                    className="input"
                    placeholder="Miejsce pracy (opcjonalnie)"
                    value={form.workplace}
                    onChange={(e) => setForm({ ...form, workplace: e.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="Narodowość (opcjonalnie)"
                    value={form.nationality}
                    onChange={(e) => setForm({ ...form, nationality: e.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="Kolor skóry (opcjonalnie)"
                    value={form.skinColor}
                    onChange={(e) => setForm({ ...form, skinColor: e.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="Kolor włosów (opcjonalnie)"
                    value={form.hairColor}
                    onChange={(e) => setForm({ ...form, hairColor: e.target.value })}
                  />
                </div>
                <button className="btn w-full md:w-auto" onClick={create} disabled={creating}>
                  {creating ? "Tworzenie..." : "Utwórz teczkę"}
                </button>
              </div>
            </section>
          )}
          right={<AccountPanelLazy />}
        />
      </>
    </AuthGate>
  );
}
