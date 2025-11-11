import { useRouter } from "next/router";
import Head from "next/head";
import Nav from "@/components/Nav";
import AuthGate from "@/components/AuthGate";
import { useCallback, useEffect, useMemo, useState } from "react";
import { auth, db, storage } from "@/lib/firebase";
import { deriveLoginFromEmail } from "@/lib/login";
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

function buildRecordSummary(recordType: string, data: Record<string, any> = {}) {
  const typeKey = recordType || data.type || "";
  switch (typeKey) {
    case "note": {
      const text = (data.text || "").toString().trim();
      if (!text) return "Notatka";
      return text.length > 120 ? `${text.slice(0, 120)}…` : text;
    }
    case "weapon": {
      const model = data.weaponModel || data.model || "Broń";
      const serial = data.serialNumbers || data.serial || data.serialNumber || "—";
      return `${model}${serial ? ` • Numery: ${serial}` : ""}`.trim();
    }
    case "drug": {
      const type = data.drugType || data.type || "Substancja";
      const qty = data.quantityGrams || data.quantity || data.amount || "—";
      return `${type} • Ilość: ${qty}`;
    }
    case "explosive": {
      const type = data.explosiveType || data.type || "Ładunek";
      const qty = data.quantity || data.amount || "—";
      return `${type} • Ilość: ${qty}`;
    }
    case "member": {
      const name = data.name || "Członek";
      const cid = data.cid || data.memberCid || "—";
      return `${name} (CID ${cid})`;
    }
    case "vehicle": {
      const registration = data.registration || data.vehicleRegistration || data.vehicleId || "—";
      const brand = data.brand || data.vehicleBrand || "";
      const color = data.color || data.vehicleColor || "";
      const owner = data.ownerName || data.vehicleOwnerName || "";
      const suffix = [brand, color, owner].filter(Boolean).join(" • ");
      return suffix ? `${registration} • ${suffix}` : registration;
    }
    case "group-link": {
      const target = data.linkedGroupName || data.memberName || data.dossierTitle || data.dossierId || "powiązanie";
      return `Powiązanie z ${target}`;
    }
    default: {
      const label = data.title || data.name || data.summary || data.recordSummary;
      if (label) return String(label);
      if (data.id) return `Wpis ${data.id}`;
      return "Wpis";
    }
  }
}

type RecordAttachment = {
  url: string;
  name: string;
  contentType?: string;
  path?: string;
};

type GroupInfo = {
  name?: string;
  colorName?: string;
  colorHex?: string;
  organizationType?: string;
  base?: string;
  operations?: string;
};

type DossierInfo = {
  first?: string;
  last?: string;
  cid?: string;
  category?: string;
  group?: GroupInfo | null;
};

type DossierRecord = Record<string, any> & { id: string };

type VehicleOption = {
  id: string;
  registration?: string;
  brand?: string;
  color?: string;
  ownerName?: string;
  ownerCid?: string;
};

type RankOption = {
  value: string;
  label: string;
  color: string;
};

type ActiveFormType = "note" | "weapon" | "drug" | "explosive" | "member" | "vehicle" | null;

const RECORD_LABELS: Record<string, string> = {
  note: "Notatka",
  weapon: "Dowód — Broń",
  drug: "Dowód — Narkotyki",
  explosive: "Dowód — Materiały wybuchowe",
  member: "Członek grupy",
  vehicle: "Pojazd organizacji",
  "group-link": "Powiązanie z organizacją",
};

const RECORD_COLORS: Record<string, string> = {
  note: "#7c3aed",
  weapon: "#ef4444",
  drug: "#10b981",
  explosive: "#f97316",
  member: "#6366f1",
  vehicle: "#0ea5e9",
  "group-link": "#facc15",
};

const CONTROLLED_COLOR = "#fb923c";

const ACTIVE_FORM_TITLES: Record<Exclude<ActiveFormType, null>, string> = {
  note: "Dodaj notatkę",
  weapon: "Dodaj dowód — Broń",
  drug: "Dodaj dowód — Narkotyki",
  explosive: "Dodaj dowód — Materiały wybuchowe",
  member: "Dodaj członka grupy",
  vehicle: "Dodaj pojazd organizacji",
};

const MEMBER_RANKS: RankOption[] = [
  { value: "rekrut", label: "Rekrut", color: "#fef08a" },
  { value: "członek", label: "Członek", color: "#fde047" },
  { value: "wysoki członek", label: "Wysoki członek", color: "#facc15" },
  { value: "prawa ręka", label: "Prawa ręka", color: "#f97316" },
  { value: "zarząd", label: "Zarząd", color: "#ef4444" },
  { value: "brak informacji", label: "Brak informacji", color: "#94a3b8" },
];

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.replace(/[^0-9a-fA-F]/g, "");
  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16);
    const g = parseInt(normalized[1] + normalized[1], 16);
    const b = parseInt(normalized[2] + normalized[2], 16);
    return { r, g, b };
  }
  if (normalized.length === 6) {
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return { r, g, b };
  }
  return null;
}

