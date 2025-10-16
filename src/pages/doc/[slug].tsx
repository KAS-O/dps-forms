import { useRouter } from "next/router";
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

  // --- Teczki ---
  const [dossiers, setDossiers] = useState<any[]>([]);
  const [dossierId, setDossierId] = useState("");

  // --- Funkcjonariusze (z profili) ---
  const [profiles, setProfiles] = useState<any[]>([]);
  const [currentName, setCurrentName] = useState<string>("");
  const [officers, setOfficers] = useState<string[]>([]); // wybrane nazwiska

  useEffect(() => {
    (async () => {
      // teczki
      const qd = query(collection(db, "dossiers"), orderBy("createdAt", "desc"));
      const sd = await getDocs(qd);
      setDossiers(sd.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));

      // profile -> lista funkcjonariuszy
      const qp = query(collection(db, "profiles"));
      const sp = await getDocs(qp);
      const arr = sp.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setProfiles(arr);

      // ustaw domyślnie ZALOGOWANEGO funkcjonariusza i zablokuj jego odznaczenie
      const email = auth.currentUser?.email || "";
      const suffix = `@${LOGIN_DOMAIN}`;
      const userLogin = email.endsWith(suffix) ? email.slice(0, -suffix.length) : email;
      const me = arr.find((p) => p.login === userLogin);
      const name = (me?.fullName || userLogin) as string;
      setCurrentName(name);
      setOfficers([name]); // zawsze wybrany autor
    })();
  }, []);

  if (!template) {
    return (
      <AuthGate>
        <div className="min-h-screen flex items-center justify-center">
          <div className="card p-6">
            <p>Nie znaleziono szablonu.</p>
          </div>
        </div>
      </AuthGate>
    );
  }

  // === AUTO–UZUPEŁNIANIE POL Z TECZKI ===
  const prefillFromDossier = async (id: string) => {
    try {
      const snap = await getDoc(doc(db, "dossiers", id));
      const data = (snap.data() || {}) as any;

      let fullName = [data.first, data.last].filter(Boolean).join(" ").trim() || "";
      let cid = (data.cid ?? "").toString();

      if (!fullName || !cid) {
        const title: string = (data.title || "") as string; // "Akta Imię Nazwisko CID:1234"
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
  // ======================================

  // RENDER — „funkcjonariusze” (zawsze nad polami)
  const OfficersPicker = () => {
    return (
      <div className="grid gap-1">
        <label className="label">Funkcjonariusze</label>
        <div className="grid xs:grid-cols-1 sm:grid-cols-2 gap-2">
          {profiles.map((p) => {
            const name = p.fullName || p.login;
            const checked = officers.includes(name);
            const isMe = name === currentName;
            return (
              <label key={p.id} className="flex items-center gap-2 p-2 border border-beige-300 rounded">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={isMe} // autor zawsze zaznaczony
                  onChange={(e) => {
                    setOfficers((prev) => {
                      const set = new Set(prev);
                      if (e.target.checked) set.add(name);
                      else set.delete(name);
                      // gwarancja, że autor zostanie
                      set.add(currentName);
                      return Array.from(set);
                    });
                  }}
                />
                <span>{name}</span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-beige-700">Domyślnie wybrany jest autor dokumentu (nie można odznaczyć). Możesz dodać pozostałych.</p>
      </div>
    );
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSending(true);
    setOk(null);
    setErr(null);
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

      // 1) Upload obrazu do Storage
      const storagePath = `archives/${filename}`;
      const sref = ref(storage, storagePath);
      await uploadString(sref, dataUrl, "data_url");
      const downloadURL = await getDownloadURL(sref);

      // wartości do zapisu (dodajemy „funkcjonariusze” jako tekst do podglądu)
      const valuesOut = { ...values, funkcjonariusze: officers.join(", ") };

      // 2) Wpis do Firestore → "archives"
      const archiveRef = await addDoc(collection(db, "archives"), {
        templateName: template.name,
        templateSlug: template.slug, // <— dla panelu statystyk
        userLogin: userLogin || "nieznany",
        createdAt: serverTimestamp(),
        values: valuesOut,
        officers, // <— lista nazwisk
        dossierId: dossierId || null,
        imagePath: storagePath,
        imageUrl: downloadURL,
      });

      // 2a) Jeśli powiązano teczkę — dopisz wpis w records
      if (dossierId) {
        await addDoc(collection(db, "dossiers", dossierId, "records"), {
          text: `Dokument: ${template.name}\nAutor: ${userLogin}\nURL: ${downloadURL}`,
          createdAt: serverTimestamp(),
          author: userLogin,
          type: "archive_link",
          archiveId: archiveRef.id,
          imageUrl: downloadURL,
        });
      }

      // 3) Log
      await addDoc(collection(db, "logs"), {
        type: "doc_sent",
        template: template.name,
        login: userLogin,
        officers,
        ts: serverTimestamp(),
      });

      // 4) Discord
      const res = await fetch("/api/send-to-discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename,
          imageBase64: base64,
          templateName: template.name,
          userLogin,
        }),
      });
      if (!res.ok) throw new Error(`Błąd wysyłki: ${res.status}`);

      setOk("Wysłano do ARCHIWUM (Discord + wewnętrzne).");
    } catch (e: any) {
      setErr(e?.message || "Nie udało się wygenerować/wysłać obrazu.");
    } finally {
      setSending(false);
    }
  };

  // Wyliczanie pomocnicze: data następnej wypłaty w „swiadczenie-spoleczne”
  const nextDateDisplay = useMemo(() => {
    if (!template || template.slug !== "swiadczenie-spoleczne") return "";
    const base = values["data"];
    const dni = Number(values["dni"] || 0);
    if (!base || !dni) return "";
    try {
      const d = new Date(base);
      d.setDate(d.getDate() + dni);
      return d.toLocaleDateString();
    } catch { return ""; }
  }, [template, values]);

  return (
    <AuthGate>
      <div className="min-h-screen px-4 py-8 max-w-5xl mx-auto grid gap-6">
        <Head><title>DPS 77RP — {template.name}</title></Head>

        <button className="btn w-max" onClick={()=>history.back()}>← Wróć</button>

        <div className="grid md:grid-cols-2 gap-6">
          {/* FORM */}
          <div className="card p-6">
            <h1 className="text-2xl font-bold mb-4">{template.name}</h1>
            <form onSubmit={onSubmit} className="grid gap-4">

              {/* Funkcjonariusze */}
              <OfficersPicker />

              {/* Powiązanie z teczką */}
              <div className="grid gap-1">
                <label className="label">Powiąż z teczką (opcjonalnie)</label>
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
                  onChange={async (e) => {
                    const id = e.target.value;
                    setDossierId(id);
                    if (id) await prefillFromDossier(id);
                  }}
                >
                  <option value="">— bez teczki —</option>
                  {dossiers.filter(d=>!d._hidden).map(d => (
                    <option key={d.id} value={d.id}>{d.title}</option>
                  ))}
                </select>
              </div>

              {/* Pola szablonu */}
              {template.fields.map((f) => (
                <div key={f.key} className="grid gap-1">
                  <label className="label">
                    {f.label}{f.required && " *"}
                  </label>

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
                                if (e.target.checked) now.add(opt);
                                else now.delete(opt);
                                setValues((v) => ({
                                  ...v,
                                  [f.key]: Array.from(now).join("|"),
                                }));
                              }}
                            />
                            <span>{opt}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : f.type === "textarea" ? (
                    <textarea
                      className="input h-40"
                      required={f.required}
                      value={values[f.key] || ""}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [f.key]: e.target.value }))
                      }
                    />
                  ) : f.type === "select" ? (
                    <select
                      className="input"
                      required={f.required}
                      value={values[f.key] || ""}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [f.key]: e.target.value }))
                      }
                    >
                      <option value="">-- wybierz --</option>
                      {(f.options || []).map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
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

              <button className="btn" disabled={sending}>
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
              className="bg-white text-black mx-auto w-[794px] max-w-full aspect-[210/297] p-10 border border-beige-300 shadow-sm"
            >
              <div className="flex items-center gap-3 mb-6">
                <img src="/logo.png" alt="DPS" width={180} />
                <div>
                  <div className="text-xl font-bold">Department of Public Safety</div>
                  <div className="text-sm text-gray-600">{template.name}</div>
                </div>
              </div>
              <hr className="border-beige-300 mb-6" />

              {/* Funkcjonariusze w dokumencie */}
              <div className="mb-4 text-[12px]">
                <span className="font-semibold">Funkcjonariusze:</span> {officers.join(", ")}
              </div>

              <div className="space-y-3 text-[12px] leading-6">
                {template.fields.map((f) => {
                  const raw = values[f.key];
                  const display =
                    typeof raw === "string" && raw.includes("|")
                      ? raw.split("|").join(", ")
                      : (raw || "—");

                  return (
                    <div key={f.key} className="grid grid-cols-[220px_1fr] gap-3">
                      <div className="font-semibold">{f.label}{f.required ? " *" : ""}</div>
                      <div className="whitespace-pre-wrap">
                        {display}
                        {/* Specjalny dopisek dla świadczenia: wyliczona następna data */}
                        {template.slug === "swiadczenie-spoleczne" && f.key === "dni" && nextDateDisplay && (
                          <div className="text-[11px] text-gray-600">
                            Następna możliwa wypłata: {nextDateDisplay}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-10 text-sm text-gray-600">
                Wygenerowano w panelu DPS • {new Date().toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AuthGate>
  );
}
