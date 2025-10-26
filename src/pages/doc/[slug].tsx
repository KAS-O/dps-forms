import { useRouter } from "next/router";
import Head from "next/head";
import AuthGate from "@/components/AuthGate";
import { TEMPLATES, Template } from "@/lib/templates";
import {
  FormEvent,
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  runTransaction,
} from "firebase/firestore";
import { ref, uploadString, getDownloadURL } from "firebase/storage";
import { useSessionActivity } from "@/components/ActivityLogger";

const LOGIN_DOMAIN = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dps.local";

type Person = { id: string; fullName?: string; login?: string };

type FieldRender = {
  id: string;
  label: string;
  required: boolean;
  textValue: string;
  note?: string;
  signature: string;
};

const SIGNATURE_COLLECTION = "documentCounters";

function formatSignatureNumber(value: number): string {
  return value.toString().padStart(4, "0");
}

function formatSignature(prefix: string, year: number, sequence: number): string {
  return `${prefix}/${year}/${formatSignatureNumber(sequence)}`;
}

function formatDateDisplay(raw: string | undefined): string {
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleDateString("pl-PL");
}

const FieldBlock = forwardRef<HTMLDivElement, { field: FieldRender }>(({ field }, ref) => {
  return (
    <div ref={ref} className="grid grid-cols-[220px_1fr] gap-3">
      <div className="font-semibold">
        {field.label}
        {field.required ? " *" : ""}
      </div>
      <div className="whitespace-pre-wrap break-words">
        {field.textValue}
        {field.note && <div className="text-[11px] text-gray-600">{field.note}</div>}
      </div>
    </div>
  );
});