function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(124, 58, 237, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function parseNumberValue(value: any): number {
  if (typeof value === "number") return isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const normalized = value.replace(/[^0-9,.-]/g, "").replace(/,(\d{1,2})$/, ".$1");
    const parsed = parseFloat(normalized);
    return isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isImageAttachment(attachment: RecordAttachment): boolean {
  const type = attachment.contentType || "";
  if (type.startsWith("image/")) return true;
  return /(\.png|\.jpe?g|\.gif|\.webp|\.bmp|\.svg)$/i.test(attachment.url || attachment.name || "");
}

function isVideoAttachment(attachment: RecordAttachment): boolean {
  const type = attachment.contentType || "";
  if (type.startsWith("video/")) return true;
  return /(\.mp4|\.webm|\.ogg)$/i.test(attachment.url || attachment.name || "");
}

function AttachmentPreview({
  attachment,
  onOpen,
}: {
  attachment: RecordAttachment;
  onOpen?: () => void;
}) {
  if (isImageAttachment(attachment)) {
    return (
      <div className="rounded-lg overflow-hidden border border-white/10 bg-black/10">
        <img
          src={attachment.url}
          alt={attachment.name || "Załącznik"}
          className="w-full max-h-72 object-cover"
          onClick={onOpen}
        />
      </div>
    );
  }

  if (isVideoAttachment(attachment)) {
    return (
      <div className="rounded-lg overflow-hidden border border-white/10 bg-black/10">
        <video
          controls
          src={attachment.url}
          className="w-full"
          onPlay={onOpen}
        />
      </div>
    );
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 text-sm underline text-blue-200"
      onClick={onOpen}
    >
      📎 {attachment.name || "Pobierz załącznik"}
    </a>
  );
}

export default function DossierPage() {
  const router = useRouter();
  const { id } = router.query as { id: string };
  const { role } = useProfile();

  const [title, setTitle] = useState<string>("");
  const [info, setInfo] = useState<DossierInfo>({});
  const [records, setRecords] = useState<DossierRecord[]>([]);
  const [personVehicles, setPersonVehicles] = useState<any[]>([]);
  const [allDossiers, setAllDossiers] = useState<any[]>([]);
  const [vehicleOptions, setVehicleOptions] = useState<VehicleOption[]>([]);
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [activeForm, setActiveForm] = useState<ActiveFormType>(null);
  const [memberSearch, setMemberSearch] = useState("");

  const [noteForm, setNoteForm] = useState({ text: "", files: [] as File[] });
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteFileKey, setNoteFileKey] = useState(0);

  const [weaponForm, setWeaponForm] = useState({
    model: "",
    serialNumbers: "",
    source: "",
    crimeUsage: "brak informacji",
    date: "",
    time: "",
    purchasePrice: "",
    blackMarketValue: "",
    controlledTransaction: false,
    files: [] as File[],
  });
  const [weaponSaving, setWeaponSaving] = useState(false);
  const [weaponFileKey, setWeaponFileKey] = useState(0);

  const [drugForm, setDrugForm] = useState({
    type: "",
    quantity: "",
    quality: "",
    date: "",
    time: "",
    location: "",
    source: "",
    purchasePrice: "",
    blackMarketValue: "",
    note: "",
    controlledTransaction: false,
    files: [] as File[],
  });
  const [drugSaving, setDrugSaving] = useState(false);
  const [drugFileKey, setDrugFileKey] = useState(0);

  const [explosiveForm, setExplosiveForm] = useState({
    type: "",
    quantity: "",
    date: "",
    time: "",
    location: "",
    source: "",
    purchasePrice: "",
    blackMarketValue: "",
    note: "",
    controlledTransaction: false,
    files: [] as File[],
  });
  const [explosiveSaving, setExplosiveSaving] = useState(false);
  const [explosiveFileKey, setExplosiveFileKey] = useState(0);

  const [memberForm, setMemberForm] = useState({
    dossierId: "",
    name: "",
    cid: "",
    rank: "brak informacji",
    skinColor: "",
    traits: "",
    profileImage: null as File | null,
  });
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberImageKey, setMemberImageKey] = useState(0);

  const [vehicleForm, setVehicleForm] = useState({ vehicleId: "" });
  const [vehicleSaving, setVehicleSaving] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { confirm, prompt, alert } = useDialog();
  const { logActivity, session } = useSessionActivity();
  const closeActiveForm = useCallback(() => setActiveForm(null), []);
  const openForm = useCallback((form: Exclude<ActiveFormType, null>) => setActiveForm(form), []);

  const canEditRecord = useCallback(
    (r: DossierRecord) => {
      const me = auth.currentUser?.uid;
      return role === "director" || role === "chief" || (!!me && r.authorUid === me);
    },
    [role]
  );

  const isCriminalGroup = info.category === "criminal-group";
  const canDeleteDossier = role === "director" && !isCriminalGroup;
  const groupColorHex = info.group?.colorHex || "#7c3aed";
  const groupDisplayName = useMemo(
    () => info.group?.name || title || "Grupa przestępcza",
    [info.group, title]
  );

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const refDoc = doc(db, "dossiers", id);
        const snap = await getDoc(refDoc);
        const data = (snap.data() || {}) as any;
        setTitle((data.title || "") as string);
        setInfo({
          first: data.first,
          last: data.last,
          cid: data.cid,
          category: data.category,
          group: data.group || null,
        });
      } catch (e: any) {
        setErr(e.message || "Błąd teczki");
      }
    })();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const q = query(collection(db, "dossiers", id, "records"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setRecords(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const q = query(collection(db, "vehicleFolders"), where("ownerCidNormalized", "==", id));
    return onSnapshot(q, (snap) => {
      setPersonVehicles(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    });
  }, [id]);

  useEffect(() => {
    if (!isCriminalGroup) return;
    (async () => {
      const dossierSnap = await getDocs(query(collection(db, "dossiers"), orderBy("createdAt", "desc")));
      setAllDossiers(dossierSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));

      const vehicleSnap = await getDocs(query(collection(db, "vehicleFolders"), orderBy("createdAt", "desc")));
      setVehicleOptions(vehicleSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as VehicleOption)));
    })();
  }, [isCriminalGroup]);

  useEffect(() => {
    if (!id || !session) return;
    void logActivity({ type: "dossier_view", dossierId: id });
  }, [id, logActivity, session]);

  const uploadAttachments = useCallback(
    async (files: File[], folder: string): Promise<RecordAttachment[]> => {
      if (!id || !files || !files.length) return [];
      const uploads: RecordAttachment[] = [];
      for (const file of files) {
        const cleanName = file.name.replace(/[^a-z0-9._-]+/gi, "_");
        const storagePath = `dossiers/${id}/${folder}/${Date.now()}_${Math.random()
          .toString(36)
          .slice(2)}_${cleanName}`;
        const fileRef = ref(storage, storagePath);
        await uploadBytes(fileRef, file);
        const url = await getDownloadURL(fileRef);
        uploads.push({
          url,
          name: file.name,
          contentType: file.type,
          path: storagePath,
        });
      }
      return uploads;
    },
    [id]
  );

  const addRecordWithLog = useCallback(
    async (payload: Record<string, any>, recordType: string) => {
      if (!id) return null;
      const recordRef = await addDoc(collection(db, "dossiers", id, "records"), payload);
      const loginValue = deriveLoginFromEmail(auth.currentUser?.email || "");
      const recordSummary = buildRecordSummary(recordType, payload);
      await addDoc(collection(db, "logs"), {
        type: "dossier_record_add",
        recordType,
        dossierId: id,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        login: loginValue,
        recordSummary,
        ts: serverTimestamp(),
      });
      return recordRef;
    },
    [id]
  );

  const addNote = useCallback(async (): Promise<boolean> => {
    if (!id || noteSaving) return false;
    try {
      setErr(null);
      setNoteSaving(true);
      const attachments = await uploadAttachments(noteForm.files, "notes");
      await addRecordWithLog(
        {
          type: "note",
          text: noteForm.text || "",
          attachments,
          createdAt: serverTimestamp(),
          author: auth.currentUser?.email || "",
          authorUid: auth.currentUser?.uid || "",
        },
        "note"
      );
      setNoteForm({ text: "", files: [] });
      setNoteFileKey((k) => k + 1);
      return true;
    } catch (e: any) {
      setErr(e.message || "Nie udało się dodać notatki");
      return false;
    } finally {
      setNoteSaving(false);
    }
  }, [addRecordWithLog, id, noteForm.files, noteForm.text, noteSaving, uploadAttachments]);

  const addWeapon = useCallback(async (): Promise<boolean> => {
    if (!id || weaponSaving) return false;
    const required = [weaponForm.model, weaponForm.serialNumbers, weaponForm.date, weaponForm.time];
    if (required.some((f) => !f.trim())) {
      setErr("Uzupełnij wszystkie wymagane pola dotyczące broni.");
      return false;
    }
    try {
      setErr(null);
      setWeaponSaving(true);
      const attachments = await uploadAttachments(weaponForm.files, "weapons");
      await addRecordWithLog(
        {
          type: "weapon",
          weaponModel: weaponForm.model,
          serialNumbers: weaponForm.serialNumbers,
          source: weaponForm.source,
          crimeUsage: weaponForm.crimeUsage,
          controlledTransaction: weaponForm.controlledTransaction,
          date: weaponForm.date,
          time: weaponForm.time,
          purchasePrice: weaponForm.purchasePrice,
          blackMarketValue: weaponForm.blackMarketValue,
          attachments,
          createdAt: serverTimestamp(),
          author: auth.currentUser?.email || "",
          authorUid: auth.currentUser?.uid || "",
        },
        "weapon"
      );
      setWeaponForm({
        model: "",
        serialNumbers: "",
        source: "",
        crimeUsage: "brak informacji",
        date: "",
        time: "",
        purchasePrice: "",
        blackMarketValue: "",
        controlledTransaction: false,
        files: [],
      });
      setWeaponFileKey((k) => k + 1);
      return true;
    } catch (e: any) {
      setErr(e.message || "Nie udało się dodać dowodu broni");
      return false;
    } finally {
      setWeaponSaving(false);
    }
  }, [addRecordWithLog, id, uploadAttachments, weaponForm, weaponSaving]);

  const addDrug = useCallback(async (): Promise<boolean> => {
    if (!id || drugSaving) return false;
    const required = [drugForm.type, drugForm.quantity, drugForm.date, drugForm.time, drugForm.location];
    if (required.some((f) => !f.trim())) {
      setErr("Uzupełnij wymagane pola dotyczące narkotyków.");
      return false;
    }
    try {
      setErr(null);
      setDrugSaving(true);
      const attachments = await uploadAttachments(drugForm.files, "drugs");
      await addRecordWithLog(
        {
          type: "drug",
          drugType: drugForm.type,
          quantityGrams: drugForm.quantity,
          quality: drugForm.quality,
          date: drugForm.date,
          time: drugForm.time,
          location: drugForm.location,
          source: drugForm.source,
          purchasePrice: drugForm.purchasePrice,
          blackMarketValue: drugForm.blackMarketValue,
          note: drugForm.note,
          controlledTransaction: drugForm.controlledTransaction,
          attachments,
          createdAt: serverTimestamp(),
          author: auth.currentUser?.email || "",
          authorUid: auth.currentUser?.uid || "",
        },
        "drug"
      );
      setDrugForm({
        type: "",
        quantity: "",
        quality: "",
        date: "",
        time: "",
        location: "",
        source: "",
        purchasePrice: "",
        blackMarketValue: "",
        note: "",
        controlledTransaction: false,
        files: [],
      });
      setDrugFileKey((k) => k + 1);
      return true;
    } catch (e: any) {
      setErr(e.message || "Nie udało się dodać dowodu narkotyków");
      return false;
    } finally {
      setDrugSaving(false);
    }
  }, [addRecordWithLog, drugForm, drugSaving, id, uploadAttachments]);

  const addExplosive = useCallback(async (): Promise<boolean> => {
    if (!id || explosiveSaving) return false;
    const required = [explosiveForm.type, explosiveForm.quantity, explosiveForm.date, explosiveForm.time, explosiveForm.location];
    if (required.some((f) => !f.trim())) {
      setErr("Uzupełnij wymagane pola dotyczące materiałów wybuchowych.");
      return false;
    }
    try {
      setErr(null);
      setExplosiveSaving(true);
      const attachments = await uploadAttachments(explosiveForm.files, "explosives");
      await addRecordWithLog(
        {
          type: "explosive",
          explosiveType: explosiveForm.type,
          quantity: explosiveForm.quantity,
          date: explosiveForm.date,
          time: explosiveForm.time,
          location: explosiveForm.location,
          source: explosiveForm.source,
          purchasePrice: explosiveForm.purchasePrice,
          blackMarketValue: explosiveForm.blackMarketValue,
          note: explosiveForm.note,
          controlledTransaction: explosiveForm.controlledTransaction,
          attachments,
          createdAt: serverTimestamp(),
          author: auth.currentUser?.email || "",
          authorUid: auth.currentUser?.uid || "",
        },
        "explosive"
      );
      setExplosiveForm({
        type: "",
        quantity: "",
        date: "",
        time: "",
        location: "",
        source: "",
        purchasePrice: "",
        blackMarketValue: "",
        note: "",
        controlledTransaction: false,
        files: [],
      });
      setExplosiveFileKey((k) => k + 1);
      return true;
    } catch (e: any) {
      setErr(e.message || "Nie udało się dodać dowodu materiału wybuchowego");
      return false;
    } finally {
      setExplosiveSaving(false);
    }
  }, [addRecordWithLog, explosiveForm, explosiveSaving, id, uploadAttachments]);

  const addMember = useCallback(async (): Promise<boolean> => {
    if (!id || memberSaving) return false;
    if (!memberForm.dossierId) {
      setErr("Wybierz teczkę członka organizacji.");
      return false;
    }
    const rank = MEMBER_RANKS.find((r) => r.value === memberForm.rank) ?? MEMBER_RANKS[MEMBER_RANKS.length - 1];
    try {
      setErr(null);
      setMemberSaving(true);
      const attachments = memberForm.profileImage ? await uploadAttachments([memberForm.profileImage], "members") : [];
      const memberRecordRef = await addRecordWithLog(
        {
          type: "member",
          dossierId: memberForm.dossierId,
          name: memberForm.name,
          cid: memberForm.cid,
          rank: memberForm.rank,
          rankColor: rank.color,
          skinColor: memberForm.skinColor,
          traits: memberForm.traits,
          profileImageUrl: attachments[0]?.url || "",
          profileImagePath: attachments[0]?.path || "",
          createdAt: serverTimestamp(),
          author: auth.currentUser?.email || "",
          authorUid: auth.currentUser?.uid || "",
        },
        "member"
      );
      if (!memberRecordRef) {
        throw new Error("Nie udało się utworzyć wpisu członka.");
      }
      const memberLinkRef = await addDoc(collection(db, "dossiers", memberForm.dossierId, "records"), {
        type: "group-link",
        linkedGroupId: id,
        linkedGroupRecordId: memberRecordRef.id,
        linkedGroupName: groupDisplayName,
        linkedGroupColor: groupColorHex,
        memberRank: memberForm.rank,
        memberRankColor: rank.color,
        memberName: memberForm.name,
        createdAt: serverTimestamp(),
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
      });
      await updateDoc(memberRecordRef, {
        linkedDossierRecordId: memberLinkRef.id,
      });
      await addDoc(collection(db, "logs"), {
        type: "dossier_group_link_add",
        dossierId: memberForm.dossierId,
        groupId: id,
        groupName: groupDisplayName,
        memberName: memberForm.name,
        memberCid: memberForm.cid,
        memberRank: memberForm.rank,
        memberRankLabel: rank.label,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        login: deriveLoginFromEmail(auth.currentUser?.email || ""),
        ts: serverTimestamp(),
      });
      setMemberForm({
        dossierId: "",
        name: "",
        cid: "",
        rank: "brak informacji",
        skinColor: "",
        traits: "",
        profileImage: null,
      });
      setMemberImageKey((k) => k + 1);
      return true;
    } catch (e: any) {
      setErr(e.message || "Nie udało się dodać członka organizacji");
      return false;
    } finally {
      setMemberSaving(false);
    }
  }, [
    addRecordWithLog,
    groupColorHex,
    groupDisplayName,
    id,
    memberForm,
    memberSaving,
    uploadAttachments,
  ]);

  const addVehicle = useCallback(async (): Promise<boolean> => {
    if (!id || vehicleSaving) return false;
    if (!vehicleForm.vehicleId) {
      setErr("Wybierz pojazd do dodania.");
      return false;
    }
    const vehicle = vehicleOptions.find((v) => v.id === vehicleForm.vehicleId);
    if (!vehicle) {
      setErr("Nie udało się odczytać danych pojazdu.");
      return false;
    }
    try {
      setErr(null);
      setVehicleSaving(true);
      const vehicleRecordRef = await addRecordWithLog(
        {
          type: "vehicle",
          vehicleId: vehicle.id,
          registration: vehicle.registration || "",
          brand: vehicle.brand || "",
          color: vehicle.color || "",
          ownerName: vehicle.ownerName || "",
          ownerCid: vehicle.ownerCid || "",
          createdAt: serverTimestamp(),
          author: auth.currentUser?.email || "",
          authorUid: auth.currentUser?.uid || "",
        },
        "vehicle"
      );
      if (!vehicleRecordRef) {
        throw new Error("Nie udało się utworzyć wpisu pojazdu.");
      }
      const vehicleNoteRef = await addDoc(collection(db, "vehicleFolders", vehicle.id, "notes"), {
        text: `Powiązanie z organizacją ${groupDisplayName}.`,
        linkedGroupId: id,
        linkedGroupRecordId: vehicleRecordRef.id,
        linkedGroupName: groupDisplayName,
        noteType: "criminal-group-link",
        createdAt: serverTimestamp(),
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
      });
      await updateDoc(vehicleRecordRef, {
        linkedVehicleNoteId: vehicleNoteRef.id,
      });
      await addDoc(collection(db, "logs"), {
        type: "vehicle_group_link_add",
        vehicleId: vehicle.id,
        groupId: id,
        vehicleRegistration: vehicle.registration || "",
        vehicleBrand: vehicle.brand || "",
        vehicleColor: vehicle.color || "",
        vehicleOwnerName: vehicle.ownerName || "",
        vehicleOwnerCid: vehicle.ownerCid || "",
        groupName: groupDisplayName,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        login: deriveLoginFromEmail(auth.currentUser?.email || ""),
        ts: serverTimestamp(),
      });
      setVehicleForm({ vehicleId: "" });
      return true;
    } catch (e: any) {
      setErr(e.message || "Nie udało się dodać pojazdu");
      return false;
    } finally {
      setVehicleSaving(false);
    }
  }, [addRecordWithLog, groupDisplayName, id, vehicleForm.vehicleId, vehicleOptions, vehicleSaving]);

  const handleNoteModalSubmit = useCallback(async () => {
    const ok = await addNote();
    if (ok) closeActiveForm();
  }, [addNote, closeActiveForm]);

  const handleWeaponModalSubmit = useCallback(async () => {
    const ok = await addWeapon();
    if (ok) closeActiveForm();
  }, [addWeapon, closeActiveForm]);

  const handleDrugModalSubmit = useCallback(async () => {
    const ok = await addDrug();
    if (ok) closeActiveForm();
  }, [addDrug, closeActiveForm]);

  const handleExplosiveModalSubmit = useCallback(async () => {
    const ok = await addExplosive();
    if (ok) closeActiveForm();
  }, [addExplosive, closeActiveForm]);

  const handleMemberModalSubmit = useCallback(async () => {
    const ok = await addMember();
    if (ok) closeActiveForm();
  }, [addMember, closeActiveForm]);

  const handleVehicleModalSubmit = useCallback(async () => {
    const ok = await addVehicle();
    if (ok) closeActiveForm();
  }, [addVehicle, closeActiveForm]);

  const renderActiveForm = () => {
    switch (activeForm) {
      case "note":
        return (
          <div className="grid gap-3">
            <label className="text-sm font-semibold" htmlFor="note-text">
              Treść notatki
            </label>
            <textarea
              id="note-text"
              className="input h-32"
              placeholder="Opis sytuacji, ustalenia, dalsze kroki..."
              value={noteForm.text}
              onChange={(e) => setNoteForm((prev) => ({ ...prev, text: e.target.value }))}
            />
            <input
              key={noteFileKey}
              type="file"
              multiple
              onChange={(e) =>
                setNoteForm((prev) => ({ ...prev, files: Array.from(e.target.files || []) }))
              }
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn--note" onClick={handleNoteModalSubmit} disabled={noteSaving}>
                {noteSaving ? "Dodawanie..." : "Zapisz notatkę"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setNoteForm({ text: "", files: [] });
                  setNoteFileKey((k) => k + 1);
                }}
              >
                Wyczyść
              </button>
            </div>
          </div>
        );
      case "weapon":
        return (
          <div className="grid gap-3">
            <div className="grid md:grid-cols-2 gap-3">
              <input
                className="input"
                placeholder="Model broni"
                value={weaponForm.model}
                onChange={(e) => setWeaponForm((prev) => ({ ...prev, model: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Numery seryjne"
                value={weaponForm.serialNumbers}
                onChange={(e) => setWeaponForm((prev) => ({ ...prev, serialNumbers: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Od kogo pozyskano"
                value={weaponForm.source}
                onChange={(e) => setWeaponForm((prev) => ({ ...prev, source: e.target.value }))}
              />
              <div className="flex flex-col gap-2 md:col-span-2 lg:col-span-1">
                <label
                  className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70"
                  htmlFor="weapon-crime-usage"
                >
                  Wykorzystanie w przestępstwie
                </label>
                <select
                  id="weapon-crime-usage"
                  className="input"
                  value={weaponForm.crimeUsage}
                  onChange={(e) => setWeaponForm((prev) => ({ ...prev, crimeUsage: e.target.value }))}
                >
                  <option value="tak">Tak</option>
                  <option value="nie">Nie</option>
                  <option value="brak informacji">Brak informacji</option>
                </select>
                <span className="text-xs text-white/60 leading-relaxed">
                  Określ, czy zabezpieczona broń była używana podczas czynu zabronionego (np. strzelaniny, napadu,
                  wymuszenia).
                </span>
              </div>
              <input
                type="date"
                className="input"
                value={weaponForm.date}
                onChange={(e) => setWeaponForm((prev) => ({ ...prev, date: e.target.value }))}
              />
              <input
                type="time"
                className="input"
                value={weaponForm.time}
                onChange={(e) => setWeaponForm((prev) => ({ ...prev, time: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Cena kupna"
                value={weaponForm.purchasePrice}
                onChange={(e) => setWeaponForm((prev) => ({ ...prev, purchasePrice: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Wartość czarnorynkowa"
                value={weaponForm.blackMarketValue}
                onChange={(e) => setWeaponForm((prev) => ({ ...prev, blackMarketValue: e.target.value }))}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={`btn btn--control${weaponForm.controlledTransaction ? " btn--control-active" : ""}`}
                onClick={() =>
                  setWeaponForm((prev) => ({ ...prev, controlledTransaction: !prev.controlledTransaction }))
                }
              >
                {weaponForm.controlledTransaction ? "Transakcja kontrolowana ✓" : "Transakcja kontrolowana"}
              </button>
            </div>
            <input
              key={weaponFileKey}
              type="file"
              multiple
              onChange={(e) => setWeaponForm((prev) => ({ ...prev, files: Array.from(e.target.files || []) }))}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn--weapon" onClick={handleWeaponModalSubmit} disabled={weaponSaving}>
                {weaponSaving ? "Dodawanie..." : "Dodaj dowód"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setWeaponForm({
                    model: "",
                    serialNumbers: "",
                    source: "",
                    crimeUsage: "brak informacji",
                    date: "",
                    time: "",
                    purchasePrice: "",
                    blackMarketValue: "",
                    controlledTransaction: false,
                    files: [],
                  });
                  setWeaponFileKey((k) => k + 1);
                }}
              >
                Wyczyść
              </button>
            </div>
          </div>
        );
      case "drug":
        return (
          <div className="grid gap-3">
            <div className="grid md:grid-cols-2 gap-3">
              <input
                className="input"
                placeholder="Rodzaj narkotyku"
                value={drugForm.type}
                onChange={(e) => setDrugForm((prev) => ({ ...prev, type: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Ilość w gramach"
                value={drugForm.quantity}
                onChange={(e) => setDrugForm((prev) => ({ ...prev, quantity: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Jakość"
                value={drugForm.quality}
                onChange={(e) => setDrugForm((prev) => ({ ...prev, quality: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Miejsce"
                value={drugForm.location}
                onChange={(e) => setDrugForm((prev) => ({ ...prev, location: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Od kogo"
                value={drugForm.source}
                onChange={(e) => setDrugForm((prev) => ({ ...prev, source: e.target.value }))}
              />
              <input
                type="date"
                className="input"
                value={drugForm.date}
                onChange={(e) => setDrugForm((prev) => ({ ...prev, date: e.target.value }))}
              />
              <input
                type="time"
                className="input"
                value={drugForm.time}
                onChange={(e) => setDrugForm((prev) => ({ ...prev, time: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Cena kupna"
                value={drugForm.purchasePrice}
                onChange={(e) => setDrugForm((prev) => ({ ...prev, purchasePrice: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Wartość czarnorynkowa"
                value={drugForm.blackMarketValue}
                onChange={(e) => setDrugForm((prev) => ({ ...prev, blackMarketValue: e.target.value }))}
              />
            </div>
            <textarea
              className="input"
              placeholder="Dodatkowa notatka"
              value={drugForm.note}
              onChange={(e) => setDrugForm((prev) => ({ ...prev, note: e.target.value }))}
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                className={`btn btn--control${drugForm.controlledTransaction ? " btn--control-active" : ""}`}
                onClick={() => setDrugForm((prev) => ({ ...prev, controlledTransaction: !prev.controlledTransaction }))}
              >
                {drugForm.controlledTransaction ? "Transakcja kontrolowana ✓" : "Transakcja kontrolowana"}
              </button>
            </div>
            <input
              key={drugFileKey}
              type="file"
              multiple
              onChange={(e) => setDrugForm((prev) => ({ ...prev, files: Array.from(e.target.files || []) }))}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn--drug" onClick={handleDrugModalSubmit} disabled={drugSaving}>
                {drugSaving ? "Dodawanie..." : "Dodaj dowód"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDrugForm({
                    type: "",
                    quantity: "",
                    quality: "",
                    date: "",
                    time: "",
                    location: "",
                    source: "",
                    purchasePrice: "",
                    blackMarketValue: "",
                    note: "",
                    controlledTransaction: false,
                    files: [],
                  });
                  setDrugFileKey((k) => k + 1);
                }}
              >
                Wyczyść
              </button>
            </div>
          </div>
        );
      case "explosive":
        return (
          <div className="grid gap-3">
            <div className="grid md:grid-cols-2 gap-3">
              <input
                className="input"
                placeholder="Rodzaj materiału"
                value={explosiveForm.type}
                onChange={(e) => setExplosiveForm((prev) => ({ ...prev, type: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Ilość"
                value={explosiveForm.quantity}
                onChange={(e) => setExplosiveForm((prev) => ({ ...prev, quantity: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Miejsce"
                value={explosiveForm.location}
                onChange={(e) => setExplosiveForm((prev) => ({ ...prev, location: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Od kogo"
                value={explosiveForm.source}
                onChange={(e) => setExplosiveForm((prev) => ({ ...prev, source: e.target.value }))}
              />
              <input
                type="date"
                className="input"
                value={explosiveForm.date}
                onChange={(e) => setExplosiveForm((prev) => ({ ...prev, date: e.target.value }))}
              />
              <input
                type="time"
                className="input"
                value={explosiveForm.time}
                onChange={(e) => setExplosiveForm((prev) => ({ ...prev, time: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Cena kupna"
                value={explosiveForm.purchasePrice}
                onChange={(e) => setExplosiveForm((prev) => ({ ...prev, purchasePrice: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Wartość czarnorynkowa"
                value={explosiveForm.blackMarketValue}
                onChange={(e) => setExplosiveForm((prev) => ({ ...prev, blackMarketValue: e.target.value }))}
              />
            </div>
            <textarea
              className="input"
              placeholder="Dodatkowa notatka"
              value={explosiveForm.note}
              onChange={(e) => setExplosiveForm((prev) => ({ ...prev, note: e.target.value }))}
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                className={`btn btn--control${explosiveForm.controlledTransaction ? " btn--control-active" : ""}`}
                onClick={() =>
                  setExplosiveForm((prev) => ({ ...prev, controlledTransaction: !prev.controlledTransaction }))
                }
              >
                {explosiveForm.controlledTransaction ? "Transakcja kontrolowana ✓" : "Transakcja kontrolowana"}
              </button>
            </div>
            <input
              key={explosiveFileKey}
              type="file"
              multiple
              onChange={(e) => setExplosiveForm((prev) => ({ ...prev, files: Array.from(e.target.files || []) }))}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn--explosive"
                onClick={handleExplosiveModalSubmit}
                disabled={explosiveSaving}
              >
                {explosiveSaving ? "Dodawanie..." : "Dodaj dowód"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setExplosiveForm({
                    type: "",
                    quantity: "",
                    date: "",
                    time: "",
                    location: "",
                    source: "",
                    purchasePrice: "",
                    blackMarketValue: "",
                    note: "",
                    controlledTransaction: false,
                    files: [],
                  });
                  setExplosiveFileKey((k) => k + 1);
                }}
              >
                Wyczyść
              </button>
            </div>
          </div>
        );
      case "member":
        return (
          <div className="grid gap-3">
            <input
              className="input"
              placeholder="Szukaj teczki (imię, nazwisko, CID)"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
            />
            <select
              className="input"
              value={memberForm.dossierId}
              onChange={(e) => {
                const dossierId = e.target.value;
                const dossier = allDossiers.find((d) => d.id === dossierId);
                setMemberForm((prev) => ({
                  ...prev,
                  dossierId,
                  name: dossier ? [dossier.first, dossier.last].filter(Boolean).join(" ") || dossier.title || "" : prev.name,
                  cid: dossier?.cid || prev.cid,
                }));
              }}
            >
              <option value="">Wybierz teczkę</option>
              {filteredDossierOptions.map((dossier) => (
                <option key={dossier.id} value={dossier.id}>
                  {dossier.title || `${dossier.first || ""} ${dossier.last || ""}`.trim() || dossier.id}
                </option>
              ))}
            </select>
            <div className="grid md:grid-cols-2 gap-3">
              <input
                className="input"
                placeholder="Imię i nazwisko"
                value={memberForm.name}
                onChange={(e) => setMemberForm((prev) => ({ ...prev, name: e.target.value }))}
              />
              <input
                className="input"
                placeholder="CID"
                value={memberForm.cid}
                onChange={(e) => setMemberForm((prev) => ({ ...prev, cid: e.target.value }))}
              />
              <select
                className="input"
                value={memberForm.rank}
                onChange={(e) => setMemberForm((prev) => ({ ...prev, rank: e.target.value }))}
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
                onChange={(e) => setMemberForm((prev) => ({ ...prev, skinColor: e.target.value }))}
              />
            </div>
            <textarea
              className="input"
              placeholder="Cechy szczególne"
              value={memberForm.traits}
              onChange={(e) => setMemberForm((prev) => ({ ...prev, traits: e.target.value }))}
            />
            <input
              key={memberImageKey}
              type="file"
              accept="image/*"
              onChange={(e) => setMemberForm((prev) => ({ ...prev, profileImage: e.target.files?.[0] || null }))}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn--member" onClick={handleMemberModalSubmit} disabled={memberSaving}>
                {memberSaving ? "Dodawanie..." : "Dodaj członka"}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setMemberForm({
                    dossierId: "",
                    name: "",
                    cid: "",
                    rank: "brak informacji",
                    skinColor: "",
                    traits: "",
                    profileImage: null,
                  });
                  setMemberImageKey((k) => k + 1);
                }}
              >
                Wyczyść
              </button>
            </div>
          </div>
        );
      case "vehicle":
        return (
          <div className="grid gap-3">
            <input
              className="input"
              placeholder="Szukaj pojazdu (rejestracja, właściciel, marka)"
              value={vehicleSearch}
              onChange={(e) => setVehicleSearch(e.target.value)}
            />
            <select
              className="input"
              value={vehicleForm.vehicleId}
              onChange={(e) => setVehicleForm({ vehicleId: e.target.value })}
            >
              <option value="">Wybierz pojazd</option>
              {filteredVehicleOptions.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.registration || "?"} — {vehicle.brand || "?"} • {vehicle.ownerName || "Brak właściciela"}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn--vehicle" onClick={handleVehicleModalSubmit} disabled={vehicleSaving}>
                {vehicleSaving ? "Dodawanie..." : "Dodaj pojazd"}
              </button>
              <button type="button" className="btn" onClick={() => setVehicleForm({ vehicleId: "" })}>
                Wyczyść
              </button>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const editRecord = useCallback(
    async (rid: string, currentText: string, type: string) => {
      if (type !== "note") {
        await alert({
          title: "Edycja niedostępna",
          message: "Edycja jest dostępna tylko dla notatek tekstowych.",
          tone: "info",
        });
        return;
      }
      const t = await prompt({
        title: "Edycja wpisu",
        message: "Zaktualizuj treść notatki. Możesz wprowadzić wielolinijkowy opis.",
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
      const trimmed = t.trim();
      await updateDoc(doc(db, "dossiers", id, "records", rid), { text: trimmed });
      await addDoc(collection(db, "logs"), {
        type: "dossier_record_edit",
        dossierId: id,
        recordId: rid,
        previousPreview:
          currentText.trim().length > 120 ? `${currentText.trim().slice(0, 120)}…` : currentText.trim(),
        notePreview: trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed,
        recordType: type,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        login: deriveLoginFromEmail(auth.currentUser?.email || ""),
        ts: serverTimestamp(),
      });
    },
    [alert, id, prompt]
  );

  const deleteRecord = useCallback(
    async (rid: string) => {
      const record = records.find((r) => r.id === rid);
      const ok = await confirm({
        title: "Usuń wpis",
        message: "Czy na pewno chcesz usunąć ten wpis z teczki?",
        confirmLabel: "Usuń",
        tone: "danger",
      });
      if (!ok) return;
      const authorEmail = auth.currentUser?.email || "";
      const authorUid = auth.currentUser?.uid || "";
      const loginValue = deriveLoginFromEmail(authorEmail);
      const recordType = (record?.type as string) || record?.recordType || "note";
      const recordSummary = record ? buildRecordSummary(recordType, record) : "";
      try {
        setErr(null);
        await deleteDoc(doc(db, "dossiers", id, "records", rid));

        if (record?.type === "member" && record?.dossierId) {
          const memberRankLabel =
            (record.rank && MEMBER_RANKS.find((r) => r.value === record.rank)?.label) ||
            record.memberRankLabel ||
            "";
          if (record.linkedDossierRecordId) {
            await deleteDoc(doc(db, "dossiers", record.dossierId, "records", record.linkedDossierRecordId));
          } else {
            const q = query(
              collection(db, "dossiers", record.dossierId, "records"),
              where("linkedGroupRecordId", "==", rid)
            );
            const snap = await getDocs(q);
            await Promise.all(snap.docs.map((docSnap) => deleteDoc(docSnap.ref)));
          }
          await addDoc(collection(db, "logs"), {
            type: "dossier_group_link_remove",
            dossierId: record.dossierId,
            groupId: id,
            groupName: groupDisplayName,
            memberName: record.name || record.memberName || "",
            memberCid: record.cid || record.memberCid || "",
            memberRank: record.rank || record.memberRank || "",
            memberRankLabel,
            author: authorEmail,
            authorUid,
            login: loginValue,
            ts: serverTimestamp(),
          });
        }

        if (record?.type === "vehicle" && record?.vehicleId) {
          if (record.linkedVehicleNoteId) {
            await deleteDoc(doc(db, "vehicleFolders", record.vehicleId, "notes", record.linkedVehicleNoteId));
          } else {
            const q = query(
              collection(db, "vehicleFolders", record.vehicleId, "notes"),
              where("linkedGroupRecordId", "==", rid)
            );
            const snap = await getDocs(q);
            await Promise.all(snap.docs.map((docSnap) => deleteDoc(docSnap.ref)));
          }
          await addDoc(collection(db, "logs"), {
            type: "vehicle_group_link_remove",
            vehicleId: record.vehicleId,
            vehicleRegistration: record.registration || record.vehicleRegistration || record.vehicleId,
            vehicleBrand: record.brand || record.vehicleBrand || "",
            vehicleColor: record.color || record.vehicleColor || "",
            vehicleOwnerName: record.ownerName || record.vehicleOwnerName || "",
            vehicleOwnerCid: record.ownerCid || record.vehicleOwnerCid || "",
            groupId: id,
            groupName: groupDisplayName,
            author: authorEmail,
            authorUid,
            login: loginValue,
            ts: serverTimestamp(),
          });
        }

        await addDoc(collection(db, "logs"), {
          type: "dossier_record_delete",
          dossierId: id,
          recordId: rid,
          recordType,
          recordSummary,
          author: authorEmail,
          authorUid,
          login: loginValue,
          ts: serverTimestamp(),
        });
      } catch (e: any) {
        setErr(e?.message || "Nie udało się usunąć wpisu.");
      }
    },
    [confirm, groupDisplayName, id, records]
  );

  const deleteDossier = useCallback(async () => {
    if (!id || !canDeleteDossier) return;
    const ok = await confirm({
      title: "Usuń teczkę",
      message: "Na pewno usunąć całą teczkę wraz ze wszystkimi wpisami? Tej operacji nie można cofnąć.",
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
  }, [canDeleteDossier, confirm, id, router]);

  const personTitle = useMemo(() => {
    if (isCriminalGroup && info.group?.name) {
      return info.group.name;
    }
    const n = [info.first, info.last].filter(Boolean).join(" ");
    return n ? `${title} • ${n} (CID: ${info.cid || "?"})` : title || "Teczka";
  }, [info, isCriminalGroup, title]);

  const groupSummaryGradient = useMemo(
    () => `linear-gradient(135deg, ${withAlpha(groupColorHex, 0.42)}, rgba(6, 10, 22, 0.94))`,
    [groupColorHex]
  );
  const groupSummaryBorder = useMemo(() => withAlpha(groupColorHex, 0.48), [groupColorHex]);
  const groupSummaryShadow = useMemo(
    () => `0 30px 78px -28px ${withAlpha(groupColorHex, 0.62)}`,
    [groupColorHex]
  );
  const groupSummaryGlow = useMemo(
    () => `radial-gradient(circle at 18% 20%, ${withAlpha(groupColorHex, 0.32)}, transparent 62%)`,
    [groupColorHex]
  );

  const organizationMembers = useMemo(() => {
    const unique = new Map<string, DossierRecord>();
    records
      .filter((r) => (r.type || "note") === "member")
      .forEach((r) => {
        const key = r.dossierId || r.name || r.id;
        if (!unique.has(key)) unique.set(key, r);
      });
    return Array.from(unique.values());
  }, [records]);

  const organizationVehicles = useMemo(() => {
    const unique = new Map<string, DossierRecord>();
    records
      .filter((r) => (r.type || "note") === "vehicle")
      .forEach((r) => {
        const key = r.vehicleId || r.registration || r.id;
        if (!unique.has(key)) unique.set(key, r);
      });
    return Array.from(unique.values());
  }, [records]);

  const timelineRecords = useMemo(
    () =>
      records.filter((record) => {
        const type = record.type || "note";
        return type !== "member" && type !== "vehicle";
      }),
    [records]
  );

  const numberFormatter = useMemo(() => new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }), []);

  const summaryStats = useMemo(() => {
    return records.reduce(
      (acc, record) => {
        if (record.type === "weapon") {
          acc.weapons += 1;
          acc.blackMarket += parseNumberValue(record.blackMarketValue);
        } else if (record.type === "drug") {
          acc.drugs += parseNumberValue(record.quantityGrams);
          acc.blackMarket += parseNumberValue(record.blackMarketValue);
        } else if (record.type === "explosive") {
          acc.bombs += parseNumberValue(record.quantity);
          acc.blackMarket += parseNumberValue(record.blackMarketValue);
        }
        return acc;
      },
      { blackMarket: 0, bombs: 0, drugs: 0, weapons: 0 }
    );
  }, [records]);

  const summaryCards = useMemo(
    () => [
      {
        key: "blackMarket",
        label: "Łączna wartość czarnorynkowa",
        value: numberFormatter.format(summaryStats.blackMarket),
        icon: "💰",
        accent: "#facc15",
      },
      {
        key: "bombs",
        label: "Przejęte ładunki wybuchowe",
        value: numberFormatter.format(summaryStats.bombs),
        icon: "💣",
        accent: "#ef4444",
      },
      {
        key: "drugs",
        label: "Przejęte narkotyki (g)",
        value: numberFormatter.format(summaryStats.drugs),
        icon: "🧪",
        accent: "#22d3ee",
      },
      {
        key: "weapons",
        label: "Przejęta broń",
        value: numberFormatter.format(summaryStats.weapons),
        icon: "🔫",
        accent: "#f472b6",
      },
      {
        key: "members",
        label: "Członkowie w kartotece",
        value: numberFormatter.format(organizationMembers.length),
        icon: "🧑‍🤝‍🧑",
        accent: "#34d399",
      },
      {
        key: "vehicles",
        label: "Powiązane pojazdy",
        value: numberFormatter.format(organizationVehicles.length),
        icon: "🚘",
        accent: "#60a5fa",
      },
      {
        key: "records",
        label: "Zarchiwizowane wpisy",
        value: numberFormatter.format(timelineRecords.length),
        icon: "🗂️",
        accent: "#818cf8",
      },
    ],
    [
      numberFormatter,
      organizationMembers.length,
      organizationVehicles.length,
      timelineRecords.length,
      summaryStats.blackMarket,
      summaryStats.bombs,
      summaryStats.drugs,
      summaryStats.weapons,
    ]
  );

  const actionButtons: { type: Exclude<ActiveFormType, null>; label: string; description: string }[] = [
    { type: "note", label: "Notatka", description: "Opis zdarzeń, relacje agentów i ustalenia." },
    { type: "weapon", label: "Dowód — Broń", description: "Egzemplarze broni zabezpieczone w toku działań." },
    { type: "drug", label: "Dowód — Narkotyki", description: "Substancje odurzające wraz z parametrami." },
    { type: "explosive", label: "Dowód — Materiały wybuchowe", description: "Ładunki i komponenty wykorzystywane przez grupę." },
    { type: "member", label: "Członek grupy", description: "Powiąż osobę z kartą Ballas." },
    { type: "vehicle", label: "Pojazd organizacji", description: "Dodaj pojazd znajdujący się w archiwum." },
  ];

  const filteredDossierOptions = useMemo(() => {
    if (!memberSearch.trim()) return allDossiers.filter((d) => d.id !== id);
    const search = memberSearch.toLowerCase();
    return allDossiers.filter((d) => {
      if (d.id === id) return false;
      return (
        (d.title || "").toLowerCase().includes(search) ||
        (d.first || "").toLowerCase().includes(search) ||
        (d.last || "").toLowerCase().includes(search) ||
        (d.cid || "").toLowerCase().includes(search)
      );
    });
  }, [allDossiers, id, memberSearch]);

  const filteredVehicleOptions = useMemo(() => {
    if (!vehicleSearch.trim()) return vehicleOptions;
    const search = vehicleSearch.toLowerCase();
    return vehicleOptions.filter((v) =>
      [v.registration, v.brand, v.color, v.ownerName, v.ownerCid]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search))
    );
  }, [vehicleOptions, vehicleSearch]);

  const resolveRecordStyle = (record: DossierRecord) => {
    const baseColor = RECORD_COLORS[record.type || "note"] || RECORD_COLORS.note;
    const background = record.controlledTransaction
      ? `linear-gradient(135deg, ${withAlpha(CONTROLLED_COLOR, 0.35)}, ${withAlpha(baseColor, 0.25)})`
      : withAlpha(baseColor, 0.15);
    const borderColor = withAlpha(baseColor, 0.4);
    return { background, borderColor };
  };

  const resolveRecordLabel = (record: DossierRecord) => RECORD_LABELS[record.type || "note"] || "Wpis";

  const renderRecordDetails = (record: DossierRecord) => {
    switch (record.type) {
      case "weapon":
        return (
          <div className="grid gap-1 text-sm">
            <div>Model broni: <strong>{record.weaponModel || "—"}</strong></div>
            <div>Numery seryjne: <strong>{record.serialNumbers || "—"}</strong></div>
            <div>Źródło pochodzenia: {record.source || "—"}</div>
            <div>Wykorzystanie w przestępstwie: {record.crimeUsage || "—"}</div>
            <div>Data: {record.date || "—"} • Godzina: {record.time || "—"}</div>
            <div>Cena kupna: {record.purchasePrice || "—"}</div>
            <div>Wartość czarnorynkowa: {record.blackMarketValue || "—"}</div>
            {record.controlledTransaction ? (
              <span className="inline-flex mt-1 px-2 py-1 rounded-full bg-orange-500/30 text-xs font-semibold text-orange-100">
                Transakcja kontrolowana
              </span>
            ) : null}
          </div>
        );
      case "drug":
        return (
          <div className="grid gap-1 text-sm">
            <div>Rodzaj: <strong>{record.drugType || "—"}</strong></div>
            <div>Ilość (g): {record.quantityGrams || "—"}</div>
            <div>Jakość: {record.quality || "—"}</div>
            <div>Miejsce: {record.location || "—"}</div>
            <div>Od kogo: {record.source || "—"}</div>
            <div>Data: {record.date || "—"} • Godzina: {record.time || "—"}</div>
            <div>Cena kupna: {record.purchasePrice || "—"}</div>
            <div>Wartość czarnorynkowa: {record.blackMarketValue || "—"}</div>
            {record.note ? <div className="mt-1 whitespace-pre-wrap text-sm">Notatka: {record.note}</div> : null}
            {record.controlledTransaction ? (
              <span className="inline-flex mt-1 px-2 py-1 rounded-full bg-orange-500/30 text-xs font-semibold text-orange-100">
                Transakcja kontrolowana
              </span>
            ) : null}
          </div>
        );
      case "explosive":
        return (
          <div className="grid gap-1 text-sm">
            <div>Rodzaj: <strong>{record.explosiveType || "—"}</strong></div>
            <div>Ilość: {record.quantity || "—"}</div>
            <div>Miejsce: {record.location || "—"}</div>
            <div>Od kogo: {record.source || "—"}</div>
            <div>Data: {record.date || "—"} • Godzina: {record.time || "—"}</div>
            <div>Cena kupna: {record.purchasePrice || "—"}</div>
            <div>Wartość czarnorynkowa: {record.blackMarketValue || "—"}</div>
            {record.note ? <div className="mt-1 whitespace-pre-wrap text-sm">Notatka: {record.note}</div> : null}
            {record.controlledTransaction ? (
              <span className="inline-flex mt-1 px-2 py-1 rounded-full bg-orange-500/30 text-xs font-semibold text-orange-100">
                Transakcja kontrolowana
              </span>
            ) : null}
          </div>
        );
      case "member":
        return (
          <div className="grid gap-1 text-sm">
            <div className="font-semibold text-base">{record.name || "Nowy członek"}</div>
            <div>CID: {record.cid || "—"}</div>
            <div className="flex items-center gap-2">
              <span
                className="px-2 py-0.5 text-xs font-semibold rounded-full"
                style={{ background: withAlpha(record.rankColor || "#64748b", 0.25), color: record.rankColor || "#e2e8f0" }}
              >
                {record.rank || "Brak informacji"}
              </span>
              {record.skinColor ? <span>Kolor skóry: {record.skinColor}</span> : null}
            </div>
            {record.traits ? <div>Cechy szczególne: {record.traits}</div> : null}
            {record.dossierId ? (
              <a
                href={`/dossiers/${record.dossierId}`}
                className="underline text-blue-200"
              >
                Przejdź do teczki
              </a>
            ) : null}
            {record.profileImageUrl ? (
              <div className="mt-2 max-w-[200px]">
                <img src={record.profileImageUrl} alt={record.name || "Profil"} className="rounded-lg object-cover" />
              </div>
            ) : null}
          </div>
        );
      case "vehicle":
        return (
          <div className="grid gap-1 text-sm">
            <div className="font-semibold text-base">{record.registration || "Nieznany pojazd"}</div>
            <div>Marka: {record.brand || "—"}</div>
            <div>Kolor: {record.color || "—"}</div>
            <div>Właściciel: {record.ownerName || "—"}</div>
            {record.vehicleId ? (
              <a
                href={`/vehicle-archive/${record.vehicleId}`}
                className="underline text-blue-200"
                onClick={() => {
                  if (!session) return;
                  void logActivity({ type: "vehicle_from_dossier_open", dossierId: id, vehicleId: record.vehicleId });
                }}
              >
                Otwórz teczkę pojazdu
              </a>
            ) : null}
          </div>
        );
      case "group-link":
        return (
          <div className="grid gap-1 text-sm">
            <div className="font-semibold text-base">Powiązanie z organizacją</div>
            <div className="flex flex-wrap items-center gap-2">
              <span>Organizacja:</span>
              {record.linkedGroupId ? (
                <a href={`/criminal-groups/${record.linkedGroupId}`} className="underline text-blue-200">
                  {record.linkedGroupName || "—"}
                </a>
              ) : (
                <strong>{record.linkedGroupName || "—"}</strong>
              )}
            </div>
            {record.memberRank ? (
              <div className="flex items-center gap-2">
                <span
                  className="px-2 py-0.5 rounded-full text-xs font-semibold"
                  style={{
                    background: withAlpha(record.memberRankColor || record.linkedGroupColor || "#64748b", 0.22),
                    color: record.memberRankColor || record.linkedGroupColor || "#e2e8f0",
                  }}
                >
                  {record.memberRank}
                </span>
                <span>Rola w organizacji</span>
              </div>
            ) : null}
            {record.memberName ? <div>Członek: {record.memberName}</div> : null}
          </div>
        );
      default:
        return record.text ? (
          <div className="whitespace-pre-wrap text-sm">{record.text}</div>
        ) : null;
    }
  };

  const renderAttachments = (record: DossierRecord) => {
    const attachments: RecordAttachment[] = Array.isArray(record.attachments)
      ? record.attachments
      : record.imageUrl
      ? [{ url: record.imageUrl, name: "Załącznik" }]
      : [];
    if (!attachments.length) return null;
    return (
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {attachments.map((attachment, idx) => (
          <AttachmentPreview
            key={`${record.id}-att-${idx}`}
            attachment={attachment}
            onOpen={() => {
              if (!session) return;
              void logActivity({ type: "dossier_evidence_open", dossierId: id, recordId: record.id });
            }}
          />
        ))}
      </div>
    );
  };

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — {personTitle}</title>
        </Head>
        <Nav />
        <div
          className={`${isCriminalGroup ? "max-w-6xl" : "max-w-5xl"} mx-auto px-4 py-6 grid gap-4 ${
            isCriminalGroup ? "md:grid-cols-[minmax(0,1fr)_320px]" : ""
          }`}
        >
          <div className="grid gap-4">
            {err && <div className="card p-3 bg-red-50 text-red-700">{err}</div>}

            <div
              className={`card p-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between ${
                isCriminalGroup ? "" : ""
              }`}
              data-section={isCriminalGroup ? "criminal-groups" : "dossiers"}
              style={
                isCriminalGroup
                  ? {
                      borderColor: withAlpha(groupColorHex, 0.5),
                      boxShadow: `0 28px 74px -28px ${withAlpha(groupColorHex, 0.6)}`,
                      background: `linear-gradient(135deg, ${withAlpha(groupColorHex, 0.44)}, rgba(8, 14, 32, 0.95))`,
                    }
                  : undefined
              }
            >
              <div className="space-y-3">
                {isCriminalGroup && info.group ? (
                  <>
                    <span className="section-chip">
                      <span className="section-chip__dot" style={{ background: groupColorHex }} />
                      Grupa przestępcza
                    </span>
                    <h1 className="text-4xl font-bold tracking-tight text-white flex flex-wrap items-center gap-3">
                      <span className="text-3xl animate-bounce-slow" aria-hidden>
                        🔥
                      </span>
                      {info.group.name}
                    </h1>
                    <div className="flex flex-wrap gap-2 text-sm text-white/80">
                      <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1">
                        <span aria-hidden>🎨</span>
                        {info.group.colorName || "—"}
                      </span>
                      <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1">
                        <span aria-hidden>🏷️</span>
                        {info.group.organizationType || "Rodzaj nieznany"}
                      </span>
                      <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1">
                        <span aria-hidden>📍</span>
                        {info.group.base || "Baza nieznana"}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <h1 className="text-2xl font-bold">{personTitle}</h1>
                    <p className="text-sm text-beige-700">
                      Dokumentacja osoby wraz z pełnym dziennikiem działań i zabezpieczonymi dowodami.
                    </p>
                  </>
                )}
              </div>
              {canDeleteDossier && (
                <button className="btn bg-red-700 text-white" onClick={deleteDossier} disabled={deleting}>
                  {deleting ? "Usuwanie..." : "Usuń teczkę"}
                </button>
              )}
            </div>

            {isCriminalGroup && info.group ? (
              <div
                className="card p-6 space-y-5 relative overflow-hidden"
                data-section="criminal-groups"
                style={{
                  background: groupSummaryGradient,
                  borderColor: groupSummaryBorder,
                  boxShadow: groupSummaryShadow,
                }}
              >
                <span
                  className="absolute inset-0 opacity-60 animate-pulse-soft"
                  style={{ background: groupSummaryGlow }}
                />
                {info.group.operations ? (
                  <div className="relative text-base text-white/90 flex flex-col gap-2">
                    <span className="text-xs uppercase tracking-[0.4em] text-white/70">Zakres działalności</span>
                    <p className="leading-relaxed flex items-start gap-3">
                      <span aria-hidden>⚔️</span>
                      <span>{info.group.operations}</span>
                    </p>
                  </div>
                ) : null}
                <div className="relative grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {summaryCards.map((stat) => (
                    <div
                      key={stat.key}
                      className="stat-card"
                      style={{
                        borderColor: `${stat.accent}44`,
                        background: `linear-gradient(140deg, ${stat.accent}18, rgba(5, 11, 24, 0.72))`,
                        boxShadow: `0 22px 52px -28px ${stat.accent}77`,
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-2">
                          <span className="text-xs uppercase tracking-[0.35em] text-white/70">{stat.label}</span>
                          <div className="stat-card__value text-white">{stat.value}</div>
                        </div>
                        <span className="stat-card__icon" aria-hidden>
                          {stat.icon}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {isCriminalGroup ? (
              <div className="grid gap-4">
                <div className="card p-6 space-y-4" data-section="criminal-groups">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-2xl font-semibold">Członkowie organizacji</h2>
                    <span className="section-chip hidden sm:inline-flex" style={{ borderColor: withAlpha(groupColorHex, 0.6) }}>
                      <span className="section-chip__dot" style={{ background: withAlpha(groupColorHex, 1) }} />
                      {organizationMembers.length}
                    </span>
                  </div>
                  {organizationMembers.length ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {organizationMembers.map((member) => {
                        const allowRemove = canEditRecord(member);
                        return (
                          <div
                            key={member.id}
                            className="relative rounded-2xl border p-4 flex gap-4 overflow-hidden transition hover:-translate-y-0.5"
                            style={{
                              borderColor: withAlpha(member.rankColor || groupColorHex, 0.45),
                              background: `linear-gradient(150deg, ${withAlpha(member.rankColor || groupColorHex, 0.22)}, rgba(10, 14, 28, 0.85))`,
                              boxShadow: `0 20px 48px -26px ${withAlpha(member.rankColor || groupColorHex, 0.55)}`,
                            }}
                          >
                            <span
                              className="absolute inset-0 opacity-30"
                              style={{
                                background: `radial-gradient(circle at 18% 20%, ${withAlpha(member.rankColor || groupColorHex, 0.28)}, transparent 68%)`,
                              }}
                            />
                            {allowRemove ? (
                              <button
                                type="button"
                                className="criminal-group-remove z-20"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void deleteRecord(member.id);
                                }}
                              >
                                Usuń
                              </button>
                            ) : null}
                            {member.profileImageUrl ? (
                              <img
                                src={member.profileImageUrl}
                                alt={member.name || "Profil"}
                                className="w-16 h-16 rounded-lg object-cover relative z-10"
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-lg bg-white/10 flex items-center justify-center text-2xl relative z-10">
                                👤
                              </div>
                            )}
                            <div className="flex-1 relative z-10">
                              <div className="font-semibold text-lg text-white">{member.name || "Nieznany"}</div>
                              <div className="text-xs text-white/70">CID: {member.cid || "—"}</div>
                              <div className="mt-2 flex flex-wrap gap-1 items-center">
                                <span
                                  className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                                  style={{ background: withAlpha(member.rankColor || "#64748b", 0.24), color: member.rankColor || "#e2e8f0" }}
                                >
                                  {member.rank || "Brak informacji"}
                                </span>
                                {member.skinColor ? (
                                  <span className="text-xs text-white/75">Kolor skóry: {member.skinColor}</span>
                                ) : null}
                              </div>
                              {member.traits ? (
                                <div className="text-xs text-white/70 mt-2 leading-relaxed">Cechy: {member.traits}</div>
                              ) : null}
                              {member.dossierId ? (
                                <a href={`/dossiers/${member.dossierId}`} className="text-xs underline text-blue-100 mt-2 inline-block">
                                  Przejdź do teczki
                                </a>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-white/75">Brak dodanych członków organizacji.</p>
                  )}
                </div>

                <div className="card p-6 space-y-4" data-section="criminal-groups">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-2xl font-semibold">Pojazdy organizacji</h2>
                    <span className="section-chip hidden sm:inline-flex" style={{ borderColor: withAlpha(groupColorHex, 0.5) }}>
                      <span className="section-chip__dot" style={{ background: withAlpha(groupColorHex, 1) }} />
                      {organizationVehicles.length}
                    </span>
                  </div>
                  {organizationVehicles.length ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      {organizationVehicles.map((vehicle) => {
                        const allowRemove = canEditRecord(vehicle);
                        return (
                          <div
                            key={vehicle.id}
                            className="relative rounded-2xl border p-4 transition hover:-translate-y-0.5 overflow-hidden"
                            style={{
                              borderColor: withAlpha(groupColorHex, 0.45),
                              background: `linear-gradient(150deg, ${withAlpha(groupColorHex, 0.2)}, rgba(8, 12, 24, 0.88))`,
                              boxShadow: `0 20px 46px -26px ${withAlpha(groupColorHex, 0.55)}`,
                            }}
                          >
                            <span
                              className="absolute inset-0 opacity-25"
                              style={{
                                background: `radial-gradient(circle at 22% 18%, ${withAlpha(groupColorHex, 0.26)}, transparent 70%)`,
                              }}
                            />
                            {allowRemove ? (
                              <button
                                type="button"
                                className="criminal-group-remove z-20"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void deleteRecord(vehicle.id);
                                }}
                              >
                                Usuń
                              </button>
                            ) : null}
                            <div className="relative z-10 font-semibold text-lg text-white flex items-center gap-2">
                              <span aria-hidden>🚗</span>
                              {vehicle.registration || "Pojazd"}
                            </div>
                            <div className="relative z-10 text-sm text-white/80">
                              {vehicle.brand || "—"} • Kolor: {vehicle.color || "—"}
                            </div>
                            <div className="relative z-10 text-xs text-white/70 mt-1">
                              Właściciel: {vehicle.ownerName || "—"}
                            </div>
                            {vehicle.vehicleId ? (
                              <a
                                href={`/vehicle-archive/${vehicle.vehicleId}`}
                                className="relative z-10 mt-2 inline-flex items-center gap-2 text-xs text-white/80 underline-offset-4 hover:underline"
                                onClick={() => {
                                  if (!session) return;
                                  void logActivity({
                                    type: "vehicle_from_dossier_open",
                                    dossierId: id,
                                    vehicleId: vehicle.vehicleId,
                                  });
                                }}
                              >
                                <span aria-hidden>🔗</span>
                                <span>Otwórz teczkę pojazdu</span>
                              </a>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-white/75">Brak przypisanych pojazdów.</p>
                  )}
                </div>
              </div>
            ) : null}

            {!isCriminalGroup ? (
              <div className="card p-4 grid gap-3">
                <h2 className="font-semibold">Powiązane pojazdy</h2>
                {personVehicles.length > 0 ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {personVehicles.map((vehicle) => {
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
                            void logActivity({ type: "vehicle_from_dossier_open", dossierId: id, vehicleId: vehicle.id });
                          }}
                        >
                          <div className="font-semibold text-lg">{vehicle.registration}</div>
                          <div className="text-sm opacity-80">{vehicle.brand} • Kolor: {vehicle.color}</div>
                          <div className="text-sm opacity-80">Właściciel: {vehicle.ownerName}</div>
                          {activeFlags.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {activeFlags.map((flag: any) => (
                                <span
                                  key={flag.key}
                                  className="px-2 py-1 text-xs font-semibold rounded-full bg-black/30 border border-white/40"
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
                  <p>Brak powiązanych pojazdów.</p>
                )}
              </div>
            ) : null}

            {!isCriminalGroup ? (
              <div className="card p-4 grid gap-3">
                <h2 className="font-semibold mb-2">Dodaj notatkę</h2>
                <textarea
                  className="input h-28"
                  placeholder="Treść notatki..."
                  value={noteForm.text}
                  onChange={(e) => setNoteForm((prev) => ({ ...prev, text: e.target.value }))}
                />
                <input
                  key={noteFileKey}
                  type="file"
                  multiple
                  onChange={(e) =>
                    setNoteForm((prev) => ({ ...prev, files: Array.from(e.target.files || []) }))
                  }
                />
                <div className="flex gap-2">
                  <button className="btn btn--note" onClick={addNote} disabled={noteSaving}>
                    {noteSaving ? "Dodawanie..." : "Dodaj notatkę"}
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      setNoteForm({ text: "", files: [] });
                      setNoteFileKey((k) => k + 1);
                    }}
                  >
                    Wyczyść
                  </button>
                </div>
              </div>
            ) : null}

            <div className="grid gap-2">
              {timelineRecords.map((record) => {
                const createdAt = record.createdAt?.toDate?.();
                const dateLabel = createdAt ? new Date(createdAt).toLocaleString() : new Date().toLocaleString();
                const style = resolveRecordStyle(record);
                const label = resolveRecordLabel(record);
                return (
                  <div
                    key={record.id}
                    className="card p-3 border"
                    style={{ background: style.background, borderColor: style.borderColor }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-beige-200/80 mb-2">
                      <span>{dateLabel} • {record.author || record.authorUid}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-black/20">{label}</span>
                    </div>
                    {renderRecordDetails(record)}
                    {renderAttachments(record)}
                    {canEditRecord(record) && (
                      <div className="mt-2 flex gap-2">
                        <button className="btn" onClick={() => editRecord(record.id, record.text || "", record.type || "note")}>Edytuj</button>
                        <button className="btn bg-red-700 text-white" onClick={() => deleteRecord(record.id)}>
                          Usuń
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {timelineRecords.length === 0 && <div className="card p-3">Brak wpisów.</div>}
            </div>
          </div>

          {isCriminalGroup ? (
            <aside className="grid gap-4">
              <div
                className="card p-5 sticky top-24 space-y-4"
                data-section="criminal-groups"
                style={{
                  borderColor: withAlpha(groupColorHex, 0.55),
                  boxShadow: `0 28px 70px -28px ${withAlpha(groupColorHex, 0.75)}`,
                  background: `linear-gradient(140deg, ${withAlpha(groupColorHex, 0.5)}, rgba(8, 14, 30, 0.92))`,
                }}
              >
                <div className="space-y-2">
                  <h2 className="text-xl font-semibold text-white">Dodaj wpis</h2>
                  <p className="text-sm text-white/75">
                    Wybierz kategorię, aby uzupełnić dokumentację organizacji.
                  </p>
                </div>
                <div className="grid gap-2">
                  {actionButtons.map((action) => (
                    <button
                      key={action.type}
                      type="button"
                      onClick={() => openForm(action.type)}
                      className="w-full rounded-xl border px-3 py-3 text-left transition hover:-translate-y-0.5 hover:shadow-xl"
                      style={{
                        background: `linear-gradient(135deg, ${withAlpha(RECORD_COLORS[action.type], 0.28)}, rgba(5, 10, 20, 0.7))`,
                        borderColor: withAlpha(RECORD_COLORS[action.type], 0.5),
                      }}
                    >
                      <div className="font-semibold text-white flex items-center gap-2">
                        <span aria-hidden>➕</span>
                        {action.label}
                      </div>
                      <div className="text-xs text-white/70">{action.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          ) : null}
        </div>

        {activeForm ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-white/10 bg-[var(--card)] shadow-[0_20px_60px_rgba(0,0,0,0.65)]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <h3 className="text-lg font-semibold">{ACTIVE_FORM_TITLES[activeForm]}</h3>
                <button type="button" className="btn" onClick={closeActiveForm}>
                  Zamknij
                </button>
              </div>
              <div className="p-4 grid gap-4">{renderActiveForm()}</div>
            </div>
          </div>
        ) : null}
      </>
    </AuthGate>
  );
}

