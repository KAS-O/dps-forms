import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  doc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useProfile, can } from "@/hooks/useProfile";

type Dossier = {
  id: string;
  first?: string;
  last?: string;
  cid?: string;
  title: string;
  createdAt?: any;
};

const buildTitle = (first: string, last: string, cid: string) =>
  `Akta ${first.trim()} ${last.trim()} CID:${cid.trim()}`;

export default function DossiersPage() {
  const { role, login } = useProfile();

  const [list, setList] = useState<Dossier[]>([]);
  const [qtxt, setQ] = useState("");
  const [form, setForm] = useState({ first: "", last: "", cid: "" });

  // Live-lista teczek (posortowana)
  useEffect(() => {
    const q = query(collection(db, "dossiers"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) =>
      setList(
        snap.docs.map(
          (d) =>
            ({
              id: d.id,
              ...(d.data() as any),
            } as Dossier)
        )
      )
    );
  }, []);

  // Filtrowanie po tytule / imieniu / nazwisku / CID
  const filtered = useMemo(() => {
    const l = qtxt.toLowerCase();
    return list.filter((x) => {
      const t = (x.title || "").toLowerCase();
      const f = (x.first || "").toLowerCase();
      const s = (x.last || "").toLowerCase();
      const c = (x.cid || "").toLowerCase();
      return t.includes(l) || f.includes(l) || s.includes(l) || c.includes(l);
    });
  }, [qtxt, list]);

  // Utworzenie nowej teczki
  const create = async () => {
    const first = form.first.trim();
    const last = form.last.trim();
    const cid = form.cid.trim();
    if (!first || !last || !cid) {
      alert("Uzupełnij Imię, Nazwisko i CID.");
      return;
    }
    const title = buildTitle(first, last, cid);

    await addDoc(collection(db, "dossiers"), {
      first,
      last,
      cid,
      title,
      createdAt: serverTimestamp(),
    });

    await addDoc(collection(db, "logs"), {
      type: "dossier_add",
      title,
      first,
      last,
      cid,
      by: login,
      ts: serverTimestamp(),
    });

    setForm({ first: "", last: "", cid: "" });
  };

  // Edycja teczki (zmiana Imię/Nazwisko/CID + tytułu)
  const edit = async (d: Dossier) => {
    const nf = prompt("Nowe imię:", d.first || "") ?? "";
    const nl = prompt("Nowe nazwisko:", d.last || "") ?? "";
    const nc = prompt("Nowy CID:", d.cid || "") ?? "";
    if (!nf.trim() || !nl.trim() || !nc.trim()) return;

    const newTitle = buildTitle(nf, nl, nc);
    await updateDoc(doc(db, "dossiers", d.id), {
      first: nf.trim(),
      last: nl.trim(),
      cid: nc.trim(),
      title: newTitle,
    });

    await addDoc(collection(db, "logs"), {
      type: "dossier_edit",
      id: d.id,
      title: newTitle,
      first: nf.trim(),
      last: nl.trim(),
      cid: nc.trim(),
      by: login,
      ts: serverTimestamp(),
    });
  };

  // Usuwanie teczki (tylko Director/Chief)
  const remove = async (d: Dossier) => {
    if (!can.manageRoles(role)) {
      alert("Brak uprawnień.");
      return;
    }
    if (!confirm(`Usunąć teczkę: ${d.title}?`)) return;

    // UWAGA: to usuwa tylko dokument teczki. Ewentualne subkolekcje (records) zostaną.
    // Jeśli będziesz chciał twarde usuwanie z subkolekcjami — dam Ci osobny helper (batch/recursive).
    await deleteDoc(doc(db, "dossiers", d.id));

    await addDoc(collection(db, "logs"), {
      type: "dossier_delete",
      id: d.id,
      title: d.title,
      by: login,
      ts: serverTimestamp(),
    });
  };

  return (
    <AuthGate>
      <>
        <Head>
          <title>DPS 77RP — Teczki</title>
        </Head>
        <Nav />

        <div className="max-w-5xl mx-auto px-4 py-6 grid gap-6">
          {/* Lista teczek */}
          <div className="card p-4">
            <h1 className="text-xl font-bold mb-2">Teczki dowodowe</h1>
            <div className="flex gap-2 mb-3">
              <input
                className="input flex-1"
                placeholder="Szukaj po nazwie/imieniu/nazwisku/CID..."
                value={qtxt}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              {filtered.map((d) => (
                <div key={d.id} className="card p-3 flex items-center justify-between">
                  <a className="hover:underline" href={`/dossiers/${d.id}`}>
                    <div className="font-semibold">{d.title}</div>
                    {!!d.cid && (
                      <div className="text-sm text-beige-700">CID: {d.cid}</div>
                    )}
                  </a>

                  <div className="flex items-center gap-2">
                    <button className="btn" onClick={() => edit(d)}>
                      Edytuj
                    </button>
                    {can.manageRoles(role) && (
                      <button
                        className="btn bg-red-700 text-white"
                        onClick={() => remove(d)}
                      >
                        Usuń
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {filtered.length === 0 && <p>Brak teczek.</p>}
            </div>
          </div>

          {/* Formularz tworzenia teczki */}
          <div className="card p-4">
            <h2 className="font-semibold mb-2">Załóż nową teczkę</h2>
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
            <button className="btn mt-3" onClick={create}>
              Utwórz
            </button>
          </div>
        </div>
      </>
    </AuthGate>
  );
}