FieldBlock.displayName = "FieldBlock";

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
  const { logActivity, session } = useSessionActivity();
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const measurementRefs = useRef<(HTMLDivElement | null)[]>([]);
  const fieldsContainerRef = useRef<HTMLDivElement | null>(null);
  const [contentHeight, setContentHeight] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [signatureNumber, setSignatureNumber] = useState<number | null>(null);
  const [signatureLoading, setSignatureLoading] = useState(false);
  const [signatureError, setSignatureError] = useState<string | null>(null);

  // teczki
  const [dossiers, setDossiers] = useState<any[]>([]);
  const [dossierId, setDossierId] = useState("");
  const [vehicleFolders, setVehicleFolders] = useState<any[]>([]);
  const [vehicleFolderId, setVehicleFolderId] = useState("");
  const [vehicleSearch, setVehicleSearch] = useState("");

  // funkcjonariusze (UID-y!)
  const [profiles, setProfiles] = useState<Person[]>([]);
  const [currentUid, setCurrentUid] = useState<string>("");
  const [selectedUids, setSelectedUids] = useState<string[]>([]); // zawsze zawiera currentUid

  const uidToName = (uid: string) => {
    const p = profiles.find((x) => x.id === uid);
    return p?.fullName || p?.login || uid;
  };
  const selectedNames = selectedUids.map(uidToName);
  const authorName = selectedNames[0] || "";
  const requiresDossier = !!template?.requiresDossier;
  const requiresVehicleFolder = !!template?.requiresVehicleFolder;
  const vehicleNoteConfig = template?.vehicleNoteConfig;
  const isWniosek = template?.slug === "wniosek-o-ukaranie";
  const selectedVehicle = useMemo(
    () => vehicleFolders.find((v) => v.id === vehicleFolderId),
    [vehicleFolders, vehicleFolderId]
  );
  const filteredVehicleFolders = useMemo(() => {
    if (!requiresVehicleFolder) return vehicleFolders;
    const needle = vehicleSearch.trim().toLowerCase();
    if (!needle) return vehicleFolders;
    return vehicleFolders.filter((vehicle) => {
      const registration = (vehicle.registration || "").toLowerCase();
      const brand = (vehicle.brand || "").toLowerCase();
      const color = (vehicle.color || "").toLowerCase();
      const ownerName = (vehicle.ownerName || "").toLowerCase();
      const ownerCid = (vehicle.ownerCid || "").toLowerCase();
      return [registration, brand, color, ownerName, ownerCid].some((field) =>
        field.includes(needle)
      );
    });
  }, [requiresVehicleFolder, vehicleFolders, vehicleSearch]);
  
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

  const previewFields = useMemo<FieldRender[]>(() => {
    if (!template) return [];

    return template.fields.map((f) => {
      const rawValue = values[f.key];
      let displayText = "";
      if (typeof rawValue === "string" && rawValue.includes("|")) {
        displayText = rawValue
          .split("|")
          .map((part) => part.trim())
          .filter(Boolean)
          .join(", ");
      } else if (rawValue != null && rawValue !== "") {
        if (f.type === "date" && typeof rawValue === "string") {
          const formatted = formatDateDisplay(rawValue);
          displayText = formatted || String(rawValue);
        } else {
          displayText = String(rawValue);
        }
      }

      let note = "";
      if (template.slug === "swiadczenie-spoleczne" && f.key === "dni") {
        displayText = nextPayoutDate || "—";
        if (nextPayoutDate) {
          note = "Wyliczono z dnia dzisiejszego.";
        }
      }

      if (!displayText) {
        displayText = "—";
      }

      return {
        id: f.key,
        label: f.label,
        required: !!f.required,
        textValue: displayText,
        note,
        signature: `${displayText}|${note}`,
      };
    });
  }, [nextPayoutDate, template, values]);

  useEffect(() => {
    let active = true;
    setSignatureError(null);
    setSignatureNumber(null);
    if (!template?.signaturePrefix) {
      return () => {
        active = false;
      };
    }
    const year = new Date().getFullYear();
    const counterRef = doc(db, SIGNATURE_COLLECTION, `${template.slug}-${year}`);
    setSignatureLoading(true);
    (async () => {
      try {
        const snap = await getDoc(counterRef);
        const currentRaw = snap.exists() ? (snap.data() as any)?.current : 0;
        const currentNumber = typeof currentRaw === "number" ? currentRaw : Number(currentRaw) || 0;
        if (active) {
          setSignatureNumber(currentNumber + 1);
        }
      } catch (error) {
        console.error("Nie udało się pobrać numeru sygnatury", error);
        if (active) {
          setSignatureError("Nie udało się pobrać numeru sygnatury.");
        }
      } finally {
        if (active) {
          setSignatureLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [template?.slug, template?.signaturePrefix]);

  const fieldsSignature = useMemo(() => previewFields.map((f) => `${f.id}:${f.signature}`).join("|"), [previewFields]);

  const [pages, setPages] = useState<FieldRender[][]>(() => [previewFields]);

  useEffect(() => {
    setPages([previewFields]);
  }, [fieldsSignature, previewFields]);

  const renderedPagesCount = isWniosek ? 1 : pages.length;
  pageRefs.current = pageRefs.current.slice(0, renderedPagesCount);
  measurementRefs.current = measurementRefs.current.slice(0, previewFields.length);

  const setFirstPageFieldsRef = useCallback((el: HTMLDivElement | null) => {
    fieldsContainerRef.current = el;
  }, []);

  useLayoutEffect(() => {
    const container = fieldsContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const height = Math.round(rect.height);
    const width = Math.round(rect.width);
    if (height && height !== contentHeight) {
      setContentHeight(height);
    }
    if (width && width !== contentWidth) {
      setContentWidth(width);
    }
  }, [contentHeight, contentWidth, renderedPagesCount, fieldsSignature]);

  useLayoutEffect(() => {
    if (isWniosek) return;
    if (!contentHeight) return;
    const heights = previewFields.map((_, idx) => measurementRefs.current[idx]?.offsetHeight ?? 0);
    if (!heights.some((height) => height > 0)) return;

    const newPages: FieldRender[][] = [];
    let current: FieldRender[] = [];
    let currentHeight = 0;

    heights.forEach((height, idx) => {
      const field = previewFields[idx];
      if (currentHeight + height > contentHeight && current.length > 0) {
        newPages.push(current);
        current = [];
        currentHeight = 0;
      }
      current.push(field);
      currentHeight += height;
    });

    if (current.length) {
      newPages.push(current);
    }
    if (newPages.length === 0) {
      newPages.push([]);
    }

    const isSame =
      newPages.length === pages.length &&
      newPages.every((page, pageIdx) => {
        const existing = pages[pageIdx];
        if (!existing || existing.length !== page.length) return false;
        return page.every((field, fieldIdx) => existing[fieldIdx]?.id === field.id);
      });

    if (!isSame) {
      setPages(newPages);
    }
  }, [contentHeight, previewFields, pages, fieldsSignature, isWniosek]);

  const measurementWidth = contentWidth || 760;

  const signatureYear = useMemo(() => new Date().getFullYear(), []);

  const signatureValue = useMemo(() => {
    if (!template?.signaturePrefix) return "";
    if (signatureNumber != null) {
      return formatSignature(template.signaturePrefix, signatureYear, signatureNumber);
    }
    if (signatureError) return "Błąd sygnatury";
    if (signatureLoading) return "(generowanie sygnatury...)";
    return `${template.signaturePrefix}/${signatureYear}/—`;
  }, [signatureError, signatureLoading, signatureNumber, signatureYear, template?.signaturePrefix]);

  const wniosekSignatureText = useMemo(() => {
    if (!template?.signaturePrefix || !isWniosek) return "";
    if (signatureNumber != null) {
      return formatSignature(template.signaturePrefix, signatureYear, signatureNumber);
    }
    if (signatureError) return "(błąd sygnatury)";
    if (signatureLoading) return "(generowanie sygnatury...)";
    return "*automatyczna sygnatura*";
  }, [isWniosek, signatureError, signatureLoading, signatureNumber, signatureYear, template?.signaturePrefix]);

  const wniosekText = useMemo(() => {
    if (!isWniosek) return "";

    const ensureValue = (value: string | undefined, placeholder: string) => {
      const trimmed = (value ?? "").trim();
      return trimmed.length ? trimmed : placeholder;
    };

    const ensureDateValue = (value: string | undefined, placeholder: string) => {
      const trimmed = (value ?? "").trim();
      if (!trimmed) return placeholder;
      const formatted = formatDateDisplay(trimmed);
      return formatted || trimmed || placeholder;
    };

    const displayData = ensureDateValue(values["data"], "[dd/mm/rrrr]");
    const displayStopien = ensureValue(values["stopien"], "[stopień]");
    const displayBadge = ensureValue(values["numerOdznaki"], "[numer odznaki]");
    const displayCitizen = ensureValue(values["obwiniony"], "[imię i nazwisko]");
    const displayCid = ensureValue(values["cid"], "[CID obywatela]");
    const displayArticle = ensureValue(values["nazwaArt"], "[Nazwa art.]");
    const displayEventDate = ensureDateValue(values["dataZdarzenia"], "[data zdarzenia]");
    const displayEventPlace = ensureValue(values["miejsceZdarzenia"], "[miejsce zdarzenia]");
    const displayDescription = ensureValue(values["opisCzynu"], "[Opis czynu]");
    const rawAttachments = values["zalaczniki"];
    const displayAttachments = rawAttachments && rawAttachments.trim().length
      ? rawAttachments.trim()
      : "[Opis załączonych rzeczy]";

    const officerNameDisplay = authorName || "*imię i nazwisko*";
    const officerLine = [displayStopien, officerNameDisplay, displayBadge]
      .filter((part) => part && part.trim().length)
      .join(" ");
    const officerBottomLine = [displayStopien, officerNameDisplay]
      .filter((part) => part && part.trim().length)
      .join(" ");

    return [
      "Wniosek o wszczęcie postępowania przygotowawczego",
      "",
      `Sygnatura: ${wniosekSignatureText || "*automatyczna sygnatura*"}`,
      `Data: ${displayData}`,
      "Jednostka: Los Santos Police Department",
      `Funkcjonariusz sporządzający: ${officerLine}`,
      "",
      "Na podstawie przeprowadzonych czynności służbowych oraz zgromadzonego materiału dowodowego, Los Santos Police Department składa niniejszy wniosek do Prokuratury Los Santos o wszczęcie postępowania przygotowawczego wobec:",
      "",
      displayCitizen,
      `CID: ${displayCid}`,
      "",
      `w związku z uzasadnionym podejrzeniem popełnienia czynu zabronionego określonego w ${displayArticle}.`,
      "",
      `W toku prowadzonych czynności ustalono, że w dniu ${displayEventDate} na terenie ${displayEventPlace} ${displayCitizen} dopuścił/a się czynu polegającego na ${displayDescription}.`,
      "Zgromadzony materiał dowodowy wskazuje na zasadność wszczęcia postępowania przygotowawczego w przedmiotowej sprawie.",
      "",
      "W związku z powyższym, Los Santos Police Department wnosi o podjęcie przez Prokuraturę Los Santos dalszych czynności procesowych zmierzających do wyjaśnienia wszystkich okoliczności zdarzenia oraz pociągnięcia sprawcy do odpowiedzialności karnej.",
      "",
      "Do wniosku załączono:",
      displayAttachments,
      "",
      "Z poważaniem,",
      officerBottomLine,
      "Los Santos Police Department",
      "Wydział ds. wykroczeń",
    ].join("\n");
  }, [authorName, isWniosek, values, wniosekSignatureText]);

  const displayedPages = isWniosek ? [previewFields] : pages;
  
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

  useEffect(() => {
    if (!template?.requiresVehicleFolder) {
      setVehicleFolders([]);
      setVehicleFolderId("");
      setVehicleSearch("");
      return;
    }
    (async () => {
      setVehicleFolderId("");
      setVehicleSearch("");
      const qv = query(collection(db, "vehicleFolders"), orderBy("createdAt", "desc"));
      const sv = await getDocs(qv);
      setVehicleFolders(sv.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    })();
  }, [template?.requiresVehicleFolder]);

  useEffect(() => {
    if (!template || !session) return;
    void logActivity({ type: "template_view", template: template.name, slug: template.slug });
  }, [template, logActivity, session]);

  const finalizeSignature = useCallback(async (): Promise<string> => {
    if (!template?.signaturePrefix) {
      return "";
    }
    const year = new Date().getFullYear();
    const counterRef = doc(db, SIGNATURE_COLLECTION, `${template.slug}-${year}`);
    setSignatureLoading(true);
    setSignatureError(null);
    try {
      const nextNumber = await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(counterRef);
        const data = snapshot.exists() ? (snapshot.data() as any) : {};
        const currentRaw = data?.current ?? 0;
        const currentNumber = typeof currentRaw === "number" ? currentRaw : Number(currentRaw) || 0;
        const next = currentNumber + 1;
        transaction.set(
          counterRef,
          {
            current: next,
            prefix: template.signaturePrefix,
            year,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        return next;
      });
      setSignatureNumber(nextNumber);
      await new Promise<void>((resolve) => {
        if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
          setTimeout(() => resolve(), 0);
          return;
        }
        window.requestAnimationFrame(() => resolve());
      });
      return formatSignature(template.signaturePrefix, year, nextNumber);
    } catch (error) {
      console.error("Nie udało się wygenerować sygnatury", error);
      setSignatureError("Nie udało się wygenerować sygnatury.");
      return "";
    } finally {
      setSignatureLoading(false);
    }
  }, [template?.signaturePrefix, template?.slug]);

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

  const prefillFromVehicle = (id: string) => {
    const vehicle = vehicleFolders.find((v) => v.id === id);
    if (!vehicle) return;
    setValues((prev) => ({
      ...prev,
      ...(vehicle.registration ? { registration: vehicle.registration } : {}),
      ...(vehicle.brand ? { brand: vehicle.brand } : {}),
      ...(vehicle.color ? { color: vehicle.color } : {}),
      ...(vehicle.ownerName ? { owner: vehicle.ownerName } : {}),
    }));
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
     if (requiresVehicleFolder && !vehicleFolderId) {
      setErr("Ten dokument wymaga wskazania teczki pojazdu.");
      return;
    }
    setSending(true);
    try {
      let signatureForDocument = signatureValue;
      if (template.signaturePrefix) {
        const generatedSignature = await finalizeSignature();
        if (!generatedSignature) {
          throw new Error("Nie udało się wygenerować sygnatury.");
        }
        signatureForDocument = generatedSignature;
      }

      const nodes = pageRefs.current.filter((node): node is HTMLDivElement => !!node);
      if (!nodes.length) throw new Error("Brak podglądu do zrzutu.");

      const html2canvas = (await import("html2canvas")).default;
      const canvases = await Promise.all(
        nodes.map((node) => html2canvas(node, { scale: 2, useCORS: true, backgroundColor: "#ffffff" }))
      );
      const dataUrls = canvases.map((canvas) => canvas.toDataURL("image/png"));
      if (!dataUrls.length) throw new Error("Nie udało się wygenerować obrazu dokumentu.");

      const baseFilename = `${template.slug}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
      const uploadResults: { path: string; url: string }[] = [];

      for (let index = 0; index < dataUrls.length; index += 1) {
        const dataUrl = dataUrls[index];
        const pageFilename = `${baseFilename}-strona-${index + 1}.png`;
        const storagePath = `archives/${pageFilename}`;
        const sref = ref(storage, storagePath);
        await uploadString(sref, dataUrl, "data_url");
        const downloadURL = await getDownloadURL(sref);
        uploadResults.push({ path: storagePath, url: downloadURL });
      }

      if (!uploadResults.length) {
        throw new Error("Nie udało się zapisać obrazów dokumentu.");
      }

      const primaryImage = uploadResults[0];
      const firstBase64 = dataUrls[0]?.split(",")[1];
      if (!firstBase64) throw new Error("Nie udało się przygotować obrazu dokumentu.");

      const email = auth.currentUser?.email || "";
      const suffix = `@${LOGIN_DOMAIN}`;
      const userLogin = email.endsWith(suffix) ? email.slice(0, -suffix.length) : email;

      const imagePathsAll = uploadResults.map((item) => item.path);
      const imageUrlsAll = uploadResults.map((item) => item.url);

      const officerText = selectedNames.join(", ") || "—";
      const vehicleLabelParts = selectedVehicle
        ? [
            selectedVehicle.registration || null,
            selectedVehicle.brand || null,
            selectedVehicle.color ? `Kolor: ${selectedVehicle.color}` : null,
            selectedVehicle.ownerName ? `Właściciel: ${selectedVehicle.ownerName}` : null,
          ].filter(Boolean)
        : [];
      const vehicleLabel = vehicleLabelParts.join(" • ");
      const dossierEntry = dossierId ? dossiers.find((d) => d.id === dossierId) : undefined;
      const dossierLabel =
        dossierEntry?.title ||
        [dossierEntry?.first, dossierEntry?.last]
          .map((part) => (typeof part === "string" ? part.trim() : ""))
          .filter(Boolean)
          .join(" ") ||
        (dossierId || "");

      const fieldLinesForText = isWniosek
        ? wniosekText.split("\n")
        : previewFields.flatMap((field) => {
            const base = `${field.label}: ${field.textValue || "—"}`;
            return field.note ? [base, `  ${field.note}`] : [base];
          });

      const textPagesRaw = isWniosek
        ? [wniosekText]
        : pages.map((pageFields) =>
            pageFields
              .flatMap((field) => {
                const base = `${field.label}: ${field.textValue || "—"}`;
                return field.note ? [base, `  ${field.note}`] : [base];
              })
              .join("\n")
          );
      const textPages = textPagesRaw.filter((page) => page.trim().length > 0);

      const documentTextLines = [
        `Dokument: ${template.name}`,
        template.signaturePrefix ? `Sygnatura: ${signatureForDocument}` : null,
        `Funkcjonariusze: ${officerText}`,
        dossierId ? `Powiązana teczka: ${dossierLabel}` : null,
        vehicleFolderId
          ? `Teczka pojazdu: ${vehicleLabel || selectedVehicle?.registration || selectedVehicle?.id || "—"}`
          : null,
        "",
        ...fieldLinesForText,
      ].filter((line): line is string => line != null);
      const documentTextContent = documentTextLines.join("\n");

      // 2) Firestore – zapis archiwum
      const valuesOut: Record<string, any> = {
        ...values,
        funkcjonariusze: officerText,
      };
      if (template.signaturePrefix) {
        valuesOut["sygnatura"] = signatureForDocument;
      }
      if (requiresDossier && nextPayoutDate) {
        valuesOut["dni"] = nextPayoutDate;
      }
      valuesOut["liczbaStron"] = imageUrlsAll.length;
      if (requiresVehicleFolder && selectedVehicle) {
        valuesOut["teczkaPojazdu"] = vehicleLabel || selectedVehicle.registration || selectedVehicle.id;
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
        vehicleFolderId: vehicleFolderId || null,
        vehicleFolderRegistration: selectedVehicle?.registration || "",
        imagePath: primaryImage.path,
        imageUrl: primaryImage.url,
        imagePaths: imagePathsAll,
        imageUrls: imageUrlsAll,
        textContent: documentTextContent,
        textPages,
      });

      // 2a) wpis w teczce (opcjonalnie)
      if (dossierId) {
        const dossierTextLines = [
          `Dokument: ${template.name}`,
          template.signaturePrefix ? `Sygnatura: ${signatureForDocument}` : null,
          `Autor: ${userLogin}`,
          "Treść:",
          ...fieldLinesForText,
          `URL: ${primaryImage.url}`,
        ].filter((line): line is string => !!line);
        await addDoc(collection(db, "dossiers", dossierId, "records"), {
          text: dossierTextLines.join("\n"),
          createdAt: serverTimestamp(),
          author: auth.currentUser?.email || "",
          authorUid: auth.currentUser?.uid || "",
          type: "archive_link",
          archiveId: archiveRef.id,
          imageUrl: primaryImage.url,
        });
      }

      if (requiresVehicleFolder && vehicleFolderId) {
        const noteLines: string[] = [
          `Dokument: ${template.name}`,
          template.signaturePrefix ? `Sygnatura: ${signatureForDocument}` : null,
          `Autor: ${userLogin}`,
          `Link do archiwum: ${primaryImage.url}`,
        ].filter((line): line is string => !!line);
        noteLines.push(`Łącznie stron: ${imageUrlsAll.length}`);
        if (selectedVehicle) {
          const parts = [
            selectedVehicle.registration || null,
            selectedVehicle.brand || null,
            selectedVehicle.color ? `Kolor: ${selectedVehicle.color}` : null,
          ]
            .filter(Boolean)
            .join(" • ");
          if (parts) noteLines.push(`Pojazd: ${parts}`);
        }
        if (fieldLinesForText.length) {
          noteLines.push("", "Treść dokumentu:", ...fieldLinesForText);
        }

        const rawAmount = vehicleNoteConfig ? values[vehicleNoteConfig.amountField] : undefined;
        const parsedAmount = rawAmount != null && rawAmount !== "" ? Number(rawAmount) : NaN;
        const hasAmount = Number.isFinite(parsedAmount);
        const notePayload: Record<string, any> = {
          text: noteLines.join("\n"),
          createdAt: serverTimestamp(),
          author: auth.currentUser?.email || "",
          authorUid: auth.currentUser?.uid || "",
          templateSlug: template.slug,
          templateName: template.name,
          archiveId: archiveRef.id,
          archiveUrl: primaryImage.url,
          vehicleFolderId,
        };
        if (hasAmount && vehicleNoteConfig) {
          notePayload.paymentAmount = parsedAmount;
          notePayload.paymentLabel = vehicleNoteConfig.amountLabel;
          notePayload.paymentStatus = "pending";
          notePayload.paymentStatusMessage = "Status płatności: oczekuje na rozliczenie.";
        }

        const noteRef = await addDoc(collection(db, "vehicleFolders", vehicleFolderId, "notes"), notePayload);
        await addDoc(collection(db, "logs"), {
          type: "vehicle_note_from_doc",
          vehicleId: vehicleFolderId,
          noteId: noteRef.id,
          archiveId: archiveRef.id,
          template: template.slug,
          author: auth.currentUser?.email || "",
          authorUid: auth.currentUser?.uid || "",
          ts: serverTimestamp(),
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
      const discordFilename = `${baseFilename}-strona-1.png`;
      const res = await fetch("/api/send-to-discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: discordFilename, imageBase64: firstBase64, templateName: template.name, userLogin }),
      });
      if (!res.ok) throw new Error(`Błąd wysyłki: ${res.status}`);

      setOk("Wysłano do ARCHIWUM (Discord + wewnętrzne).");
    } catch (e: any) {
      setErr(e?.message || "Nie udało się wygenerować/wysłać obrazu.");
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthGate>
      <>
        <div
          className="fixed pointer-events-none opacity-0 -z-50"
          style={{ width: `${measurementWidth}px`, left: "-10000px", top: "-10000px" }}
          aria-hidden="true"
        >
          <div className="doc-fields space-y-3 text-[12px] leading-6">
            {previewFields.map((field, idx) => (
              <FieldBlock
                key={`measure-${field.id}-${idx}`}
                field={field}
                ref={(el) => {
                  measurementRefs.current[idx] = el;
                }}
              />
            ))}
          </div>
        </div>

        <div className="min-h-screen px-4 py-8 max-w-6xl mx-auto grid gap-8">
          <Head><title>LSPD 77RP — {template.name}</title></Head>

         <button className="btn w-max" onClick={()=>history.back()}>← Wróć</button>

         <div className="grid md:grid-cols-2 gap-6">
          {/* FORM */}
          <div className="card p-6">
            <h1 className="text-2xl font-bold mb-3">{template.name}</h1>
            <form onSubmit={onSubmit} className="grid gap-4">
              {template?.signaturePrefix && (
                <div className="p-3 border border-beige-300 rounded bg-beige-100 text-sm">
                  <div className="font-semibold text-xs uppercase tracking-wide text-beige-700">Sygnatura</div>
                  <div className="text-base font-semibold">
                    {signatureValue || "—"}
                  </div>
                  {signatureLoading && !signatureError && (
                    <p className="text-xs text-beige-700 mt-1">Trwa generowanie numeru sygnatury...</p>
                  )}
                  {signatureError && (
                    <p className="text-xs text-red-600 mt-1">{signatureError}</p>
                  )}
                </div>
              )}
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

              {requiresVehicleFolder && (
                <div className="grid gap-1">
                  <label className="label">Powiąż z teczką pojazdu *</label>
                  <input
                    className="input mb-1"
                    placeholder="Szukaj po numerze rejestracyjnym, marce, kolorze lub właścicielu..."
                    value={vehicleSearch}
                    onChange={(e) => setVehicleSearch(e.target.value)}
                  />
                  <select
                    className="input"
                    value={vehicleFolderId}
                    required
                    onChange={(e) => {
                      const id = e.target.value;
                      setVehicleFolderId(id);
                      if (id) prefillFromVehicle(id);
                    }}
                  >
                    <option value="">— wybierz teczkę pojazdu —</option>
                    {filteredVehicleFolders.map((vehicle) => {
                      const labelParts = [
                        vehicle.registration || null,
                        vehicle.brand || null,
                        vehicle.color ? `Kolor: ${vehicle.color}` : null,
                        vehicle.ownerName ? `Właściciel: ${vehicle.ownerName}` : null,
                      ]
                        .filter(Boolean)
                        .join(" • ");
                      return (
                        <option key={vehicle.id} value={vehicle.id}>
                          {labelParts || vehicle.registration || vehicle.id}
                        </option>
                      );
                    })}
                  </select>
                  <p className="text-xs text-beige-700">
                    Dokument zostanie dodany do notatek w wybranej teczce pojazdu.
                  </p>
                </div>
              )}

              {/* pola */}
              {(template?.fields ?? []).map((f) => (
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
                {sending ? "Wysyłanie..." : "Wyślij do ARCHIWUM (obraz + tekst)"}
              </button>
              {ok && <p className="text-green-700 text-sm">{ok}</p>}
              {err && <p className="text-red-700 text-sm">{err}</p>}
            </form>
          </div>

          {/* PREVIEW */}
          <div className="card p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Podgląd dokumentu (obraz + zapis tekstowy)</h2>
              <span className="text-xs text-beige-700">
                A4 • wysoka jakość • {displayedPages.length}{" "}
                {displayedPages.length === 1 ? "strona" : "strony"}
              </span>
            </div>

            <div className="flex flex-col gap-6">
              {displayedPages.map((pageFields, pageIndex) => (
                <div
                  key={`doc-page-${pageIndex}`}
                  ref={(el) => {
                    pageRefs.current[pageIndex] = el;
                  }}
                  className="bg-white text-black mx-auto w-[900px] max-w-full aspect-[210/297] p-8 border border-beige-300 shadow-sm doc-page"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <img src="/logo.png" alt="LSPD" width={140} className="floating" />
                    <div>
                      <div className="text-xl font-bold">Los Santos Police Department</div>
                      <div className="text-sm text-gray-600">{template.name}</div>
                    </div>
                  </div>
                  <hr className="border-beige-300 mb-4" />

                  <div className="mb-2 text-[12px]">
                    <span className="font-semibold">Sygnatura:</span>{" "}
                    {template?.signaturePrefix
                      ? signatureValue || "—"
                      : "—"}
                    {signatureError && template?.signaturePrefix ? (
                      <span className="text-red-600"> ({signatureError})</span>
                    ) : null}
                  </div>

                  <div className="mb-4 text-[12px]">
                    <span className="font-semibold">Funkcjonariusze:</span> {selectedNames.join(", ")}
                  </div>

                  {requiresVehicleFolder && (
                    <div className="mb-4 text-[12px]">
                      <span className="font-semibold">Teczka pojazdu:</span>{" "}
                      {selectedVehicle ? (
                        <>
                          {selectedVehicle.registration || "—"}
                          {selectedVehicle.brand ? ` • ${selectedVehicle.brand}` : ""}
                          {selectedVehicle.color ? ` • Kolor: ${selectedVehicle.color}` : ""}
                          {selectedVehicle.ownerName ? ` • Właściciel: ${selectedVehicle.ownerName}` : ""}
                        </>
                      ) : (
                        "—"
                      )}
                    </div>
                  )}
                  
                  {isWniosek ? (
                    <div
                      className="text-[12px] leading-6 whitespace-pre-wrap doc-fields"
                      ref={pageIndex === 0 ? setFirstPageFieldsRef : undefined}
                    >
                      {wniosekText}
                    </div>
                  ) : (
                    <div
                      className="space-y-3 text-[12px] leading-6 doc-fields"
                      ref={pageIndex === 0 ? setFirstPageFieldsRef : undefined}
                    >
                      {pageFields.map((field, fieldIndex) => (
                        <FieldBlock key={`${pageIndex}-${field.id}-${fieldIndex}`} field={field} />
                      ))}
                    </div>
                  )}

                  <div className="mt-8 text-sm text-gray-600">
                    Wygenerowano w panelu LSPD • {new Date().toLocaleString()} • Strona {pageIndex + 1}/{
                      displayedPages.length
                    }
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      </>
    </AuthGate>
  );
}
