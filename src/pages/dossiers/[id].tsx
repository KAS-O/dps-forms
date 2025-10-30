import { useRouter } from "next/router";
import Head from "next/head";
import Nav from "@/components/Nav";
import AuthGate from "@/components/AuthGate";
import {
  ChangeEvent,
  CSSProperties,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { auth, db, storage } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useProfile } from "@/hooks/useProfile";
import { useDialog } from "@/components/DialogProvider";
import { useSessionActivity } from "@/components/ActivityLogger";
import { getActiveVehicleFlags, getVehicleHighlightStyle } from "@/lib/vehicleFlags";

const RECORD_COLORS: Record<string, string> = {
  note: "#7c3aed",
  weapon: "#dc2626",
  drug: "#16a34a",
  explosive: "#f97316",
  member: "#2563eb",
  vehicle: "#0ea5e9",
};

const RECORD_LABELS: Record<string, string> = {
  note: "Notatka",
  weapon: "Dowód — broń",
  drug: "Dowód — narkotyki",
  explosive: "Dowód — materiały wybuchowe",
  member: "Członek organizacji",
  vehicle: "Pojazd organizacji",
};

const MEMBER_RANKS = [
  { value: "rekrut", label: "Rekrut", color: "#f97316" },
  { value: "czlonek", label: "Członek", color: "#2563eb" },
  { value: "wysoki czlonek", label: "Wysoki członek", color: "#1d4ed8" },
  { value: "prawa reka", label: "Prawa ręka", color: "#7c3aed" },
  { value: "zarzad", label: "Zarząd", color: "#db2777" },
  { value: "brak informacji", label: "Brak informacji", color: "#4b5563" },
];

const CONTROLLED_COLOR = "#f97316";

type Attachment = { url: string; name?: string; contentType?: string | null };

