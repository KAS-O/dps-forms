import { useRouter } from "next/router";
import Head from "next/head";
import AuthGate from "@/components/AuthGate";
import { TEMPLATES, Template } from "@/lib/templates";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useLogWriter } from "@/hooks/useLogWriter";

const LOGIN_DOMAIN = process.env.NEXT_PUBLIC_LOGIN_DOMAIN || "dps.local";

type Person = {
  id: string;
  fullName?: string;
  login?: string;
  rank?: string;
  badgeNumber?: string | number;
  badge?: string | number;
};

type FieldRender = {
  id: string;
  label: string;
  required: boolean;
  textValue: string;
  note?: string;
  signature: string;
};

const compressMultilineText = (value: string): string => {
  if (!value) return "";
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
};

const FieldBlock = ({ field }: { field: FieldRender }) => {
  const valueText = compressMultilineText(field.textValue);
  const noteText = field.note ? compressMultilineText(field.note) : "";

  return (
    <div className="text-[11px] leading-tight">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-700">
        {field.label}
        {field.required ? " *" : ""}
      </div>
      <div className="whitespace-pre-line break-words">{valueText || "—"}</div>
      {noteText ? (
        <div className="mt-0.5 text-[10px] text-gray-600 whitespace-pre-line break-words">
          {noteText}
        </div>
      ) : null}
    </div>
  );
};

const DOCUMENT_COUNTERS_COLLECTION = "documentCounters";

const waitForNextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

const formatDocumentDate = (value: string | undefined): string => {
  if (!value) return "—";
  const trimmed = value.trim();
  if (!trimmed) return "—";
  const parts = trimmed.split("-");
  if (parts.length === 3) {
    const [year, month, day] = parts;
    if (year && month && day) {
      return `${day}/${month}/${year}`;
    }
  }
  return trimmed;
};

type WniosekTextInput = {
  signature: string;
  date: string;
  citizenName: string;
  cid: string;
  articleName: string;
  eventDate: string;
  eventLocation: string;
  description: string;
  attachments: string;
  authorRank: string;
  authorName: string;
  authorBadge: string;
};

