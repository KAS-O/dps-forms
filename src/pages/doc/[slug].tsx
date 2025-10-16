import { useRouter } from "next/router";
import Head from "next/head";
import AuthGate from "@/components/AuthGate";
import { TEMPLATES, Template } from "@/lib/templates";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { auth, db, storage } from "@/lib/firebase";
import {
  addDoc,
  collection,
  serverTimestamp,
  getDocs,
  query,
  orderBy,
  doc,
  getDoc,
} from "firebase/firestore";
import { ref, uploadString, getDownloadURL } from "firebase/storage";

const LOGIN_DOMAIN = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dps.local";

type Person = { id: string; fullName?: string; login?: string };

function findTemplate(slug: string | string[] | undefined): Template | undefined {
  if (!slug || typeof slug !== "string") return undefined;
  return TEMPLATES.find((t) => t.slug === slug);
}

export default function DocPage() {
  const router = useRouter();
  const template = useMemo(() => findTemplate(router.query.slug), [router.query.slug]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // teczki
  const [dossiers, setDossiers] = useState<any[]>([]);
  const [dossierId, setDossierId] = useState("");

  // funkcjonariusze (UID-y!)
  const [profiles, setProfiles] = useState<Person[]>([]);
  const [currentUid, setCurrentUid] = useState<string>("");
  const [selectedUids, setSelectedUids] = useState<string[]>([]); // zawsze zawiera currentUid

  const uidToName = (uid: string) => {
    const p = profiles.find((x) => x.id === uid);
    return p?.fullName || p?.login || uid;
  };
  const selectedNames = selectedUids.map(uidToName);
  const requiresDossier = template?.slug === "swiadczenie-spoleczne";
  
  useEffect(() => {
    (async () => {
      // teczki
      const qd = query(collection(db, "dossiers"), orderBy("createdAt", "desc"));
      const sd = await getDocs(qd);
      setDossiers(sd.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));

      // profile
      const sp = await getDocs(query(collection(db, "profiles")));
      const arr = sp.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Person[];
      setProfiles(arr);

      // domyślnie – zalogowany użytkownik
      const authUserUid = auth.currentUser?.uid || "";
      const email = auth.currentUser?.email || "";
      const suffix = `@${LOGIN_DOMAIN}`;
      const loginOnly = email.endsWith(suffix) ? email.slice(0, -suffix.length) : email;
      const me = arr.find((p) => p.login === loginOnly);

      const resolvedUid = me?.id || authUserUid;
      setCurrentUid(resolvedUid);
      setSelectedUids(resolvedUid ? [resolvedUid] : []);
    })();
  }, []);

  if (!template) {
    return (
      <AuthGate>
        <div className="min-h-screen flex items-center justify-center">
          <div className="card p-6"><p>Nie znaleziono szablonu.</p></div>
        </div>
      </AuthGate>
    );
  }

  // auto-uzupełnianie z teczki
  const prefillFromDossier = async (id: string) => {
    try {
      const snap = await getDoc(doc(db, "dossiers", id));
      const data = (snap.data() || {}) as any;

      let fullName = [data.first, data.last].filter(Boolean).join(" ").trim() || "";
      let cid = (data.cid ?? "").toString();

      if (!fullName || !cid) {
        const title: string = (data.title || "") as string;
        const m = title.match(/akta\s+(.+?)\s+cid\s*:\s*([0-9]+)/i);
        if (m) { fullName = fullName || m[1]; cid = cid || m[2]; }
      }

      const nameKey = template?.fields.find((f) => /imi|nazw|osoba|obywatel/i.test(f.label))?.key;
      const cidKey  = template?.fields.find((f) => /cid/i.test(f.label))?.key;

      setValues((v) => ({
        ...v,
        ...(nameKey ? { [nameKey]: fullName } : {}),
        ...(cidKey  ? { [cidKey]:  cid      } : {}),
      }));
    } catch (e) {
      console.warn("prefillFromDossier error:", e);
    }
  };

  // wybór funkcjonariuszy (checkboxy po UID)
  const OfficersPicker = () => (
    <div className="grid gap-1">
      <label className="label">Funkcjonariusze</label>
      <div className="grid xs:grid-cols-1 sm:grid-cols-2 gap-2">
        {profiles.map((p) => {
          const name = p.fullName || p.login || p.id;
          const checked = selectedUids.includes(p.id);
          const isMe = p.id === currentUid;
          return (
            <label key={p.id} className="flex items-center gap-2 p-2 border border-beige-300 rounded">
              <input
                type="checkbox"
                checked={checked}
                disabled={isMe}
                onChange={(e) => {
                  setSelectedUids((prev) => {
                    const s = new Set(prev);
                    if (e.target.checked) s.add(p.id);
                    else s.delete(p.id);
                    if (currentUid) s.add(currentUid); // autor zawsze
                    return Array.from(s);
                  });
                }}
              />
              <span>{name}</span>
            </label>
          );
        })}
      </div>
      <p className="text-xs text-beige-700">
        Domyślnie wybrany jest autor dokumentu (nie można odznaczyć). Możesz dodać pozostałych.
      </p>
    </div>
  );

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setOk(null);
    setErr(null);
    if (requiresDossier && !dossierId) {
      setErr("Ten dokument wymaga powiązania z teczką.");
      return;
    }
    setSending(true);
    try {
      const el = previewRef.current;
      if (!el) throw new Error("Brak podglądu do zrzutu.");

      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      const dataUrl = canvas.toDataURL("image/png");
      const base64 = dataUrl.split(",")[1];

      const filename = `${template.slug}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;

      const email = auth.currentUser?.email || "";
      const suffix = `@${LOGIN_DOMAIN}`;
      const userLogin = email.endsWith(suffix) ? email.slice(0, -suffix.length) : email;

      // 1) Storage
      const storagePath = `archives/${filename}`;
      const sref = ref(storage, storagePath);
      await uploadString(sref, dataUrl, "data_url");
      const downloadURL = await getDownloadURL(sref);

      // 2) Firestore – zapis archiwum
      const valuesOut = { ...values, funkcjonariusze: selectedNames.join(", ") };
      if (requiresDossier && nextPayoutDate) {
        valuesOut["dni"] = nextPayoutDate;
      }
      const archiveRef = await addDoc(collection(db, "archives"), {
        templateName: template.name,
        templateSlug: template.slug,
        userLogin: userLogin || "nieznany",
        createdAt: serverTimestamp(),
        values: valuesOut,
        officers: selectedNames,        // dla podglądu
        officersUid: selectedUids,      // <— KLUCZ DO STATYSTYK
        dossierId: dossierId || null,
        imagePath: storagePath,
        imageUrl: downloadURL,
      });

      // 2a) wpis w teczce (opcjonalnie)
      if (dossierId) {
        await addDoc(collection(db, "dossiers", dossierId, "records"), {
          text: `Dokument: ${template.name}\nAutor: ${userLogin}\nURL: ${downloadURL}`,
          createdAt: serverTimestamp(),
          author: auth.currentUser?.email || "",
          authorUid: auth.currentUser?.uid || "",
          type: "archive_link",
          archiveId: archiveRef.id,
          imageUrl: downloadURL,
        });
      }

      // 3) log
      await addDoc(collection(db, "logs"), {
        type: "doc_sent",
        template: template.name,
        login: userLogin,
        officers: selectedNames,
        officersUid: selectedUids,
        ts: serverTimestamp(),
      });

      // 4) Discord
      const res = await fetch("/api/send-to-discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, imageBase64: base64, templateName: template.name, userLogin }),
      });
      if (!res.ok) throw new Error(`Błąd wysyłki: ${res.status}`);

      setOk("Wysłano do ARCHIWUM (Discord + wewnętrzne).");
    } catch (e: any) {
      setErr(e?.message || "Nie udało się wygenerować/wysłać obrazu.");
    } finally {
      setSending(false);
    }
  };

  // pomocnicze: następna data świadczenia (liczona od dziś)
  const nextPayoutDate = useMemo(() => {
    if (!requiresDossier) return "";
    const dniRaw = values["dni"];
    if (!dniRaw) return "";
    const dni = Number(dniRaw);
    if (Number.isNaN(dni)) return "";
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() + dni);
    return base.toLocaleDateString();
  }, [requiresDossier, values]);

  return (
    <AuthGate>
      <div className="min-h-screen px-4 py-8 max-w-6xl mx-auto grid gap-8">
        <Head><title>DPS 77RP — {template.name}</title></Head>

        <button className="btn w-max" onClick={()=>history.back()}>← Wróć</button>

        <div className="grid md:grid-cols-2 gap-6">
          {/* FORM */}
          <div className="card p-6">
            <h1 className="text-2xl font-bold mb-3">{template.name}</h1>
            <form onSubmit={onSubmit} className="grid gap-4">
              <OfficersPicker />

              {/* teczka */}
              <div className="grid gap-1">
                <label className="label">
                  Powiąż z teczką{requiresDossier ? " *" : " (opcjonalnie)"}
                </label>
                <input
                  className="input mb-1"
                  placeholder="Szukaj po imieniu/nazwisku/CID..."
                  onChange={(e) => {
                    const v = e.target.value.toLowerCase();
                    setDossiers((prev) =>
                      prev.map((x) => ({
                        ...x,
                        _hidden: !(
                          (x.first || "").toLowerCase().includes(v) ||
                          (x.last || "").toLowerCase().includes(v) ||
                          (x.cid || "").toLowerCase().includes(v) ||
                          (x.title || "").toLowerCase().includes(v)
                        ),
                      }))
                    );
                  }}
                />
                <select
                  className="input"
                  value={dossierId}
                  required={!!requiresDossier}
                  onChange={async (e) => {
                    const id = e.target.value;
                    setDossierId(id);
                    if (id) await prefillFromDossier(id);
                  }}
                >
                  <option value="" disabled={!!requiresDossier}>
                    — {requiresDossier ? "wybierz teczkę" : "bez teczki"} —
                  </option>                 
                  {dossiers.filter(d=>!d._hidden).map(d => (
                    <option key={d.id} value={d.id}>{d.title}</option>
                  ))}
                </select>
                {requiresDossier && (
                  <p className="text-xs text-beige-700">Dokument wymaga wskazania teczki beneficjenta.</p>
                )}
              </div>

              {/* pola */}
              {template.fields.map((f) => (
                <div key={f.key} className="grid gap-1">
                  <label className="label">{f.label}{f.required && " *"}</label>

                  {f.type === "multiselect" ? (
                    <div className="grid gap-1">
                      {(f.options || []).map((opt) => {
                        const arr: string[] =
                          typeof values[f.key] === "string" && values[f.key].length
                            ? (values[f.key] as string).split("|")
                            : [];
                        const checked = arr.includes(opt);
                        return (
                          <label key={opt} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const now = new Set(arr);
                                if (e.target.checked) now.add(opt); else now.delete(opt);
                                setValues((v) => ({ ...v, [f.key]: Array.from(now).join("|") }));
                              }}
                            />
                            <span>{opt}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : f.type === "textarea" ? (
                   <textarea
                    className="input min-h-[220px]"
                    required={f.required}
                    value={values[f.key] || ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                  ) : f.type === "select" ? (
                    <select
                      className="input"
                      required={f.required}
                      value={values[f.key] || ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    >
                      <option value="">-- wybierz --</option>
                      {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      className="input"
                      type={f.type === "number" ? "number" : (f.type === "date" ? "date" : "text")}
                      required={f.required}
                      value={values[f.key] || ""}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    />
                  )}
                </div>
              ))}

              <button className="btn" disabled={sending || (requiresDossier && !dossierId)}>
                {sending ? "Wysyłanie..." : "Wyślij do ARCHIWUM (obraz PNG)"}
              </button>
              {ok && <p className="text-green-700 text-sm">{ok}</p>}
              {err && <p className="text-red-700 text-sm">{err}</p>}
            </form>
          </div>

          {/* PREVIEW */}
          <div className="card p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Podgląd dokumentu (to idzie jako obraz)</h2>
              <span className="text-xs text-beige-700">A4 • wysoka jakość</span>
            </div>

            <div
              ref={previewRef}
              className="bg-white text-black mx-auto w-[900px] max-w-full aspect-[210/297] p-8 border border-beige-300 shadow-sm"
            >
              <div className="flex items-center gap-3 mb-4">
                <img src="/logo.png" alt="DPS" width={140} />
                <div>
                  <div className="text-xl font-bold">Department of Public Safety</div>
                  <div className="text-sm text-gray-600">{template.name}</div>
                </div>
              </div>
              <hr className="border-beige-300 mb-4" />

              {/* Funkcjonariusze */}
              <div className="mb-4 text-[12px]">
                <span className="font-semibold">Funkcjonariusze:</span> {selectedNames.join(", ")}
              </div>

              <div className="space-y-3 text-[12px] leading-6">
                {template.fields.map((f) => {
                  const raw = values[f.key];
                   let display = typeof raw === "string" && raw.includes("|")
                    ? raw.split("|").join(", ")
                    : (raw || "—");
                  if (template.slug === "swiadczenie-spoleczne" && f.key === "dni") {
                    display = nextPayoutDate || "—";
                  }

                  return (
                    <div key={f.key} className="grid grid-cols-[220px_1fr] gap-3">
                      <div className="font-semibold">{f.label}{f.required ? " *" : ""}</div>
                      <div className="whitespace-pre-wrap">
                        {display}
                        {template.slug === "swiadczenie-spoleczne" && f.key === "dni" && nextPayoutDate && (
                          <div className="text-[11px] text-gray-600">Wyliczono z dnia dzisiejszego.</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-8 text-sm text-gray-600">
                Wygenerowano w panelu DPS • {new Date().toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AuthGate>
  );
}
