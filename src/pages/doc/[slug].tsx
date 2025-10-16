import { useRouter } from "next/router";
import AuthGate from "@/components/AuthGate";
import { TEMPLATES, Template } from "@/lib/templates";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { auth, db, storage } from "@/lib/firebase";
import { addDoc, collection, serverTimestamp, getDocs, query, orderBy } from "firebase/firestore";
import { ref, uploadString, getDownloadURL } from "firebase/storage";

const LOGIN_DOMAIN = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dps.local";

function findTemplate(slug: string | string[] | undefined): Template | undefined {
  if (!slug || typeof slug !== 'string') return undefined;
  return TEMPLATES.find(t => t.slug === slug);
}

export default function DocPage() {
  const router = useRouter();
  const template = useMemo(()=> findTemplate(router.query.slug), [router.query.slug]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // --- Teczki dowodowe (lista + wybór) ---
  const [dossiers, setDossiers] = useState<any[]>([]);
  const [dossierId, setDossierId] = useState("");

  useEffect(() => {
    (async () => {
      const q = query(collection(db, "dossiers"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      setDossiers(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    })();
  }, []);
  // ---------------------------------------

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

      const filename = `${template.slug}-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.png`;

      const email = auth.currentUser?.email || "";
      const suffix = `@${LOGIN_DOMAIN}`;
      const userLogin = email.endsWith(suffix) ? email.slice(0, -suffix.length) : email;

      // === Zapis do Storage + Firestore ===
      // 1) Upload obrazu do Firebase Storage
      const storagePath = `archives/${filename}`;
      const sref = ref(storage, storagePath);
      await uploadString(sref, dataUrl, "data_url");
      const downloadURL = await getDownloadURL(sref);

      // 2) Wpis do Firestore → kolekcja "archives" (DODANO dossierId)
      await addDoc(collection(db, "archives"), {
        templateName: template.name,
        userLogin: userLogin || "nieznany",
        createdAt: serverTimestamp(),
        values,
        dossierId: dossierId || null,
        imagePath: storagePath,
        imageUrl: downloadURL,
      });

      // 3) Log do Firestore → kolekcja "logs"
      await addDoc(collection(db, "logs"), {
        type: "doc_sent",
        template: template.name,
        login: userLogin,
        ts: serverTimestamp(),
      });
      // === /Zapis ===

      // Wysyłka na Discord (jak wcześniej – z base64)
      const res = await fetch('/api/send-to-discord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          imageBase64: base64,
          templateName: template.name,
          userLogin,
        }),
      });
      if (!res.ok) throw new Error(`Błąd wysyłki: ${res.status}`);

      setOk('Wysłano do ARCHIWUM (Discord + wewnętrzne).');
    } catch (e: any) {
      setErr(e?.message || 'Nie udało się wygenerować/wysłać obrazu.');
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthGate>
      <div className="min-h-screen px-4 py-8 max-w-5xl mx-auto grid gap-6">
        <button className="btn w-max" onClick={()=>history.back()}>← Wróć</button>

        <div className="grid md:grid-cols-2 gap-6">
          {/* FORM */}
          <div className="card p-6">
            <h1 className="text-2xl font-bold mb-4">{template.name}</h1>
            <form onSubmit={onSubmit} className="grid gap-4">

              {/* --- Powiązanie z teczką (opcjonalne) --- */}
              <div className="grid gap-1">
                <label className="label">Powiąż z teczką (opcjonalnie)</label>
                <input
                  className="input mb-1"
                  placeholder="Szukaj po imieniu/nazwisku/CID..."
                  onChange={e=>{
                    const v = e.target.value.toLowerCase();
                    setDossiers(prev => prev.map(x => ({
                      ...x,
                      _hidden: !(
                        (x.first||"").toLowerCase().includes(v) ||
                        (x.last||"").toLowerCase().includes(v) ||
                        (x.cid||"").toLowerCase().includes(v)
                      )
                    })));
                  }}
                />
                <select className="input" value={dossierId} onChange={e=>setDossierId(e.target.value)}>
                  <option value="">— bez teczki —</option>
                  {dossiers.filter(d=>!d._hidden).map(d => (
                    <option key={d.id} value={d.id}>{d.title}</option>
                  ))}
                </select>
              </div>
              {/* ---------------------------------------- */}

              {template.fields.map(f => (
                <div key={f.key} className="grid gap-1">
                  <label className="label">{f.label}{f.required && ' *'}</label>
                  {f.type === 'textarea' ? (
                    <textarea
                      className="input h-40"
                      required={f.required}
                      value={values[f.key] || ''}
                      onChange={e=>setValues(v=>({...v,[f.key]:e.target.value}))}
                    />
                  ) : f.type === 'select' ? (
                    <select
                      className="input"
                      required={f.required}
                      value={values[f.key] || ''}
                      onChange={e=>setValues(v=>({...v,[f.key]:e.target.value}))}
                    >
                      <option value="">-- wybierz --</option>
                      {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      className="input"
                      type={f.type === 'number' ? 'number' : (f.type === 'date' ? 'date' : 'text')}
                      required={f.required}
                      value={values[f.key] || ''}
                      onChange={e=>setValues(v=>({...v,[f.key]:e.target.value}))}
                    />
                  )}
                </div>
              ))}
              <button className="btn" disabled={sending}>{sending ? 'Wysyłanie...' : 'Wyślij do ARCHIWUM (obraz PNG)'}</button>
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

            {/* A4 sheet preview */}
            <div
              ref={previewRef}
              className="bg-white text-black mx-auto w-[794px] max-w-full aspect-[210/297] p-10 border border-beige-300 shadow-sm"
            >
              <div className="flex items-center gap-3 mb-6">
                {/* Jeśli używasz PNG: zamień na /logo.png */}
                <img src="/logo.png" alt="DPS" width={180} />
                <div>
                  <div className="text-xl font-bold">Department of Public Safety</div>
                  <div className="text-sm text-gray-600">{template.name}</div>
                </div>
              </div>
              <hr className="border-beige-300 mb-6" />
              <div className="space-y-3 text-[12px] leading-6">
                {template.fields.map(f => (
                  <div key={f.key} className="grid grid-cols-[220px_1fr] gap-3">
                    <div className="font-semibold">
                      {f.label}{f.required ? ' *' : ''}
                    </div>
                    <div className="whitespace-pre-wrap">
                      {values[f.key] || '—'}
                    </div>
                  </div>
                ))}
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