type GroupMeta = {
  displayName: string;
  category: string;
  color: string;
  gangColor: string;
  organizationType: string;
  base: string;
  operations: string[];
};

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace(/#/g, "");
  const expanded = raw.length === 3 ? raw.replace(/(.)/g, "$1$1") : raw;
  const bigint = Number.parseInt(expanded, 16);
  // eslint-disable-next-line no-bitwise
  const r = (bigint >> 16) & 255;
  // eslint-disable-next-line no-bitwise
  const g = (bigint >> 8) & 255;
  // eslint-disable-next-line no-bitwise
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildRecordStyle(
  recordType: string,
  controlled: boolean,
  fallbackColor?: string
): CSSProperties {
  const baseColor =
    (recordType === "note" && fallbackColor) || RECORD_COLORS[recordType] || fallbackColor || "#334155";
  if (controlled) {
    return {
      borderLeft: `4px solid ${baseColor}`,
      backgroundImage: `linear-gradient(135deg, ${hexToRgba(CONTROLLED_COLOR, 0.55)}, ${hexToRgba(
        baseColor,
        0.55
      )})`,
      color: "#fff",
    };
  }
  return {
    borderLeft: `4px solid ${baseColor}`,
    backgroundColor: hexToRgba(baseColor, 0.12),
  };
}

function isImage(attachment: Attachment): boolean {
  if (!attachment) return false;
  if (attachment.contentType?.startsWith("image/")) return true;
  if (!attachment.contentType && attachment.url) {
    return /(\.png|\.jpe?g|\.gif|\.webp|\.avif)$/i.test(attachment.url);
  }
  return false;
}

function isVideo(attachment: Attachment): boolean {
  if (!attachment) return false;
  if (attachment.contentType?.startsWith("video/")) return true;
  if (!attachment.contentType && attachment.url) {
    return /(\.mp4|\.webm|\.mov|\.m4v)$/i.test(attachment.url);
  }
  return false;
}

function ensureArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeCid(value: string): string {
  return value.trim().toLowerCase();
}

function getRankMeta(value: string) {
  return MEMBER_RANKS.find((rank) => rank.value === value) || MEMBER_RANKS[MEMBER_RANKS.length - 1];
}

function formatDate(value: any): string {
  if (!value) return new Date().toLocaleString();
  if (typeof value.toDate === "function") {
    return value.toDate().toLocaleString();
  }
  if (value instanceof Date) {
    return value.toLocaleString();
  }
  return new Date(value).toLocaleString();
}

export default function DossierPage() {
  const router = useRouter();
  const { id } = router.query as { id: string };
  const { role } = useProfile();
  const { confirm, prompt, alert } = useDialog();
  const { logActivity, session } = useSessionActivity();

  const [title, setTitle] = useState<string>("");
  const [info, setInfo] = useState<{ first?: string; last?: string; cid?: string }>({});
  const [records, setRecords] = useState<any[]>([]);
  const [linkedVehicles, setLinkedVehicles] = useState<any[]>([]);
  const [allDossiers, setAllDossiers] = useState<any[]>([]);
  const [allVehicles, setAllVehicles] = useState<any[]>([]);
  const [groupMeta, setGroupMeta] = useState<GroupMeta>({
    displayName: "",
    category: "Grupy przestępcze",
    color: "#7c3aed",
    gangColor: "",
    organizationType: "",
    base: "",
    operations: [],
  });
  const [dossierType, setDossierType] = useState<"group" | "person">("person");
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [noteForm, setNoteForm] = useState<{ text: string; files: File[] }>({ text: "", files: [] });
  const [noteSaving, setNoteSaving] = useState(false);

  const [weaponForm, setWeaponForm] = useState({
    model: "",
    serialNumbers: "",
    source: "",
    crimeUsage: "brak informacji",
    date: "",
    time: "",
    purchasePrice: "",
    blackMarketValue: "",
    attachments: [] as File[],
    controlledTransaction: false,
  });
  const [weaponSaving, setWeaponSaving] = useState(false);

  const [drugForm, setDrugForm] = useState({
    type: "",
    quantity: "",
    quality: "",
    date: "",
    time: "",
    place: "",
    source: "",
    purchasePrice: "",
    blackMarketValue: "",
    note: "",
    controlledTransaction: false,
  });
  const [drugSaving, setDrugSaving] = useState(false);

  const [explosiveForm, setExplosiveForm] = useState({
    type: "",
    quantity: "",
    date: "",
    time: "",
    place: "",
    source: "",
    purchasePrice: "",
    blackMarketValue: "",
    note: "",
    controlledTransaction: false,
  });
  const [explosiveSaving, setExplosiveSaving] = useState(false);

  const [memberForm, setMemberForm] = useState({
    dossierId: "",
    name: "",
    cid: "",
    rank: "brak informacji",
    skinColor: "",
    traits: "",
    avatar: null as File | null,
  });
  const [memberSaving, setMemberSaving] = useState(false);

  const [vehicleForm, setVehicleForm] = useState({ vehicleId: "", note: "" });
  const [vehicleSaving, setVehicleSaving] = useState(false);

  const canDeleteDossier = role === "director";
  const canDeleteRecord = useCallback(
    (record: any) => {
      const me = auth.currentUser?.uid;
      return role === "director" || role === "chief" || (!!me && record.authorUid === me);
    },
    [role]
  );

  const canEditRecord = useCallback(
    (record: any) => {
      if ((record?.type || "note") !== "note") return false;
      return canDeleteRecord(record);
    },
    [canDeleteRecord]
  );

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const refDoc = doc(db, "dossiers", id);
        const snap = await getDoc(refDoc);
        if (!snap.exists()) {
          setErr("Nie znaleziono teczki");
          return;
        }
        const data = (snap.data() || {}) as any;
        setTitle((data.title || "") as string);
        setInfo({ first: data.first, last: data.last, cid: data.cid });
        if (data.type === "group") {
          setDossierType("group");
          setGroupMeta({
            displayName: data.displayName || data.title || id,
            category: data.category || "Grupy przestępcze",
            color: data.color || "#7c3aed",
            gangColor: data.gangColor || "",
            organizationType: data.organizationType || "",
            base: data.base || "",
            operations: ensureArray(data.operations),
          });
        } else {
          setDossierType("person");
        }
      } catch (e: any) {
        setErr(e?.message || "Błąd teczki");
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const q = query(collection(db, "dossiers", id, "records"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setRecords(
        snap.docs.map((d) => {
          const data = d.data() as any;
          let attachments: Attachment[] = Array.isArray(data.attachments) ? data.attachments : [];
          if (data.imageUrl) {
            attachments = [
              ...attachments,
              {
                url: data.imageUrl,
                name: data.imageName || "Dowód",
                contentType: data.imageContentType || "image/jpeg",
              },
            ];
          }
          return { id: d.id, ...data, attachments };
        })
      );
    });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const q = query(collection(db, "vehicleFolders"), where("ownerCidNormalized", "==", id));
    return onSnapshot(q, (snap) => {
      setLinkedVehicles(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    });
  }, [id]);

  useEffect(() => {
    if (dossierType !== "group") return;
    (async () => {
      try {
        const dossierSnap = await getDocs(collection(db, "dossiers"));
        setAllDossiers(
          dossierSnap.docs
            .map((d) => ({ id: d.id, ...(d.data() as any) }))
            .filter((d) => d.type !== "group")
        );
        const vehicleSnap = await getDocs(query(collection(db, "vehicleFolders"), orderBy("createdAt", "desc")));
        setAllVehicles(vehicleSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      } catch (e: any) {
        setErr((prev) => prev || e?.message || "Błąd podczas pobierania danych");
      }
    })();
  }, [dossierType]);

  useEffect(() => {
    if (!id || !session) return;
    void logActivity({ type: "dossier_view", dossierId: id });
  }, [id, logActivity, session]);

  const pageTitle = useMemo(() => {
    if (dossierType === "group") {
      return groupMeta.displayName || title || "Teczka organizacji";
    }
    const n = [info.first, info.last].filter(Boolean).join(" ");
    return n ? `${title || "Teczka"} • ${n} (CID: ${info.cid || "?"})` : title || "Teczka";
  }, [dossierType, groupMeta.displayName, info, title]);

  const memberRecords = useMemo(
    () => records.filter((record) => (record?.type || "note") === "member"),
    [records]
  );

  const vehicleRecords = useMemo(
    () => records.filter((record) => (record?.type || "note") === "vehicle"),
    [records]
  );

  const uploadEvidenceFiles = useCallback(
    async (files: File[], scope: string): Promise<Attachment[]> => {
      if (!id || !files.length) return [];
      const uploads = await Promise.all(
        files.map(async (file) => {
          const fileRef = ref(storage, `dossiers/${id}/${scope}/${Date.now()}_${file.name}`);
          await uploadBytes(fileRef, file);
          const url = await getDownloadURL(fileRef);
          return { url, name: file.name, contentType: file.type };
        })
      );
      return uploads;
    },
    [id]
  );

  const handleAddNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id) return;
    if (!noteForm.text.trim() && noteForm.files.length === 0) {
      setErr("Dodaj treść notatki lub załącznik.");
      return;
    }
    try {
      setErr(null);
      setNoteSaving(true);
      const attachments = await uploadEvidenceFiles(noteForm.files, "notes");
      await addDoc(collection(db, "dossiers", id, "records"), {
        type: "note",
        text: noteForm.text.trim(),
        attachments,
        createdAt: serverTimestamp(),
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
      });
      await addDoc(collection(db, "logs"), {
        type: "dossier_record_add",
        dossierId: id,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setNoteForm({ text: "", files: [] });
    } catch (e: any) {
      setErr(e?.message || "Nie udało się dodać notatki.");
    } finally {
      setNoteSaving(false);
    }
  };

  const handleNoteFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    setNoteForm((prev) => ({ ...prev, files }));
  };

  const handleWeaponFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    setWeaponForm((prev) => ({ ...prev, attachments: files }));
  };

  const handleMemberAvatarChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setMemberForm((prev) => ({ ...prev, avatar: file }));
  };

  const handleAddWeapon = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id) return;
    if (!weaponForm.model.trim()) {
      setErr("Podaj model broni.");
      return;
    }
    try {
      setErr(null);
      setWeaponSaving(true);
      const attachments = await uploadEvidenceFiles(weaponForm.attachments, "weapons");
      const serialNumbers = ensureArray(weaponForm.serialNumbers);
      await addDoc(collection(db, "dossiers", id, "records"), {
        type: "weapon",
        model: weaponForm.model.trim(),
        serialNumbers,
        source: weaponForm.source.trim(),
        crimeUsage: weaponForm.crimeUsage,
        date: weaponForm.date,
        time: weaponForm.time,
        purchasePrice: weaponForm.purchasePrice,
        blackMarketValue: weaponForm.blackMarketValue,
        controlledTransaction: weaponForm.controlledTransaction,
        attachments,
        createdAt: serverTimestamp(),
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
      });
      await addDoc(collection(db, "logs"), {
        type: "dossier_record_add",
        dossierId: id,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setWeaponForm({
        model: "",
        serialNumbers: "",
        source: "",
        crimeUsage: "brak informacji",
        date: "",
        time: "",
        purchasePrice: "",
        blackMarketValue: "",
        attachments: [],
        controlledTransaction: false,
      });
    } catch (e: any) {
      setErr(e?.message || "Nie udało się dodać dowodu broni.");
    } finally {
      setWeaponSaving(false);
    }
  };

  const handleAddDrug = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id) return;
    if (!drugForm.type.trim()) {
      setErr("Podaj rodzaj narkotyku.");
      return;
    }
    if (!drugForm.quantity.trim()) {
      setErr("Podaj ilość narkotyku w gramach.");
      return;
    }
    try {
      setErr(null);
      setDrugSaving(true);
      await addDoc(collection(db, "dossiers", id, "records"), {
        type: "drug",
        drugType: drugForm.type.trim(),
        quantity: drugForm.quantity.trim(),
        quality: drugForm.quality.trim(),
        date: drugForm.date,
        time: drugForm.time,
        place: drugForm.place.trim(),
        source: drugForm.source.trim(),
        purchasePrice: drugForm.purchasePrice,
        blackMarketValue: drugForm.blackMarketValue,
        note: drugForm.note.trim(),
        controlledTransaction: drugForm.controlledTransaction,
        createdAt: serverTimestamp(),
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
      });
      await addDoc(collection(db, "logs"), {
        type: "dossier_record_add",
        dossierId: id,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setDrugForm({
        type: "",
        quantity: "",
        quality: "",
        date: "",
        time: "",
        place: "",
        source: "",
        purchasePrice: "",
        blackMarketValue: "",
        note: "",
        controlledTransaction: false,
      });
    } catch (e: any) {
      setErr(e?.message || "Nie udało się dodać dowodu narkotykowego.");
    } finally {
      setDrugSaving(false);
    }
  };

  const handleAddExplosive = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id) return;
    if (!explosiveForm.type.trim()) {
      setErr("Podaj rodzaj materiału wybuchowego.");
      return;
    }
    try {
      setErr(null);
      setExplosiveSaving(true);
      await addDoc(collection(db, "dossiers", id, "records"), {
        type: "explosive",
        explosiveType: explosiveForm.type.trim(),
        quantity: explosiveForm.quantity.trim(),
        date: explosiveForm.date,
        time: explosiveForm.time,
        place: explosiveForm.place.trim(),
        source: explosiveForm.source.trim(),
        purchasePrice: explosiveForm.purchasePrice,
        blackMarketValue: explosiveForm.blackMarketValue,
        note: explosiveForm.note.trim(),
        controlledTransaction: explosiveForm.controlledTransaction,
        createdAt: serverTimestamp(),
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
      });
      await addDoc(collection(db, "logs"), {
        type: "dossier_record_add",
        dossierId: id,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setExplosiveForm({
        type: "",
        quantity: "",
        date: "",
        time: "",
        place: "",
        source: "",
        purchasePrice: "",
        blackMarketValue: "",
        note: "",
        controlledTransaction: false,
      });
    } catch (e: any) {
      setErr(e?.message || "Nie udało się dodać dowodu materiałów wybuchowych.");
    } finally {
      setExplosiveSaving(false);
    }
  };

  const handleAddMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id) return;
    if (!memberForm.name.trim()) {
      setErr("Podaj imię i nazwisko członka organizacji.");
      return;
    }
    if (!memberForm.cid.trim()) {
      setErr("Podaj CID członka organizacji.");
      return;
    }
    try {
      setErr(null);
      setMemberSaving(true);
      const avatarAttachment = memberForm.avatar
        ? (await uploadEvidenceFiles([memberForm.avatar], "members"))[0]
        : undefined;
      const normalizedCid = normalizeCid(memberForm.cid);
      await addDoc(collection(db, "dossiers", id, "records"), {
        type: "member",
        linkedDossierId: memberForm.dossierId || (normalizedCid || null),
        dossierId: memberForm.dossierId || null,
        name: memberForm.name.trim(),
        cid: memberForm.cid.trim(),
        rank: memberForm.rank,
        skinColor: memberForm.skinColor.trim(),
        traits: memberForm.traits.trim(),
        avatarUrl: avatarAttachment?.url || null,
        avatarContentType: avatarAttachment?.contentType || null,
        createdAt: serverTimestamp(),
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
      });
      await addDoc(collection(db, "logs"), {
        type: "dossier_record_add",
        dossierId: id,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setMemberForm({
        dossierId: "",
        name: "",
        cid: "",
        rank: "brak informacji",
        skinColor: "",
        traits: "",
        avatar: null,
      });
    } catch (e: any) {
      setErr(e?.message || "Nie udało się dodać członka organizacji.");
    } finally {
      setMemberSaving(false);
    }
  };

  const handleAddVehicle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!id) return;
    if (!vehicleForm.vehicleId) {
      setErr("Wybierz pojazd, który ma zostać przypisany do organizacji.");
      return;
    }
    const vehicle = allVehicles.find((v) => v.id === vehicleForm.vehicleId);
    if (!vehicle) {
      setErr("Nie udało się odnaleźć wybranego pojazdu.");
      return;
    }
    try {
      setErr(null);
      setVehicleSaving(true);
      await addDoc(collection(db, "dossiers", id, "records"), {
        type: "vehicle",
        vehicleId: vehicle.id,
        registration: vehicle.registration || "",
        brand: vehicle.brand || "",
        color: vehicle.color || "",
        ownerName: vehicle.ownerName || "",
        note: vehicleForm.note.trim(),
        createdAt: serverTimestamp(),
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
      });
      await addDoc(collection(db, "logs"), {
        type: "dossier_record_add",
        dossierId: id,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setVehicleForm({ vehicleId: "", note: "" });
    } catch (e: any) {
      setErr(e?.message || "Nie udało się dodać pojazdu.");
    } finally {
      setVehicleSaving(false);
    }
  };

  const editRecord = async (rid: string, currentText: string) => {
    const t = await prompt({
      title: "Edycja notatki",
      message: "Zaktualizuj treść notatki.",
      defaultValue: currentText,
      multiline: true,
      inputLabel: "Treść wpisu",
      confirmLabel: "Zapisz zmiany",
    });
    if (t == null) return;
    if (!t.trim()) {
      await alert({
        title: "Puste pole",
        message: "Treść wpisu nie może być pusta.",
        tone: "info",
      });
      return;
    }
    await updateDoc(doc(db, "dossiers", id, "records", rid), { text: t });
    await addDoc(collection(db, "logs"), {
      type: "dossier_record_edit",
      dossierId: id,
      recordId: rid,
      author: auth.currentUser?.email || "",
      ts: serverTimestamp(),
    });
  };

  const deleteRecord = async (rid: string) => {
    const ok = await confirm({
      title: "Usuń wpis",
      message: "Czy na pewno chcesz usunąć ten wpis z teczki?",
      confirmLabel: "Usuń",
      tone: "danger",
    });
    if (!ok) return;
    await deleteDoc(doc(db, "dossiers", id, "records", rid));
    await addDoc(collection(db, "logs"), {
      type: "dossier_record_delete",
      dossierId: id,
      recordId: rid,
      author: auth.currentUser?.email || "",
      ts: serverTimestamp(),
    });
  };

  const deleteDossier = async () => {
    if (!id || !canDeleteDossier) return;
    const ok = await confirm({
      title: "Usuń teczkę",
      message: "Na pewno usunąć całą teczkę wraz z wszystkimi wpisami? Tej operacji nie można cofnąć.",
      confirmLabel: "Usuń teczkę",
      tone: "danger",
    });
    if (!ok) return;
    try {
      setErr(null);
      setDeleting(true);
      const recordsSnap = await getDocs(collection(db, "dossiers", id, "records"));
      const batch = writeBatch(db);
      recordsSnap.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      batch.delete(doc(db, "dossiers", id));
      await batch.commit();
      await addDoc(collection(db, "logs"), {
        type: "dossier_delete",
        dossierId: id,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      await router.replace("/dossiers");
    } catch (e: any) {
      setErr(e?.message || "Nie udało się usunąć teczki.");
    } finally {
      setDeleting(false);
    }
  };

  const renderAttachments = (attachments?: Attachment[]) => {
    if (!attachments?.length) return null;
    return (
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {attachments.map((attachment, index) => {
          if (isImage(attachment)) {
            return (
              <img
                key={`${attachment.url}-${index}`}
                src={attachment.url}
                alt={attachment.name || "Załącznik"}
                className="w-full rounded-lg border border-white/20 object-cover"
              />
            );
          }
          if (isVideo(attachment)) {
            return (
              <video
                key={`${attachment.url}-${index}`}
                src={attachment.url}
                controls
                className="w-full rounded-lg border border-white/20"
              />
            );
          }
          return (
            <a
              key={`${attachment.url}-${index}`}
              className="block rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm underline"
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
            >
              {attachment.name || "Pobierz załącznik"}
            </a>
          );
        })}
      </div>
    );
  };

  const renderRecord = (record: any) => {
    const recordType = (record?.type || "note") as string;
    const controlled = Boolean(record?.controlledTransaction);
    const style = buildRecordStyle(recordType, controlled, dossierType === "group" ? groupMeta.color : undefined);
    const createdAt = formatDate(record?.createdAt);
    const author = record?.author || record?.authorUid || "Nieznany autor";
    const rankMeta = recordType === "member" ? getRankMeta(record?.rank || "") : null;
    const dossierLink = record?.linkedDossierId || record?.dossierId;

    return (
      <div key={record.id} className="card p-4" style={style}>
        <div className="mb-2 flex flex-col gap-1 text-sm text-white/80 md:flex-row md:items-start md:justify-between">
          <div>{createdAt} • {author}</div>
          <div className="uppercase tracking-[0.2em] text-xs font-semibold">
            {RECORD_LABELS[recordType] || "Wpis"}
          </div>
        </div>
        {controlled && (
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold uppercase">
            Transakcja kontrolowana
          </div>
        )}
        {recordType === "note" && (
          <>
            {record.text && <div className="whitespace-pre-wrap text-sm text-white/90">{record.text}</div>}
            {renderAttachments(record.attachments)}
          </>
        )}
        {recordType === "weapon" && (
          <div className="grid gap-1 text-sm text-white/90">
            <div><span className="font-semibold">Model:</span> {record.model || "—"}</div>
            <div>
              <span className="font-semibold">Numery seryjne:</span> {ensureArray(record.serialNumbers).join(", ") || "—"}
            </div>
            <div><span className="font-semibold">Źródło:</span> {record.source || "—"}</div>
            <div><span className="font-semibold">Czy użyta do przestępstwa:</span> {record.crimeUsage || "Brak informacji"}</div>
            <div><span className="font-semibold">Data:</span> {record.date || "—"} {record.time ? `• ${record.time}` : ""}</div>
            <div><span className="font-semibold">Cena zakupu:</span> {record.purchasePrice || "—"}</div>
            <div><span className="font-semibold">Wartość czarnorynkowa:</span> {record.blackMarketValue || "—"}</div>
            {renderAttachments(record.attachments)}
          </div>
        )}
        {recordType === "drug" && (
          <div className="grid gap-1 text-sm text-white/90">
            <div><span className="font-semibold">Rodzaj:</span> {record.drugType || "—"}</div>
            <div><span className="font-semibold">Ilość:</span> {record.quantity || "—"} g</div>
            <div><span className="font-semibold">Jakość:</span> {record.quality || "—"}</div>
            <div><span className="font-semibold">Data:</span> {record.date || "—"} {record.time ? `• ${record.time}` : ""}</div>
            <div><span className="font-semibold">Miejsce:</span> {record.place || "—"}</div>
            <div><span className="font-semibold">Od kogo:</span> {record.source || "—"}</div>
            <div><span className="font-semibold">Cena zakupu:</span> {record.purchasePrice || "—"}</div>
            <div><span className="font-semibold">Wartość czarnorynkowa:</span> {record.blackMarketValue || "—"}</div>
            {record.note && (
              <div className="mt-1 whitespace-pre-wrap text-sm text-white/90">
                <span className="font-semibold">Notatka:</span> {record.note}
              </div>
            )}
          </div>
        )}
        {recordType === "explosive" && (
          <div className="grid gap-1 text-sm text-white/90">
            <div><span className="font-semibold">Rodzaj:</span> {record.explosiveType || "—"}</div>
            <div><span className="font-semibold">Ilość:</span> {record.quantity || "—"}</div>
            <div><span className="font-semibold">Data:</span> {record.date || "—"} {record.time ? `• ${record.time}` : ""}</div>
            <div><span className="font-semibold">Miejsce:</span> {record.place || "—"}</div>
            <div><span className="font-semibold">Od kogo:</span> {record.source || "—"}</div>
            <div><span className="font-semibold">Cena zakupu:</span> {record.purchasePrice || "—"}</div>
            <div><span className="font-semibold">Wartość czarnorynkowa:</span> {record.blackMarketValue || "—"}</div>
            {record.note && (
              <div className="mt-1 whitespace-pre-wrap text-sm text-white/90">
                <span className="font-semibold">Notatka:</span> {record.note}
              </div>
            )}
          </div>
        )}
        {recordType === "member" && (
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            {record.avatarUrl && (
              <img
                src={record.avatarUrl}
                alt={record.name || "Członek"}
                className="h-24 w-24 rounded-full border-4 border-white/30 object-cover"
              />
            )}
            <div className="flex-1 text-sm text-white/90">
              <div className="text-lg font-semibold text-white">{record.name || "Nieznana osoba"}</div>
              <div className="text-sm text-white/80">CID: {record.cid || "—"}</div>
              {rankMeta && (
                <span
                  className="mt-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase"
                  style={{ backgroundColor: hexToRgba(rankMeta.color, 0.25), color: "#fff" }}
                >
                  {rankMeta.label}
                </span>
              )}
              <div className="mt-2 grid gap-1">
                {record.skinColor && (
                  <div><span className="font-semibold">Kolor skóry:</span> {record.skinColor}</div>
                )}
                {record.traits && (
                  <div className="whitespace-pre-wrap"><span className="font-semibold">Cechy szczególne:</span> {record.traits}</div>
                )}
              </div>
              {dossierLink && (
                <a className="mt-3 inline-flex text-sm underline" href={`/dossiers/${dossierLink}`}>
                  Przejdź do teczki
                </a>
              )}
            </div>
          </div>
        )}
        {recordType === "vehicle" && (
          <div className="grid gap-1 text-sm text-white/90">
            <div><span className="font-semibold">Numer rejestracyjny:</span> {record.registration || "—"}</div>
            <div><span className="font-semibold">Marka:</span> {record.brand || "—"}</div>
            <div><span className="font-semibold">Kolor:</span> {record.color || "—"}</div>
            <div><span className="font-semibold">Właściciel:</span> {record.ownerName || "—"}</div>
            {record.note && (
              <div className="mt-1 whitespace-pre-wrap text-sm text-white/90">
                <span className="font-semibold">Notatka:</span> {record.note}
              </div>
            )}
            {record.vehicleId && (
              <a className="mt-2 inline-flex text-sm underline" href={`/vehicle-archive/${record.vehicleId}`}>
                Otwórz teczkę pojazdu
              </a>
            )}
          </div>
        )}
        {(canEditRecord(record) || canDeleteRecord(record)) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {canEditRecord(record) && (
              <button className="btn" onClick={() => editRecord(record.id, record.text || "")}>
                Edytuj
              </button>
            )}
            {canDeleteRecord(record) && (
              <button className="btn bg-red-700 text-white" onClick={() => deleteRecord(record.id)}>
                Usuń
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — {pageTitle}</title>
        </Head>
        <Nav />
        <div className="max-w-6xl mx-auto px-4 py-6 grid gap-4">
          {err && <div className="card bg-red-50 p-3 text-red-700">{err}</div>}
          <div className="card flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
            <h1 className="text-xl font-bold text-white">{pageTitle}</h1>
            {canDeleteDossier && (
              <button className="btn bg-red-700 text-white" onClick={deleteDossier} disabled={deleting}>
                {deleting ? "Usuwanie..." : "Usuń teczkę"}
              </button>
            )}
          </div>

          {dossierType === "group" && (
            <div className="grid gap-4">
              <div
                className="card p-5 text-white shadow-lg"
                style={buildRecordStyle("note", false, groupMeta.color)}
              >
                <div className="text-xs uppercase tracking-[0.3em] text-white/80">{groupMeta.category}</div>
                <div className="mt-2 text-2xl font-bold">{groupMeta.displayName}</div>
                <div className="mt-3 grid gap-1 text-sm text-white/90 md:grid-cols-2">
                  <div><span className="font-semibold">Kolorystyka gangu:</span> {groupMeta.gangColor || "Fioletowa"}</div>
                  <div><span className="font-semibold">Rodzaj organizacji:</span> {groupMeta.organizationType || "Gang uliczny"}</div>
                  <div><span className="font-semibold">Baza:</span> {groupMeta.base || "Grove Street"}</div>
                  <div className="md:col-span-2">
                    <span className="font-semibold">Zakres działalności:</span>
                    <ul className="mt-2 list-disc list-inside space-y-1">
                      {(groupMeta.operations.length ? groupMeta.operations : [
                        "Handel narkotykami",
                        "Handel bronią",
                        "Handel materiałami wybuchowymi",
                        "Tworzenie materiałów wybuchowych",
                        "Napady",
                        "Wyłudzenia",
                        "Porwania",
                        "Strzelaniny",
                        "Pranie pieniędzy",
                      ]).map((operation) => (
                        <li key={operation}>{operation}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {memberRecords.length > 0 && (
                <div className="card p-4">
                  <h2 className="text-lg font-semibold text-white">Członkowie organizacji</h2>
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    {memberRecords.map((member) => {
                      const rankMeta = getRankMeta(member.rank || "");
                      return (
                        <div
                          key={member.id}
                          className="flex gap-3 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/90"
                        >
                          {member.avatarUrl ? (
                            <img
                              src={member.avatarUrl}
                              alt={member.name || "Członek"}
                              className="h-16 w-16 rounded-full border-2 border-white/30 object-cover"
                            />
                          ) : (
                            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-lg font-semibold">
                              {(member.name || "?").slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <div className="flex-1">
                            <div className="text-base font-semibold text-white">{member.name || "—"}</div>
                            <div className="text-xs text-white/70">CID: {member.cid || "—"}</div>
                            <span
                              className="mt-2 inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase"
                              style={{ backgroundColor: hexToRgba(rankMeta.color, 0.25), color: "#fff" }}
                            >
                              {rankMeta.label}
                            </span>
                            {member.traits && (
                              <div className="mt-2 text-xs text-white/80">{member.traits}</div>
                            )}
                            {(member.linkedDossierId || member.dossierId) && (
                              <a
                                className="mt-2 inline-flex text-xs underline"
                                href={`/dossiers/${member.linkedDossierId || member.dossierId}`}
                              >
                                Przejdź do teczki
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {vehicleRecords.length > 0 && (
                <div className="card p-4">
                  <h2 className="text-lg font-semibold text-white">Pojazdy organizacji</h2>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {vehicleRecords.map((vehicle) => (
                      <a
                        key={vehicle.id}
                        href={vehicle.vehicleId ? `/vehicle-archive/${vehicle.vehicleId}` : "#"}
                        className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/90 transition hover:bg-white/10"
                      >
                        <div className="text-base font-semibold text-white">{vehicle.registration || "—"}</div>
                        <div>{vehicle.brand || "—"}</div>
                        <div>Kolor: {vehicle.color || "—"}</div>
                        <div>Właściciel: {vehicle.ownerName || "—"}</div>
                        {vehicle.note && <div className="mt-2 text-xs text-white/80">{vehicle.note}</div>}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {dossierType === "person" && (
            <div className="card p-4">
              <h2 className="text-lg font-semibold text-white">Powiązane pojazdy</h2>
              {linkedVehicles.length > 0 ? (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {linkedVehicles.map((vehicle) => {
                    const highlight = getVehicleHighlightStyle(vehicle?.statuses);
                    const activeFlags = highlight?.active || getActiveVehicleFlags(vehicle?.statuses);
                    return (
                      <a
                        key={vehicle.id}
                        href={`/vehicle-archive/${vehicle.id}`}
                        className={`card p-3 transition hover:shadow-xl ${highlight ? "text-white" : ""}`}
                        style={highlight?.style || undefined}
                        onClick={() => {
                          if (!session) return;
                          void logActivity({
                            type: "vehicle_from_dossier_open",
                            dossierId: id,
                            vehicleId: vehicle.id,
                          });
                        }}
                      >
                        <div className="font-semibold text-lg">{vehicle.registration}</div>
                        <div className="text-sm opacity-80">{vehicle.brand} • Kolor: {vehicle.color}</div>
                        <div className="text-sm opacity-80">Właściciel: {vehicle.ownerName}</div>
                        {activeFlags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {activeFlags.map((flag) => (
                              <span
                                key={flag.key}
                                className="rounded-full border border-white/40 bg-black/30 px-2 py-1 text-xs font-semibold"
                              >
                                {flag.icon} {flag.label}
                              </span>
                            ))}
                          </div>
                        )}
                      </a>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 text-sm text-white/80">Brak powiązanych pojazdów.</p>
              )}
            </div>
          )}

          <form onSubmit={handleAddNote} className="card grid gap-3 p-4">
            <h2 className="text-lg font-semibold text-white">Dodaj notatkę</h2>
            <textarea
              className="input h-28"
              placeholder="Treść notatki..."
              value={noteForm.text}
              onChange={(event) => setNoteForm((prev) => ({ ...prev, text: event.target.value }))}
            />
            <input type="file" accept="image/*" multiple onChange={handleNoteFilesChange} />
            <div className="flex gap-2">
              <button className="btn" type="submit" disabled={noteSaving}>
                {noteSaving ? "Zapisywanie..." : "Dodaj"}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => setNoteForm({ text: "", files: [] })}
              >
                Wyczyść
              </button>
            </div>
          </form>

          {dossierType === "group" && (
            <div className="grid gap-4">
              <form onSubmit={handleAddWeapon} className="card grid gap-3 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">Dodaj broń jako dowód</h2>
                  <button
                    type="button"
                    className={`btn ${weaponForm.controlledTransaction ? "bg-orange-500 text-white" : ""}`}
                    onClick={() =>
                      setWeaponForm((prev) => ({
                        ...prev,
                        controlledTransaction: !prev.controlledTransaction,
                      }))
                    }
                  >
                    {weaponForm.controlledTransaction ? "Transakcja kontrolowana — włączona" : "Transakcja kontrolowana"}
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    className="input"
                    placeholder="Model broni"
                    value={weaponForm.model}
                    onChange={(event) => setWeaponForm((prev) => ({ ...prev, model: event.target.value }))}
                    required
                  />
                  <input
                    className="input"
                    placeholder="Źródło (od kogo)"
                    value={weaponForm.source}
                    onChange={(event) => setWeaponForm((prev) => ({ ...prev, source: event.target.value }))}
                  />
                  <textarea
                    className="input md:col-span-2"
                    placeholder="Numery seryjne (oddzielone przecinkami lub nowymi liniami)"
                    value={weaponForm.serialNumbers}
                    onChange={(event) =>
                      setWeaponForm((prev) => ({ ...prev, serialNumbers: event.target.value }))
                    }
                  />
                  <select
                    className="input"
                    value={weaponForm.crimeUsage}
                    onChange={(event) => setWeaponForm((prev) => ({ ...prev, crimeUsage: event.target.value }))}
                  >
                    <option value="tak">Tak</option>
                    <option value="nie">Nie</option>
                    <option value="brak informacji">Brak informacji</option>
                  </select>
                  <input
                    className="input"
                    type="date"
                    value={weaponForm.date}
                    onChange={(event) => setWeaponForm((prev) => ({ ...prev, date: event.target.value }))}
                  />
                  <input
                    className="input"
                    type="time"
                    value={weaponForm.time}
                    onChange={(event) => setWeaponForm((prev) => ({ ...prev, time: event.target.value }))}
                  />
                  <input
                    className="input"
                    placeholder="Cena zakupu"
                    value={weaponForm.purchasePrice}
                    onChange={(event) => setWeaponForm((prev) => ({ ...prev, purchasePrice: event.target.value }))}
                  />
                  <input
                    className="input"
                    placeholder="Wartość czarnorynkowa"
                    value={weaponForm.blackMarketValue}
                    onChange={(event) =>
                      setWeaponForm((prev) => ({ ...prev, blackMarketValue: event.target.value }))
                    }
                  />
                </div>
                <input type="file" multiple onChange={handleWeaponFilesChange} />
                <button className="btn" type="submit" disabled={weaponSaving}>
                  {weaponSaving ? "Zapisywanie..." : "Dodaj dowód"}
                </button>
              </form>

              <form onSubmit={handleAddDrug} className="card grid gap-3 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">Dodaj narkotyki jako dowód</h2>
                  <button
                    type="button"
                    className={`btn ${drugForm.controlledTransaction ? "bg-orange-500 text-white" : ""}`}
                    onClick={() =>
                      setDrugForm((prev) => ({ ...prev, controlledTransaction: !prev.controlledTransaction }))
                    }
                  >
                    {drugForm.controlledTransaction ? "Transakcja kontrolowana — włączona" : "Transakcja kontrolowana"}
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    className="input"
                    placeholder="Rodzaj narkotyku"
                    value={drugForm.type}
                    onChange={(event) => setDrugForm((prev) => ({ ...prev, type: event.target.value }))}
                    required
                  />
                  <input
                    className="input"
                    placeholder="Ilość (g)"
                    value={drugForm.quantity}
                    onChange={(event) => setDrugForm((prev) => ({ ...prev, quantity: event.target.value }))}
                    required
                  />
                  <input
                    className="input"
                    placeholder="Jakość"
                    value={drugForm.quality}
                    onChange={(event) => setDrugForm((prev) => ({ ...prev, quality: event.target.value }))}
                  />
                  <input
                    className="input"
                    type="date"
                    value={drugForm.date}
                    onChange={(event) => setDrugForm((prev) => ({ ...prev, date: event.target.value }))}
                  />
                  <input
                    className="input"
                    type="time"
                    value={drugForm.time}
                    onChange={(event) => setDrugForm((prev) => ({ ...prev, time: event.target.value }))}
                  />
                  <input
                    className="input"
                    placeholder="Miejsce"
                    value={drugForm.place}
                    onChange={(event) => setDrugForm((prev) => ({ ...prev, place: event.target.value }))}
                  />
                  <input
                    className="input"
                    placeholder="Od kogo"
                    value={drugForm.source}
                    onChange={(event) => setDrugForm((prev) => ({ ...prev, source: event.target.value }))}
                  />
                  <input
                    className="input"
                    placeholder="Cena zakupu"
                    value={drugForm.purchasePrice}
                    onChange={(event) => setDrugForm((prev) => ({ ...prev, purchasePrice: event.target.value }))}
                  />
                  <input
                    className="input"
                    placeholder="Wartość czarnorynkowa"
                    value={drugForm.blackMarketValue}
                    onChange={(event) =>
                      setDrugForm((prev) => ({ ...prev, blackMarketValue: event.target.value }))
                    }
                  />
                  <textarea
                    className="input md:col-span-2"
                    placeholder="Dodatkowa notatka"
                    value={drugForm.note}
                    onChange={(event) => setDrugForm((prev) => ({ ...prev, note: event.target.value }))}
                  />
                </div>
                <button className="btn" type="submit" disabled={drugSaving}>
                  {drugSaving ? "Zapisywanie..." : "Dodaj dowód"}
                </button>
              </form>

              <form onSubmit={handleAddExplosive} className="card grid gap-3 p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">Dodaj materiał wybuchowy</h2>
                  <button
                    type="button"
                    className={`btn ${explosiveForm.controlledTransaction ? "bg-orange-500 text-white" : ""}`}
                    onClick={() =>
                      setExplosiveForm((prev) => ({
                        ...prev,
                        controlledTransaction: !prev.controlledTransaction,
                      }))
                    }
                  >
                    {explosiveForm.controlledTransaction ? "Transakcja kontrolowana — włączona" : "Transakcja kontrolowana"}
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    className="input"
                    placeholder="Rodzaj materiału"
                    value={explosiveForm.type}
                    onChange={(event) => setExplosiveForm((prev) => ({ ...prev, type: event.target.value }))}
                    required
                  />
                  <input
                    className="input"
                    placeholder="Ilość"
                    value={explosiveForm.quantity}
                    onChange={(event) => setExplosiveForm((prev) => ({ ...prev, quantity: event.target.value }))}
                  />
                  <input
                    className="input"
                    type="date"
                    value={explosiveForm.date}
                    onChange={(event) => setExplosiveForm((prev) => ({ ...prev, date: event.target.value }))}
                  />
                  <input
                    className="input"
                    type="time"
                    value={explosiveForm.time}
                    onChange={(event) => setExplosiveForm((prev) => ({ ...prev, time: event.target.value }))}
                  />
                  <input
                    className="input"
                    placeholder="Miejsce"
                    value={explosiveForm.place}
                    onChange={(event) => setExplosiveForm((prev) => ({ ...prev, place: event.target.value }))}
                  />
                  <input
                    className="input"
                    placeholder="Od kogo"
                    value={explosiveForm.source}
                    onChange={(event) => setExplosiveForm((prev) => ({ ...prev, source: event.target.value }))}
                  />
                  <input
                    className="input"
                    placeholder="Cena zakupu"
                    value={explosiveForm.purchasePrice}
                    onChange={(event) =>
                      setExplosiveForm((prev) => ({ ...prev, purchasePrice: event.target.value }))
                    }
                  />
                  <input
                    className="input"
                    placeholder="Wartość czarnorynkowa"
                    value={explosiveForm.blackMarketValue}
                    onChange={(event) =>
                      setExplosiveForm((prev) => ({ ...prev, blackMarketValue: event.target.value }))
                    }
                  />
                  <textarea
                    className="input md:col-span-2"
                    placeholder="Notatka"
                    value={explosiveForm.note}
                    onChange={(event) => setExplosiveForm((prev) => ({ ...prev, note: event.target.value }))}
                  />
                </div>
                <button className="btn" type="submit" disabled={explosiveSaving}>
                  {explosiveSaving ? "Zapisywanie..." : "Dodaj dowód"}
                </button>
              </form>

              <form onSubmit={handleAddMember} className="card grid gap-3 p-4">
                <h2 className="text-lg font-semibold text-white">Dodaj członka grupy</h2>
                <select
                  className="input"
                  value={memberForm.dossierId}
                  onChange={(event) => {
                    const dossierId = event.target.value;
                    const dossier = allDossiers.find((d) => d.id === dossierId);
                    setMemberForm((prev) => ({
                      ...prev,
                      dossierId,
                      name:
                        dossierId && dossier
                          ? [dossier.first, dossier.last].filter(Boolean).join(" ") || prev.name
                          : prev.name,
                      cid: dossierId && dossier ? dossier.cid || prev.cid : prev.cid,
                    }));
                  }}
                >
                  <option value="">Brak powiązanej teczki</option>
                  {allDossiers.map((dossier) => (
                    <option key={dossier.id} value={dossier.id}>
                      {dossier.title || `${dossier.first || ""} ${dossier.last || ""} (${dossier.cid || dossier.id})`}
                    </option>
                  ))}
                </select>
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    className="input"
                    placeholder="Imię i nazwisko"
                    value={memberForm.name}
                    onChange={(event) => setMemberForm((prev) => ({ ...prev, name: event.target.value }))}
                    required
                  />
                  <input
                    className="input"
                    placeholder="CID"
                    value={memberForm.cid}
                    onChange={(event) => setMemberForm((prev) => ({ ...prev, cid: event.target.value }))}
                    required
                  />
                  <select
                    className="input"
                    value={memberForm.rank}
                    onChange={(event) => setMemberForm((prev) => ({ ...prev, rank: event.target.value }))}
                  >
                    {MEMBER_RANKS.map((rank) => (
                      <option key={rank.value} value={rank.value}>
                        {rank.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    placeholder="Kolor skóry"
                    value={memberForm.skinColor}
                    onChange={(event) => setMemberForm((prev) => ({ ...prev, skinColor: event.target.value }))}
                  />
                </div>
                <textarea
                  className="input"
                  placeholder="Cechy szczególne"
                  value={memberForm.traits}
                  onChange={(event) => setMemberForm((prev) => ({ ...prev, traits: event.target.value }))}
                />
                <input type="file" accept="image/*" onChange={handleMemberAvatarChange} />
                <button className="btn" type="submit" disabled={memberSaving}>
                  {memberSaving ? "Zapisywanie..." : "Dodaj członka"}
                </button>
              </form>

              <form onSubmit={handleAddVehicle} className="card grid gap-3 p-4">
                <h2 className="text-lg font-semibold text-white">Dodaj pojazd do organizacji</h2>
                <select
                  className="input"
                  value={vehicleForm.vehicleId}
                  onChange={(event) => setVehicleForm((prev) => ({ ...prev, vehicleId: event.target.value }))}
                  required
                >
                  <option value="">Wybierz pojazd</option>
                  {allVehicles.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.registration || vehicle.id} — {vehicle.brand || "Nieznana marka"}
                    </option>
                  ))}
                </select>
                <textarea
                  className="input"
                  placeholder="Notatka do pojazdu (opcjonalnie)"
                  value={vehicleForm.note}
                  onChange={(event) => setVehicleForm((prev) => ({ ...prev, note: event.target.value }))}
                />
                <button className="btn" type="submit" disabled={vehicleSaving}>
                  {vehicleSaving ? "Zapisywanie..." : "Dodaj pojazd"}
                </button>
              </form>
            </div>
          )}

          <div className="grid gap-3">
            {records.length > 0 ? (
              records.map((record) => renderRecord(record))
            ) : (
              <div className="card p-4 text-sm text-white/80">Brak wpisów.</div>
            )}
          </div>
        </div>
      </>
    </AuthGate>
  );
}