const buildWniosekTextLines = (input: WniosekTextInput): string[] => {
  const citizenName = input.citizenName.trim() || "—";
  const cid = input.cid.trim() || "—";
  const articleName = input.articleName.trim() || "—";
  const eventLocation = input.eventLocation.trim() || "—";
  const signature = input.signature.trim() || "—";
  const formattedDate = formatDocumentDate(input.date);
  const formattedEventDate = formatDocumentDate(input.eventDate);

  const badgeValue = input.authorBadge.trim();
  const rankValue = input.authorRank.trim();
  const nameValue = input.authorName.trim();
  const baseOfficerName = [rankValue, nameValue].filter(Boolean).join(" ").trim();
  const officerLineBase = baseOfficerName || "—";
  const officerLine = badgeValue
    ? `${baseOfficerName ? baseOfficerName : "—"} (Odznaka ${badgeValue})`
    : officerLineBase;
  const closingOfficerLine = baseOfficerName || "—";

  const descriptionLines = input.description
    ? input.description
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : [];
  if (!descriptionLines.length) {
    descriptionLines.push("—");
  }

  const attachmentsLines = input.attachments
    ? input.attachments
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : [];
  if (!attachmentsLines.length) {
    attachmentsLines.push("—");
  }

  return [
    `Sygnatura: ${signature}`,
    `Data: ${formattedDate}`,
    "Jednostka: Los Santos Police Department",
    `Funkcjonariusz sporządzający: ${officerLine}`,
    "Na podstawie przeprowadzonych czynności służbowych oraz zgromadzonego materiału dowodowego, Los Santos Police Department składa niniejszy wniosek do Prokuratury Los Santos o wszczęcie postępowania przygotowawczego wobec:",
    citizenName,
    `CID: ${cid}`,
    `w związku z uzasadnionym podejrzeniem popełnienia czynu zabronionego określonego w ${articleName}.`,
    `W toku prowadzonych czynności ustalono, że w dniu ${formattedEventDate} na terenie ${eventLocation} ${citizenName} dopuścił/a się czynu polegającego na:`,
    ...descriptionLines,
    "Zgromadzony materiał dowodowy wskazuje na zasadność wszczęcia postępowania przygotowawczego w przedmiotowej sprawie.",
    "W związku z powyższym, Los Santos Police Department wnosi o podjęcie przez Prokuraturę Los Santos dalszych czynności procesowych zmierzających do wyjaśnienia wszystkich okoliczności zdarzenia oraz pociągnięcia sprawcy do odpowiedzialności karnej.",
    "Do wniosku załączono:",
    ...attachmentsLines,
    "Z poważaniem,",
    closingOfficerLine,
    "Los Santos Police Department",
    "Wydział ds. wykroczeń",
  ];
};

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
  const { writeLog } = useLogWriter();
  const previewRef = useRef<HTMLDivElement | null>(null);

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
  const [signature, setSignature] = useState<string>("");

  const authorDetails = useMemo(() => {
    const profile = profiles.find((p) => p.id === currentUid);
    const fullName = (profile?.fullName || "").trim();
    const login = (profile?.login || "").trim();
    const rank = typeof profile?.rank === "string" ? profile.rank.trim() : "";
    const rawBadge = profile?.badgeNumber ?? profile?.badge;
    const badge = rawBadge != null ? String(rawBadge).trim() : "";
    return { fullName, login, rank, badge };
  }, [profiles, currentUid]);

  const authorDisplayName = authorDetails.fullName || authorDetails.login || currentUid || "";

  const uidToName = (uid: string) => {
    const p = profiles.find((x) => x.id === uid);
    return p?.fullName || p?.login || uid;
  };
  const selectedNames = selectedUids.map(uidToName);
  const requiresDossier = !!template?.requiresDossier;
  const requiresVehicleFolder = !!template?.requiresVehicleFolder;
  const vehicleNoteConfig = template?.vehicleNoteConfig;
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
        displayText = String(rawValue);
      }

      if (!displayText) {
        displayText = "—";
      } else {
        displayText = compressMultilineText(displayText) || "—";
      }

      const note = "";

      return {
        id: f.key,
        label: f.label,
        required: !!f.required,
        textValue: displayText,
        note,
        signature: `${displayText}|${note}`,
      };
    });
  }, [template, values]);

  const isWniosekTemplate = template?.slug === "wniosek-o-ukaranie";

  const wniosekContentInput = useMemo(() => {
    if (!isWniosekTemplate) return null;
    return {
      signature: signature,
      date: values["data"] || "",
      citizenName: values["obywatel"] || "",
      cid: values["cid"] || "",
      articleName: values["artykul"] || "",
      eventDate: values["dataZdarzenia"] || "",
      eventLocation: values["miejsceZdarzenia"] || "",
      description: values["opisCzynu"] || "",
      attachments: values["zalaczniki"] || "",
      authorRank: authorDetails.rank,
      authorName: authorDisplayName,
      authorBadge: authorDetails.badge,
    } as WniosekTextInput;
  }, [authorDetails, authorDisplayName, isWniosekTemplate, signature, values]);

  const wniosekPreviewLines = useMemo(
    () => (wniosekContentInput ? buildWniosekTextLines(wniosekContentInput) : []),
    [wniosekContentInput]
  );

  useEffect(() => {
    setSignature("");
  }, [template?.slug]);

  const ensureSignature = useCallback(async (): Promise<string> => {
    if (!template?.signaturePrefix) {
      return "";
    }
    if (signature) {
      return signature;
    }
    const now = new Date();
    const year = now.getFullYear().toString();
    const counterRef = doc(db, DOCUMENT_COUNTERS_COLLECTION, template.slug);
    const nextNumber = await runTransaction(db, async (tx) => {
      const snapshot = await tx.get(counterRef);
      const data = snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : {};
      const rawValue = data?.[year];
      let currentValue = 0;
      if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
        currentValue = rawValue;
      } else if (typeof rawValue === "string") {
        const parsed = Number.parseInt(rawValue, 10);
        if (Number.isFinite(parsed)) {
          currentValue = parsed;
        }
      }
      const nextValue = currentValue + 1;
      tx.set(counterRef, { [year]: nextValue }, { merge: true });
      return nextValue;
    });
    const formattedNumber = nextNumber.toString().padStart(4, "0");
    const newSignature = `${template.signaturePrefix}/${year}/${formattedNumber}`;
    setSignature(newSignature);
    return newSignature;
  }, [signature, template]);

  useEffect(() => {
    if (!template?.signaturePrefix) return;
    if (signature) return;
    void ensureSignature();
  }, [ensureSignature, signature, template?.signaturePrefix]);
  
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

  if (!template) {
    return (
      <AuthGate>
        <div className="min-h-screen screen-shell flex items-center justify-center">
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
      const docSignature = await ensureSignature();
      const signatureForText = docSignature || signature || "";
      await waitForNextFrame();

      const node = previewRef.current;
      if (!node) throw new Error("Brak podglądu do zrzutu.");

      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(node, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      const dataUrls = [canvas.toDataURL("image/png")];
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

      let fieldLinesForText = previewFields.flatMap((field) => {
        const base = `${field.label}: ${field.textValue || "—"}`;
        return field.note ? [base, `  ${field.note}`] : [base];
      });

      const defaultTextContent = previewFields
        .flatMap((field) => {
          const base = `${field.label}: ${field.textValue || "—"}`;
          return field.note ? [base, `  ${field.note}`] : [base];
        })
        .join("\n");
      let textPages = defaultTextContent.trim().length > 0 ? [defaultTextContent] : [];

      if (isWniosekTemplate) {
        const wniosekLinesForStorage = buildWniosekTextLines({
          signature: signatureForText,
          date: values["data"] || "",
          citizenName: values["obywatel"] || "",
          cid: values["cid"] || "",
          articleName: values["artykul"] || "",
          eventDate: values["dataZdarzenia"] || "",
          eventLocation: values["miejsceZdarzenia"] || "",
          description: values["opisCzynu"] || "",
          attachments: values["zalaczniki"] || "",
          authorRank: authorDetails.rank,
          authorName: authorDisplayName,
          authorBadge: authorDetails.badge,
        });
        fieldLinesForText = wniosekLinesForStorage;
        textPages = [wniosekLinesForStorage.join("\n")];
      }

      const documentTextLines = [
        `Dokument: ${template.name}`,
        `Sygnatura: ${signatureForText || "—"}`,
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
        signature: signatureForText,
      };
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
          `Sygnatura: ${signatureForText || "—"}`,
          `Autor: ${userLogin}`,
          "Treść:",
          ...fieldLinesForText,
          `URL: ${primaryImage.url}`,
        ];
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
          `Sygnatura: ${signatureForText || "—"}`,
          `Autor: ${userLogin}`,
          `Link do archiwum: ${primaryImage.url}`,
        ];
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
        await writeLog({
          type: "vehicle_note_from_doc",
          section: "dokumenty",
          action: "vehicle.note.from_doc",
          message: `Dodano notatkę w pojeździe ${vehicleFolderId} na podstawie dokumentu ${template.name}.`,
          details: {
            dokument: template.name,
            szablon: template.slug,
            archiwumId: archiveRef.id,
          },
          vehicleId: vehicleFolderId,
          noteId: noteRef.id,
          archiveId: archiveRef.id,
        });
      }

      // 3) log
      await writeLog({
        type: "doc_sent",
        section: "dokumenty",
        action: "document.send",
        message: `Wygenerowano dokument ${template.name} przez ${userLogin}.`,
        details: {
          funkcjonariusze: selectedNames,
          funkcjonariuszeUid: selectedUids,
        },
        template: template.name,
        login: userLogin,
        officers: selectedNames,
        officersUid: selectedUids,
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
        <Head>
          <title>LSPD 77RP — {template.name}</title>
        </Head>
        <Nav />
        <div className="min-h-screen screen-shell py-8 grid gap-8">
          <button className="btn w-max" onClick={() => history.back()}>← Wróć</button>

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
              <span className="text-xs text-beige-700">Ciągły podgląd • wysoka jakość</span>
            </div>

            <div className="flex flex-col">
              <div
                ref={previewRef}
                className={`doc-preview-surface bg-white text-black mx-auto border border-beige-300 shadow-sm doc-page ${
                  isWniosekTemplate ? "doc-preview--wniosek" : ""
                }`}
              >
                <div
                  className={`flex flex-wrap items-center ${
                    isWniosekTemplate ? "gap-2 mb-2.5" : "gap-2.5 mb-3"
                  }`}
                >
                  <img
                    src="/logo.png"
                    alt="LSPD"
                    className={`floating ${
                      isWniosekTemplate ? "doc-preview-logo doc-preview-logo--compact" : "doc-preview-logo"
                    }`}
                  />
                  <div className={isWniosekTemplate ? "space-y-1" : undefined}>
                    <div
                      className={`${
                        isWniosekTemplate
                          ? "text-base sm:text-lg font-bold leading-tight"
                          : "text-lg sm:text-xl font-bold"
                      }`}
                    >
                      Los Santos Police Department
                    </div>
                    <div
                      className={`${
                        isWniosekTemplate
                          ? "text-[0.7rem] sm:text-[11px] uppercase tracking-[0.16em] text-gray-600"
                          : "text-xs sm:text-sm text-gray-600"
                      }`}
                    >
                      {template.name}
                    </div>
                  </div>
                </div>
                <hr className={`border-beige-300 ${isWniosekTemplate ? "mb-2" : "mb-3"}`} />

                {template.signaturePrefix && !isWniosekTemplate && (
                  <div className="mb-2.5 text-[11px] leading-tight">
                    <span className="font-semibold">Sygnatura:</span> {signature || "—"}
                  </div>
                )}

                <div
                  className={`${
                    isWniosekTemplate ? "mb-2 text-[11px]" : "mb-3 text-[11px]"
                  } whitespace-pre-wrap break-words`}
                >
                  <span className="font-semibold">Funkcjonariusze:</span> {selectedNames.join(", ") || "—"}
                </div>

                {requiresVehicleFolder && (
                  <div className="mb-3 text-[11px] whitespace-pre-wrap break-words">
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

                {isWniosekTemplate ? (
                  <div className="doc-fields text-[11px] leading-[1.3]">
                    {wniosekPreviewLines
                      .map((line) => line.trim())
                      .filter((line) => line.length > 0)
                      .map((line, idx) => (
                        <p
                          key={`wniosek-line-${idx}`}
                          className="whitespace-pre-wrap break-words"
                          style={{ textAlign: line.length > 80 ? "justify" : "left" }}
                        >
                          {line}
                        </p>
                      ))}
                  </div>
                ) : (
                  <div className="doc-fields text-[11px] leading-[1.3]">
                    {previewFields.map((field) => (
                      <FieldBlock key={`${field.id}-${field.signature}`} field={field} />
                    ))}
                  </div>
                )}

                <div className={`${isWniosekTemplate ? "mt-5 text-[10px]" : "mt-6 text-[11px]"} text-gray-600`}>
                  Wygenerowano w panelu LSPD • {new Date().toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </>
    </AuthGate>
  );
}
