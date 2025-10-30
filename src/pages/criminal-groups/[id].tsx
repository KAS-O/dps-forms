import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import Nav from "@/components/Nav";
import AuthGate from "@/components/AuthGate";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
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
  limit,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "@/lib/firebase";
import { useProfile } from "@/hooks/useProfile";
import { useDialog } from "@/components/DialogProvider";
import { useSessionActivity } from "@/components/ActivityLogger";

interface Attachment {
  url: string;
  name: string;
  contentType?: string;
  storagePath?: string;
}

interface CriminalGroup {
  id: string;
  name: string;
  colorHex: string;
  colorLabel?: string;
  organizationType?: string;
  base?: string;
  operations?: string;
}

interface CriminalGroupEntryBase {
  id: string;
  type: "note" | "weapon" | "drug" | "explosive";
  createdAt?: any;
  author?: string;
  authorUid?: string;
  attachments?: Attachment[];
  controlledTransaction?: boolean;
}

interface NoteEntry extends CriminalGroupEntryBase {
  type: "note";
  text: string;
}

interface WeaponEntry extends CriminalGroupEntryBase {
  type: "weapon";
  weaponModel: string;
  serialNumbers: string;
  acquiredFrom?: string;
  crimeInvolvement?: "tak" | "nie" | "brak informacji";
  date?: string;
  time?: string;
  purchasePrice?: string;
  blackMarketValue?: string;
}

interface DrugEntry extends CriminalGroupEntryBase {
  type: "drug";
  drugType: string;
  amountGrams: string;
  quality?: string;
  date?: string;
  time?: string;
  location?: string;
  acquiredFrom?: string;
  purchasePrice?: string;
  blackMarketValue?: string;
  note?: string;
}

interface ExplosiveEntry extends CriminalGroupEntryBase {
  type: "explosive";
  materialType: string;
  amount?: string;
  date?: string;
  time?: string;
  location?: string;
  acquiredFrom?: string;
  purchasePrice?: string;
  blackMarketValue?: string;
  note?: string;
}

type CriminalGroupEntry = NoteEntry | WeaponEntry | DrugEntry | ExplosiveEntry;

interface GroupMember {
  id: string;
  dossierId?: string;
  fullName: string;
  cid: string;
  rank: GroupRank;
  skinColor?: string;
  traits?: string;
  profileUrl?: string;
  profilePath?: string;
  createdAt?: any;
}

type GroupRank = "rekrut" | "czlonek" | "wysoki" | "prawa-reka" | "zarzad" | "brak";

interface GroupVehicle {
  id: string;
  vehicleId: string;
  registration: string;
  brand: string;
  color: string;
  ownerName: string;
}

const ENTRY_META: Record<CriminalGroupEntry["type"], { label: string; color: string; icon: string }> = {
  note: { label: "Notatka", color: "#1e3a8a", icon: "📝" },
  weapon: { label: "Broń", color: "#991b1b", icon: "🔫" },
  drug: { label: "Narkotyki", color: "#047857", icon: "💊" },
  explosive: { label: "Materiały wybuchowe", color: "#b45309", icon: "💣" },
};

const RANKS: { value: GroupRank; label: string; badge: string; color: string }[] = [
  { value: "rekrut", label: "Rekrut", badge: "REKRUT", color: "#6b7280" },
  { value: "czlonek", label: "Członek", badge: "CZŁONEK", color: "#2563eb" },
  { value: "wysoki", label: "Wysoki członek", badge: "WYSOKI", color: "#7c3aed" },
  { value: "prawa-reka", label: "Prawa ręka", badge: "PRAWA RĘKA", color: "#f97316" },
  { value: "zarzad", label: "Zarząd", badge: "ZARZĄD", color: "#dc2626" },
  { value: "brak", label: "Brak informacji", badge: "BRAK", color: "#374151" },
];

const RANK_OPTIONS: Record<GroupRank, { label: string; badge: string; color: string }> = RANKS.reduce(
  (acc, rank) => ({ ...acc, [rank.value]: { label: rank.label, badge: rank.badge, color: rank.color } }),
  {} as Record<GroupRank, { label: string; badge: string; color: string }>
);

function hexToRgba(hex: string, alpha: number) {
  const sanitized = hex.replace("#", "");
  const bigint = parseInt(sanitized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function entryBackground(entry: CriminalGroupEntry) {
  const baseColor = ENTRY_META[entry.type]?.color || "#1f2937";
  if (entry.controlledTransaction) {
    return `linear-gradient(135deg, rgba(249, 115, 22, 0.9), ${hexToRgba(baseColor, 0.85)})`;
  }
  return `linear-gradient(135deg, ${hexToRgba(baseColor, 0.85)}, ${hexToRgba(baseColor, 0.65)})`;
}

function entryBorder(entry: CriminalGroupEntry) {
  const baseColor = ENTRY_META[entry.type]?.color || "#1f2937";
  return `${hexToRgba(baseColor, 0.7)}`;
}

export default function CriminalGroupPage() {
  const router = useRouter();
  const { id } = router.query as { id: string };
  const { role } = useProfile();
  const { confirm } = useDialog();
  const { session, logActivity } = useSessionActivity();

  const [group, setGroup] = useState<CriminalGroup | null>(null);
  const [entries, setEntries] = useState<CriminalGroupEntry[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [vehicles, setVehicles] = useState<GroupVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ tone: "error" | "success"; message: string } | null>(null);

  const [infoForm, setInfoForm] = useState({
    name: "",
    colorHex: "#6d28d9",
    colorLabel: "Fioletowa",
    organizationType: "Gang uliczny",
    base: "Grove Street",
    operations:
      "Handel narkotykami, handel bronią, handel materiałami wybuchowymi, tworzenie materiałów wybuchowych, napady, wyłudzenia, porwania, strzelaniny, pranie pieniędzy",
  });

  const [noteText, setNoteText] = useState("");
  const [noteFiles, setNoteFiles] = useState<File[]>([]);
  const noteFileInput = useRef<HTMLInputElement | null>(null);

  const [weaponForm, setWeaponForm] = useState({
    weaponModel: "",
    serialNumbers: "",
    acquiredFrom: "",
    crimeInvolvement: "brak informacji" as WeaponEntry["crimeInvolvement"],
    date: "",
    time: "",
    purchasePrice: "",
    blackMarketValue: "",
    controlledTransaction: false,
  });
  const [weaponFiles, setWeaponFiles] = useState<File[]>([]);
  const weaponFileInput = useRef<HTMLInputElement | null>(null);

  const [drugForm, setDrugForm] = useState({
    drugType: "",
    amountGrams: "",
    quality: "",
    date: "",
    time: "",
    location: "",
    acquiredFrom: "",
    purchasePrice: "",
    blackMarketValue: "",
    note: "",
    controlledTransaction: false,
  });
  const [drugFiles, setDrugFiles] = useState<File[]>([]);
  const drugFileInput = useRef<HTMLInputElement | null>(null);

  const [explosiveForm, setExplosiveForm] = useState({
    materialType: "",
    amount: "",
    date: "",
    time: "",
    location: "",
    acquiredFrom: "",
    purchasePrice: "",
    blackMarketValue: "",
    note: "",
    controlledTransaction: false,
  });
  const [explosiveFiles, setExplosiveFiles] = useState<File[]>([]);
  const explosiveFileInput = useRef<HTMLInputElement | null>(null);

  const [memberForm, setMemberForm] = useState({
    dossierCid: "",
    fullName: "",
    cid: "",
    rank: "brak" as GroupRank,
    skinColor: "",
    traits: "",
  });
  const [memberFile, setMemberFile] = useState<File | null>(null);
  const memberFileInput = useRef<HTMLInputElement | null>(null);

  const [vehicleRegistration, setVehicleRegistration] = useState("");

  const me = auth.currentUser?.uid;
  const canManageEntries = (entry: CriminalGroupEntry) =>
    role === "director" || role === "chief" || (!!me && entry.authorUid === me);

  const canManageMembers = role === "director" || role === "chief" || role === "senior";

  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(db, "criminalGroups", id), (snap) => {
      if (!snap.exists()) {
        setGroup(null);
        setLoading(false);
        return;
      }
      const data = snap.data() as any;
      const payload: CriminalGroup = {
        id: snap.id,
        name: data.name || "",
        colorHex: data.colorHex || "#6d28d9",
        colorLabel: data.colorLabel || "",
        organizationType: data.organizationType || "",
        base: data.base || "",
        operations: data.operations || "",
      };
      setGroup(payload);
      setInfoForm({
        name: payload.name,
        colorHex: payload.colorHex,
        colorLabel: payload.colorLabel || "",
        organizationType: payload.organizationType || "",
        base: payload.base || "",
        operations: payload.operations || "",
      });
      setLoading(false);
    });
    return () => unsub();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const qEntries = query(
      collection(db, "criminalGroups", id, "entries"),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(qEntries, (snap) => {
      setEntries(
        snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }) as CriminalGroupEntry)
      );
    });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const qMembers = query(collection(db, "criminalGroups", id, "members"), orderBy("createdAt", "desc"));
    return onSnapshot(qMembers, (snap) => {
      setMembers(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }) as GroupMember));
    });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const qVehicles = query(collection(db, "criminalGroups", id, "vehicles"), orderBy("addedAt", "desc"));
    return onSnapshot(qVehicles, (snap) => {
      setVehicles(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }) as GroupVehicle));
    });
  }, [id]);

  useEffect(() => {
    if (!id || !session) return;
    void logActivity({ type: "criminal_group_view", groupId: id });
  }, [id, session, logActivity]);

  const resetFileInput = (refEl: RefObject<HTMLInputElement>) => {
    if (refEl.current) {
      refEl.current.value = "";
    }
  };

  const uploadAttachments = async (files: File[], folder: string) => {
    if (!storage || !id) return [] as Attachment[];
    const uploads: Attachment[] = [];
    for (const file of files) {
      const path = `criminal-groups/${id}/${folder}/${Date.now()}_${file.name}`;
      const storageRef = ref(storage, path);
      const snapshot = await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      uploads.push({
        url,
        name: file.name,
        contentType: snapshot.metadata.contentType || file.type,
        storagePath: snapshot.ref.fullPath,
      });
    }
    return uploads;
  };

  const saveInfo = async () => {
    if (!id) return;
    try {
      const colorHex = infoForm.colorHex.trim();
      if (!/^#?[0-9a-fA-F]{6}$/.test(colorHex)) {
        setBanner({ tone: "error", message: "Podaj prawidłowy kolor HEX." });
        return;
      }
      const payload = {
        name: infoForm.name.trim(),
        colorHex: colorHex.startsWith("#") ? colorHex : `#${colorHex}`,
        colorLabel: infoForm.colorLabel.trim() || null,
        organizationType: infoForm.organizationType.trim() || null,
        base: infoForm.base.trim() || null,
        operations: infoForm.operations.trim() || null,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, "criminalGroups", id), payload);
      await addDoc(collection(db, "logs"), {
        type: "criminal_group_update",
        groupId: id,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setBanner({ tone: "success", message: "Zapisano informacje o grupie." });
    } catch (e: any) {
      console.error(e);
      setBanner({ tone: "error", message: e?.message || "Nie udało się zapisać informacji." });
    }
  };

  const addNote = async () => {
    if (!id) return;
    if (!noteText.trim() && noteFiles.length === 0) {
      setBanner({ tone: "error", message: "Dodaj treść notatki lub załącz plik." });
      return;
    }
    try {
      const attachments = await uploadAttachments(noteFiles, "notes");
      const payload: Partial<NoteEntry> = {
        type: "note",
        text: noteText.trim(),
        attachments,
        createdAt: serverTimestamp(),
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
      };
      await addDoc(collection(db, "criminalGroups", id, "entries"), payload);
      await addDoc(collection(db, "logs"), {
        type: "criminal_group_entry_add",
        entryType: "note",
        groupId: id,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setNoteText("");
      setNoteFiles([]);
      resetFileInput(noteFileInput);
      setBanner({ tone: "success", message: "Dodano notatkę." });
    } catch (e: any) {
      console.error(e);
      setBanner({ tone: "error", message: e?.message || "Nie udało się dodać notatki." });
    }
  };

  const addWeapon = async () => {
    if (!id) return;
    if (!weaponForm.weaponModel.trim() || !weaponForm.serialNumbers.trim()) {
      setBanner({ tone: "error", message: "Uzupełnij model broni i numery seryjne." });
      return;
    }
    try {
      const attachments = await uploadAttachments(weaponFiles, "weapons");
      const payload: Partial<WeaponEntry> = {
        type: "weapon",
        weaponModel: weaponForm.weaponModel.trim(),
        serialNumbers: weaponForm.serialNumbers.trim(),
        acquiredFrom: weaponForm.acquiredFrom.trim() || null,
        crimeInvolvement: weaponForm.crimeInvolvement,
        date: weaponForm.date || null,
        time: weaponForm.time || null,
        purchasePrice: weaponForm.purchasePrice || null,
        blackMarketValue: weaponForm.blackMarketValue || null,
        attachments,
        controlledTransaction: weaponForm.controlledTransaction,
        createdAt: serverTimestamp(),
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
      };
      await addDoc(collection(db, "criminalGroups", id, "entries"), payload);
      await addDoc(collection(db, "logs"), {
        type: "criminal_group_entry_add",
        entryType: "weapon",
        groupId: id,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setWeaponForm({
        weaponModel: "",
        serialNumbers: "",
        acquiredFrom: "",
        crimeInvolvement: "brak informacji",
        date: "",
        time: "",
        purchasePrice: "",
        blackMarketValue: "",
        controlledTransaction: false,
      });
      setWeaponFiles([]);
      resetFileInput(weaponFileInput);
      setBanner({ tone: "success", message: "Dodano broń jako dowód." });
    } catch (e: any) {
      console.error(e);
      setBanner({ tone: "error", message: e?.message || "Nie udało się dodać dowodu z bronią." });
    }
  };

  const addDrug = async () => {
    if (!id) return;
    if (!drugForm.drugType.trim() || !drugForm.amountGrams.trim()) {
      setBanner({ tone: "error", message: "Uzupełnij rodzaj i ilość narkotyku." });
      return;
    }
    try {
      const attachments = await uploadAttachments(drugFiles, "drugs");
      const payload: Partial<DrugEntry> = {
        type: "drug",
        drugType: drugForm.drugType.trim(),
        amountGrams: drugForm.amountGrams.trim(),
        quality: drugForm.quality.trim() || null,
        date: drugForm.date || null,
        time: drugForm.time || null,
        location: drugForm.location.trim() || null,
        acquiredFrom: drugForm.acquiredFrom.trim() || null,
        purchasePrice: drugForm.purchasePrice || null,
        blackMarketValue: drugForm.blackMarketValue || null,
        note: drugForm.note.trim() || null,
        attachments,
        controlledTransaction: drugForm.controlledTransaction,
        createdAt: serverTimestamp(),
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
      };
      await addDoc(collection(db, "criminalGroups", id, "entries"), payload);
      await addDoc(collection(db, "logs"), {
        type: "criminal_group_entry_add",
        entryType: "drug",
        groupId: id,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setDrugForm({
        drugType: "",
        amountGrams: "",
        quality: "",
        date: "",
        time: "",
        location: "",
        acquiredFrom: "",
        purchasePrice: "",
        blackMarketValue: "",
        note: "",
        controlledTransaction: false,
      });
      setDrugFiles([]);
      resetFileInput(drugFileInput);
      setBanner({ tone: "success", message: "Dodano narkotyki jako dowód." });
    } catch (e: any) {
      console.error(e);
      setBanner({ tone: "error", message: e?.message || "Nie udało się dodać narkotyków." });
    }
  };

  const addExplosive = async () => {
    if (!id) return;
    if (!explosiveForm.materialType.trim()) {
      setBanner({ tone: "error", message: "Uzupełnij rodzaj materiału wybuchowego." });
      return;
    }
    try {
      const attachments = await uploadAttachments(explosiveFiles, "explosives");
      const payload: Partial<ExplosiveEntry> = {
        type: "explosive",
        materialType: explosiveForm.materialType.trim(),
        amount: explosiveForm.amount.trim() || null,
        date: explosiveForm.date || null,
        time: explosiveForm.time || null,
        location: explosiveForm.location.trim() || null,
        acquiredFrom: explosiveForm.acquiredFrom.trim() || null,
        purchasePrice: explosiveForm.purchasePrice || null,
        blackMarketValue: explosiveForm.blackMarketValue || null,
        note: explosiveForm.note.trim() || null,
        attachments,
        controlledTransaction: explosiveForm.controlledTransaction,
        createdAt: serverTimestamp(),
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
      };
      await addDoc(collection(db, "criminalGroups", id, "entries"), payload);
      await addDoc(collection(db, "logs"), {
        type: "criminal_group_entry_add",
        entryType: "explosive",
        groupId: id,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setExplosiveForm({
        materialType: "",
        amount: "",
        date: "",
        time: "",
        location: "",
        acquiredFrom: "",
        purchasePrice: "",
        blackMarketValue: "",
        note: "",
        controlledTransaction: false,
      });
      setExplosiveFiles([]);
      resetFileInput(explosiveFileInput);
      setBanner({ tone: "success", message: "Dodano materiał wybuchowy jako dowód." });
    } catch (e: any) {
      console.error(e);
      setBanner({ tone: "error", message: e?.message || "Nie udało się dodać materiału wybuchowego." });
    }
  };

  const addMember = async () => {
    if (!id) return;
    if (!memberForm.fullName.trim() || !memberForm.cid.trim()) {
      setBanner({ tone: "error", message: "Uzupełnij imię, nazwisko oraz CID." });
      return;
    }
    try {
      let dossierId: string | undefined;
      const cidNormalized = memberForm.dossierCid.trim().toLowerCase() || memberForm.cid.trim().toLowerCase();
      if (cidNormalized) {
        const dossierRef = doc(db, "dossiers", cidNormalized);
        const snap = await getDoc(dossierRef);
        if (!snap.exists()) {
          setBanner({ tone: "error", message: "Nie znaleziono teczki o podanym CID." });
          return;
        }
        dossierId = dossierRef.id;
      }
      let profileAttachment: Attachment | undefined;
      if (memberFile) {
        const uploads = await uploadAttachments([memberFile], "members");
        profileAttachment = uploads[0];
      }
      const payload = {
        dossierId: dossierId || null,
        fullName: memberForm.fullName.trim(),
        cid: memberForm.cid.trim(),
        rank: memberForm.rank,
        skinColor: memberForm.skinColor.trim() || null,
        traits: memberForm.traits.trim() || null,
        profileUrl: profileAttachment?.url || null,
        profilePath: profileAttachment?.storagePath || null,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email || "",
        createdByUid: auth.currentUser?.uid || "",
      };
      await addDoc(collection(db, "criminalGroups", id, "members"), payload);
      await addDoc(collection(db, "logs"), {
        type: "criminal_group_member_add",
        groupId: id,
        dossierId: dossierId || null,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setMemberForm({
        dossierCid: "",
        fullName: "",
        cid: "",
        rank: "brak",
        skinColor: "",
        traits: "",
      });
      setMemberFile(null);
      resetFileInput(memberFileInput);
      setBanner({ tone: "success", message: "Dodano członka grupy." });
    } catch (e: any) {
      console.error(e);
      setBanner({ tone: "error", message: e?.message || "Nie udało się dodać członka." });
    }
  };

  const addVehicle = async () => {
    if (!id) return;
    const registration = vehicleRegistration.trim();
    if (!registration) {
      setBanner({ tone: "error", message: "Podaj numer rejestracyjny pojazdu." });
      return;
    }
    try {
      const normalized = registration.toUpperCase().replace(/\s+/g, "");
      const qVehicles = query(
        collection(db, "vehicleFolders"),
        where("registrationNormalized", "==", normalized),
        limit(1)
      );
      const snap = await getDocs(qVehicles);
      if (snap.empty) {
        setBanner({ tone: "error", message: "Nie znaleziono teczki pojazdu o podanym numerze." });
        return;
      }
      const docSnap = snap.docs[0];
      const data = docSnap.data() as any;
      await addDoc(collection(db, "criminalGroups", id, "vehicles"), {
        vehicleId: docSnap.id,
        registration: data.registration,
        brand: data.brand,
        color: data.color,
        ownerName: data.ownerName,
        addedAt: serverTimestamp(),
        createdBy: auth.currentUser?.email || "",
        createdByUid: auth.currentUser?.uid || "",
      });
      await addDoc(collection(db, "logs"), {
        type: "criminal_group_vehicle_add",
        groupId: id,
        vehicleId: docSnap.id,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setVehicleRegistration("");
      setBanner({ tone: "success", message: "Dodano pojazd do organizacji." });
    } catch (e: any) {
      console.error(e);
      setBanner({ tone: "error", message: e?.message || "Nie udało się dodać pojazdu." });
    }
  };

  const deleteEntry = async (entry: CriminalGroupEntry) => {
    if (!id) return;
    const ok = await confirm({
      title: "Usuń wpis",
      message: "Czy na pewno chcesz usunąć ten wpis z akt grupy?",
      confirmLabel: "Usuń",
      tone: "danger",
    });
    if (!ok) return;
    try {
      if (entry.attachments) {
        await Promise.all(
          entry.attachments
            .filter((att) => att.storagePath)
            .map(async (att) => {
              try {
                await deleteObject(ref(storage, att.storagePath!));
              } catch (err) {
                console.warn("Nie udało się usunąć pliku", err);
              }
            })
        );
      }
      await deleteDoc(doc(db, "criminalGroups", id, "entries", entry.id));
      await addDoc(collection(db, "logs"), {
        type: "criminal_group_entry_delete",
        entryType: entry.type,
        groupId: id,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setBanner({ tone: "success", message: "Wpis został usunięty." });
    } catch (e: any) {
      console.error(e);
      setBanner({ tone: "error", message: e?.message || "Nie udało się usunąć wpisu." });
    }
  };

  const deleteMember = async (member: GroupMember) => {
    if (!id) return;
    const ok = await confirm({
      title: "Usuń członka",
      message: `Czy na pewno chcesz usunąć ${member.fullName} z grupy?`,
      confirmLabel: "Usuń",
      tone: "danger",
    });
    if (!ok) return;
    try {
      if (member.profilePath) {
        try {
          await deleteObject(ref(storage, member.profilePath));
        } catch (err) {
          console.warn("Nie udało się usunąć zdjęcia profilowego", err);
        }
      }
      await deleteDoc(doc(db, "criminalGroups", id, "members", member.id));
      await addDoc(collection(db, "logs"), {
        type: "criminal_group_member_delete",
        groupId: id,
        memberId: member.id,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setBanner({ tone: "success", message: "Członek został usunięty." });
    } catch (e: any) {
      console.error(e);
      setBanner({ tone: "error", message: e?.message || "Nie udało się usunąć członka." });
    }
  };

  const deleteVehicle = async (vehicle: GroupVehicle) => {
    if (!id) return;
    const ok = await confirm({
      title: "Usuń pojazd",
      message: `Czy na pewno chcesz usunąć pojazd ${vehicle.registration} z organizacji?`,
      confirmLabel: "Usuń",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "criminalGroups", id, "vehicles", vehicle.id));
      await addDoc(collection(db, "logs"), {
        type: "criminal_group_vehicle_delete",
        groupId: id,
        vehicleId: vehicle.vehicleId,
        author: auth.currentUser?.email || "",
        authorUid: auth.currentUser?.uid || "",
        ts: serverTimestamp(),
      });
      setBanner({ tone: "success", message: "Pojazd został usunięty." });
    } catch (e: any) {
      console.error(e);
      setBanner({ tone: "error", message: e?.message || "Nie udało się usunąć pojazdu." });
    }
  };

  const formatDate = (value?: any) => {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (value?.toDate) return new Date(value.toDate()).toLocaleString();
    try {
      return new Date(value).toLocaleString();
    } catch {
      return String(value);
    }
  };

  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      const order = ["zarzad", "prawa-reka", "wysoki", "czlonek", "rekrut", "brak"];
      const aIdx = order.indexOf(a.rank || "brak");
      const bIdx = order.indexOf(b.rank || "brak");
      if (aIdx !== bIdx) return aIdx - bIdx;
      return (a.fullName || "").localeCompare(b.fullName || "");
    });
  }, [members]);

  if (loading) {
    return (
      <AuthGate>
        <>
          <Head>
            <title>LSPD 77RP — Grupa</title>
          </Head>
          <Nav />
          <div className="max-w-4xl mx-auto px-4 py-10 text-center">Ładowanie...</div>
        </>
      </AuthGate>
    );
  }

  if (!group) {
    return (
      <AuthGate>
        <>
          <Head>
            <title>LSPD 77RP — Grupa</title>
          </Head>
          <Nav />
          <div className="max-w-4xl mx-auto px-4 py-10">
            <div className="card p-6 bg-red-100 text-red-800">
              Nie znaleziono takiej grupy. Wróć do listy <Link className="underline" href="/criminal-groups">grup przestępczych</Link>.
            </div>
          </div>
        </>
      </AuthGate>
    );
  }

  const renderAttachment = (entry: CriminalGroupEntry, attachment: Attachment, index: number) => {
    const isImage = attachment.contentType?.startsWith("image/");
    const isVideo = attachment.contentType?.startsWith("video/");
    const handleClick = () => {
      if (!session) return;
      void logActivity({
        type: "criminal_group_attachment_open",
        groupId: id,
        entryId: entry.id,
        attachmentIndex: index,
      });
    };
    if (isImage) {
      return (
        <a
          key={index}
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
          onClick={handleClick}
        >
          <img
            src={attachment.url}
            alt={attachment.name}
            className="w-full rounded-lg border border-white/30 max-h-72 object-cover"
          />
        </a>
      );
    }
    if (isVideo) {
      return (
        <video key={index} controls className="w-full rounded-lg border border-white/30" onClick={handleClick}>
          <source src={attachment.url} type={attachment.contentType || "video/mp4"} />
        </video>
      );
    }
    return (
      <a
        key={index}
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
        onClick={handleClick}
        className="underline"
      >
        {attachment.name}
      </a>
    );
  };

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — {group.name}</title>
        </Head>
        <Nav />
        <div className="max-w-6xl mx-auto px-4 py-6 grid gap-6">
          {banner && (
            <div
              className={`card p-4 ${
                banner.tone === "error"
                  ? "bg-red-100 text-red-800"
                  : "bg-green-100 text-green-800"
              }`}
            >
              {banner.message}
            </div>
          )}

          <div className="card p-5 bg-[var(--card)]/80 border border-white/10">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <span className="uppercase tracking-[0.4em] text-xs text-beige-700">{group.colorLabel}</span>
                <h1 className="text-3xl font-bold" style={{ color: group.colorHex }}>
                  {group.name}
                </h1>
                <p className="text-sm text-beige-700 mt-2">
                  {group.organizationType || "Organizacja przestępcza"}
                </p>
              </div>
              <div className="grid gap-2 text-sm text-beige-800">
                <div>
                  <span className="font-semibold">Baza:</span> {group.base || "Brak danych"}
                </div>
                <div>
                  <span className="font-semibold">Zakres działalności:</span> {group.operations || "Brak informacji"}
                </div>
              </div>
            </div>
          </div>

          <div className="card p-5 grid gap-4">
            <h2 className="text-lg font-semibold">Edytuj informacje o grupie</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="label">Nazwa</label>
                <input
                  className="input"
                  value={infoForm.name}
                  onChange={(e) => setInfoForm((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Kolor HEX</label>
                <input
                  className="input"
                  value={infoForm.colorHex}
                  onChange={(e) => setInfoForm((prev) => ({ ...prev, colorHex: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Kolorystyka</label>
                <input
                  className="input"
                  value={infoForm.colorLabel}
                  onChange={(e) => setInfoForm((prev) => ({ ...prev, colorLabel: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Rodzaj organizacji</label>
                <input
                  className="input"
                  value={infoForm.organizationType}
                  onChange={(e) => setInfoForm((prev) => ({ ...prev, organizationType: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Baza grupy</label>
                <input
                  className="input"
                  value={infoForm.base}
                  onChange={(e) => setInfoForm((prev) => ({ ...prev, base: e.target.value }))}
                />
              </div>
              <div className="md:col-span-2">
                <label className="label">Zakres działalności</label>
                <textarea
                  className="input h-24"
                  value={infoForm.operations}
                  onChange={(e) => setInfoForm((prev) => ({ ...prev, operations: e.target.value }))}
                />
              </div>
            </div>
            <button className="btn w-fit" onClick={saveInfo}>
              Zapisz informacje
            </button>
          </div>



          <div className="card p-5 grid gap-4">
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">Członkowie grupy</h2>
              {sortedMembers.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {sortedMembers.map((member) => {
                    const rankMeta = RANK_OPTIONS[member.rank || "brak"] || RANK_OPTIONS.brak;
                    return (
                      <div key={member.id} className="card p-4 bg-white/80 border border-white/40">
                        <div className="flex gap-4 items-center">
                          {member.profileUrl ? (
                            member.dossierId ? (
                              <Link
                                href={`/dossiers/${member.dossierId}`}
                                className="block w-16 h-16 rounded-full overflow-hidden border border-white/60 hover:shadow-lg transition"
                              >
                                <img src={member.profileUrl} alt={member.fullName} className="w-full h-full object-cover" />
                              </Link>
                            ) : (
                              <div className="block w-16 h-16 rounded-full overflow-hidden border border-white/60">
                                <img src={member.profileUrl} alt={member.fullName} className="w-full h-full object-cover" />
                              </div>
                            )
                          ) : (
                            <div className="w-16 h-16 rounded-full bg-black/10 flex items-center justify-center text-2xl">👤</div>
                          )}
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              {member.dossierId ? (
                                <Link href={`/dossiers/${member.dossierId}`} className="font-semibold hover:underline">
                                  {member.fullName}
                                </Link>
                              ) : (
                                <span className="font-semibold">{member.fullName}</span>
                              )}
                              <span
                                className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded"
                                style={{
                                  backgroundColor: hexToRgba(rankMeta.color, 0.15),
                                  color: rankMeta.color,
                                }}
                              >
                                {rankMeta.badge}
                              </span>
                            </div>
                            <div className="text-sm text-beige-700">CID: {member.cid}</div>
                            {member.skinColor && (
                              <div className="text-xs text-beige-700">Kolor skóry: {member.skinColor}</div>
                            )}
                            {member.traits && (
                              <div className="text-xs text-beige-700">Cechy: {member.traits}</div>
                            )}
                          </div>
                        </div>
                        {canManageMembers && (
                          <button className="btn mt-3 bg-red-700 text-white" onClick={() => deleteMember(member)}>
                            Usuń członka
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-beige-700">Brak przypisanych członków.</p>
              )}
            </div>

            {canManageMembers && (
              <div className="border-t border-white/10 pt-4">
                <h3 className="font-semibold mb-2">Dodaj członka</h3>
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <label className="label">CID teczki</label>
                    <input
                      className="input"
                      value={memberForm.dossierCid}
                      onChange={(e) => setMemberForm((prev) => ({ ...prev, dossierCid: e.target.value }))}
                      placeholder="np. 1234"
                    />
                  </div>
                  <div>
                    <label className="label">Imię i nazwisko</label>
                    <input
                      className="input"
                      value={memberForm.fullName}
                      onChange={(e) => setMemberForm((prev) => ({ ...prev, fullName: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label">CID</label>
                    <input
                      className="input"
                      value={memberForm.cid}
                      onChange={(e) => setMemberForm((prev) => ({ ...prev, cid: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label">Stopień w grupie</label>
                    <select
                      className="input"
                      value={memberForm.rank}
                      onChange={(e) => setMemberForm((prev) => ({ ...prev, rank: e.target.value as GroupRank }))}
                    >
                      {RANKS.map((rank) => (
                        <option key={rank.value} value={rank.value}>
                          {rank.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Kolor skóry</label>
                    <input
                      className="input"
                      value={memberForm.skinColor}
                      onChange={(e) => setMemberForm((prev) => ({ ...prev, skinColor: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label">Cechy szczególne</label>
                    <input
                      className="input"
                      value={memberForm.traits}
                      onChange={(e) => setMemberForm((prev) => ({ ...prev, traits: e.target.value }))}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="label">Zdjęcie profilowe</label>
                    <input
                      ref={memberFileInput}
                      type="file"
                      accept="image/*"
                      onChange={(e) => setMemberFile(e.target.files?.[0] || null)}
                    />
                  </div>
                </div>
                <button className="btn mt-3" onClick={addMember}>
                  Dodaj członka
                </button>
              </div>
            )}
          </div>


          <div className="card p-5 grid gap-4">
            <h2 className="text-lg font-semibold">Pojazdy powiązane</h2>
            {vehicles.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2">
                {vehicles.map((vehicle) => (
                  <div key={vehicle.id} className="card p-4 bg-black/50 border border-white/20 text-white">
                    <div className="flex flex-col gap-1">
                      <Link href={`/vehicle-archive/${vehicle.vehicleId}`} className="text-xl font-semibold hover:underline">
                        {vehicle.registration}
                      </Link>
                      <div className="text-sm opacity-90">
                        {vehicle.brand} • {vehicle.color}
                      </div>
                      <div className="text-sm opacity-80">Właściciel: {vehicle.ownerName}</div>
                    </div>
                    {canManageMembers && (
                      <button className="btn mt-3 bg-red-700 text-white" onClick={() => deleteVehicle(vehicle)}>
                        Usuń pojazd
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-beige-700">Brak powiązanych pojazdów.</p>
            )}
            <div className="border-t border-white/10 pt-4">
              <h3 className="font-semibold mb-2">Dodaj pojazd</h3>
              <div className="flex flex-col md:flex-row gap-3">
                <input
                  className="input md:w-64"
                  placeholder="Numer rejestracyjny"
                  value={vehicleRegistration}
                  onChange={(e) => setVehicleRegistration(e.target.value)}
                />
                <button className="btn md:w-auto" onClick={addVehicle}>
                  Dodaj pojazd
                </button>
              </div>
              <p className="text-xs text-beige-700 mt-2">
                Pojazd musi istnieć w archiwum pojazdów, aby można go było powiązać.
              </p>
            </div>
          </div>


          <div className="card p-5 grid gap-6">
            <h2 className="text-lg font-semibold">Dodaj wpis</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="card p-4 bg-blue-900/90 text-white">
                <h3 className="font-semibold flex items-center gap-2 text-lg">📝 Notatka</h3>
                <textarea
                  className="input mt-3 h-28 text-black"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Opis czynności, informacje operacyjne..."
                />
                <input
                  ref={noteFileInput}
                  type="file"
                  multiple
                  className="mt-3"
                  onChange={(e) => setNoteFiles(Array.from(e.target.files || []))}
                />
                <button className="btn mt-3" onClick={addNote}>
                  Dodaj notatkę
                </button>
              </div>

              <div
                className="card p-4 text-white"
                style={{
                  background: entryBackground({ type: "weapon", controlledTransaction: weaponForm.controlledTransaction } as WeaponEntry),
                }}
              >
                <h3 className="font-semibold flex items-center gap-2 text-lg">🔫 Broń jako dowód</h3>
                <div className="grid md:grid-cols-2 gap-3 mt-3 text-black">
                  <div>
                    <label className="label text-white">Model broni</label>
                    <input
                      className="input"
                      value={weaponForm.weaponModel}
                      onChange={(e) => setWeaponForm((prev) => ({ ...prev, weaponModel: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Numery seryjne</label>
                    <input
                      className="input"
                      value={weaponForm.serialNumbers}
                      onChange={(e) => setWeaponForm((prev) => ({ ...prev, serialNumbers: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Od kogo kupiona / zabrana</label>
                    <input
                      className="input"
                      value={weaponForm.acquiredFrom}
                      onChange={(e) => setWeaponForm((prev) => ({ ...prev, acquiredFrom: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Czy użyta w przestępstwie</label>
                    <select
                      className="input"
                      value={weaponForm.crimeInvolvement}
                      onChange={(e) =>
                        setWeaponForm((prev) => ({ ...prev, crimeInvolvement: e.target.value as WeaponEntry["crimeInvolvement"] }))
                      }
                    >
                      <option value="tak">Tak</option>
                      <option value="nie">Nie</option>
                      <option value="brak informacji">Brak informacji</option>
                    </select>
                  </div>
                  <div>
                    <label className="label text-white">Data</label>
                    <input
                      className="input"
                      type="date"
                      value={weaponForm.date}
                      onChange={(e) => setWeaponForm((prev) => ({ ...prev, date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Godzina</label>
                    <input
                      className="input"
                      type="time"
                      value={weaponForm.time}
                      onChange={(e) => setWeaponForm((prev) => ({ ...prev, time: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Cena zakupu</label>
                    <input
                      className="input"
                      value={weaponForm.purchasePrice}
                      onChange={(e) => setWeaponForm((prev) => ({ ...prev, purchasePrice: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Wartość czarnorynkowa</label>
                    <input
                      className="input"
                      value={weaponForm.blackMarketValue}
                      onChange={(e) => setWeaponForm((prev) => ({ ...prev, blackMarketValue: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-3">
                  <button
                    className={`btn ${weaponForm.controlledTransaction ? "bg-orange-500 text-white" : "bg-white/30 text-white"}`}
                    onClick={() =>
                      setWeaponForm((prev) => ({ ...prev, controlledTransaction: !prev.controlledTransaction }))
                    }
                    type="button"
                  >
                    Transakcja kontrolowana
                  </button>
                  <input
                    ref={weaponFileInput}
                    type="file"
                    multiple
                    onChange={(e) => setWeaponFiles(Array.from(e.target.files || []))}
                  />
                </div>
                <button className="btn mt-3" onClick={addWeapon}>
                  Dodaj broń
                </button>
              </div>

              <div
                className="card p-4 text-white"
                style={{
                  background: entryBackground({ type: "drug", controlledTransaction: drugForm.controlledTransaction } as DrugEntry),
                }}
              >
                <h3 className="font-semibold flex items-center gap-2 text-lg">💊 Narkotyki</h3>
                <div className="grid md:grid-cols-2 gap-3 mt-3 text-black">
                  <div>
                    <label className="label text-white">Rodzaj narkotyku</label>
                    <input
                      className="input"
                      value={drugForm.drugType}
                      onChange={(e) => setDrugForm((prev) => ({ ...prev, drugType: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Ilość (g)</label>
                    <input
                      className="input"
                      value={drugForm.amountGrams}
                      onChange={(e) => setDrugForm((prev) => ({ ...prev, amountGrams: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Jakość</label>
                    <input
                      className="input"
                      value={drugForm.quality}
                      onChange={(e) => setDrugForm((prev) => ({ ...prev, quality: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Data</label>
                    <input
                      className="input"
                      type="date"
                      value={drugForm.date}
                      onChange={(e) => setDrugForm((prev) => ({ ...prev, date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Godzina</label>
                    <input
                      className="input"
                      type="time"
                      value={drugForm.time}
                      onChange={(e) => setDrugForm((prev) => ({ ...prev, time: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Miejsce</label>
                    <input
                      className="input"
                      value={drugForm.location}
                      onChange={(e) => setDrugForm((prev) => ({ ...prev, location: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Od kogo</label>
                    <input
                      className="input"
                      value={drugForm.acquiredFrom}
                      onChange={(e) => setDrugForm((prev) => ({ ...prev, acquiredFrom: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Cena zakupu</label>
                    <input
                      className="input"
                      value={drugForm.purchasePrice}
                      onChange={(e) => setDrugForm((prev) => ({ ...prev, purchasePrice: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Wartość czarnorynkowa</label>
                    <input
                      className="input"
                      value={drugForm.blackMarketValue}
                      onChange={(e) => setDrugForm((prev) => ({ ...prev, blackMarketValue: e.target.value }))}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="label text-white">Notatka</label>
                    <textarea
                      className="input h-20"
                      value={drugForm.note}
                      onChange={(e) => setDrugForm((prev) => ({ ...prev, note: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-3">
                  <button
                    className={`btn ${drugForm.controlledTransaction ? "bg-orange-500 text-white" : "bg-white/30 text-white"}`}
                    onClick={() => setDrugForm((prev) => ({ ...prev, controlledTransaction: !prev.controlledTransaction }))}
                    type="button"
                  >
                    Transakcja kontrolowana
                  </button>
                  <input
                    ref={drugFileInput}
                    type="file"
                    multiple
                    onChange={(e) => setDrugFiles(Array.from(e.target.files || []))}
                  />
                </div>
                <button className="btn mt-3" onClick={addDrug}>
                  Dodaj narkotyki
                </button>
              </div>

              <div
                className="card p-4 text-white"
                style={{
                  background: entryBackground({ type: "explosive", controlledTransaction: explosiveForm.controlledTransaction } as ExplosiveEntry),
                }}
              >
                <h3 className="font-semibold flex items-center gap-2 text-lg">💣 Materiały wybuchowe</h3>
                <div className="grid md:grid-cols-2 gap-3 mt-3 text-black">
                  <div>
                    <label className="label text-white">Rodzaj materiału</label>
                    <input
                      className="input"
                      value={explosiveForm.materialType}
                      onChange={(e) => setExplosiveForm((prev) => ({ ...prev, materialType: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Ilość</label>
                    <input
                      className="input"
                      value={explosiveForm.amount}
                      onChange={(e) => setExplosiveForm((prev) => ({ ...prev, amount: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Data</label>
                    <input
                      className="input"
                      type="date"
                      value={explosiveForm.date}
                      onChange={(e) => setExplosiveForm((prev) => ({ ...prev, date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Godzina</label>
                    <input
                      className="input"
                      type="time"
                      value={explosiveForm.time}
                      onChange={(e) => setExplosiveForm((prev) => ({ ...prev, time: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Miejsce</label>
                    <input
                      className="input"
                      value={explosiveForm.location}
                      onChange={(e) => setExplosiveForm((prev) => ({ ...prev, location: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Od kogo</label>
                    <input
                      className="input"
                      value={explosiveForm.acquiredFrom}
                      onChange={(e) => setExplosiveForm((prev) => ({ ...prev, acquiredFrom: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Cena zakupu</label>
                    <input
                      className="input"
                      value={explosiveForm.purchasePrice}
                      onChange={(e) => setExplosiveForm((prev) => ({ ...prev, purchasePrice: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label text-white">Wartość czarnorynkowa</label>
                    <input
                      className="input"
                      value={explosiveForm.blackMarketValue}
                      onChange={(e) => setExplosiveForm((prev) => ({ ...prev, blackMarketValue: e.target.value }))}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="label text-white">Notatka</label>
                    <textarea
                      className="input h-20"
                      value={explosiveForm.note}
                      onChange={(e) => setExplosiveForm((prev) => ({ ...prev, note: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-3">
                  <button
                    className={`btn ${
                      explosiveForm.controlledTransaction ? "bg-orange-500 text-white" : "bg-white/30 text-white"
                    }`}
                    onClick={() =>
                      setExplosiveForm((prev) => ({ ...prev, controlledTransaction: !prev.controlledTransaction }))
                    }
                    type="button"
                  >
                    Transakcja kontrolowana
                  </button>
                  <input
                    ref={explosiveFileInput}
                    type="file"
                    multiple
                    onChange={(e) => setExplosiveFiles(Array.from(e.target.files || []))}
                  />
                </div>
                <button className="btn mt-3" onClick={addExplosive}>
                  Dodaj materiał wybuchowy
                </button>
              </div>
            </div>
          </div>


          <div className="grid gap-4">
            {entries.map((entry) => {
              const meta = ENTRY_META[entry.type];
              return (
                <div
                  key={entry.id}
                  className="card p-5 text-white"
                  style={{
                    background: entryBackground(entry),
                    borderColor: entryBorder(entry),
                    boxShadow: `0 20px 40px -25px ${entryBorder(entry)}`,
                  }}
                >
                  <div className="flex flex-wrap items-center gap-3 mb-3 text-xs uppercase tracking-widest opacity-80">
                    <span>{meta?.icon} {meta?.label}</span>
                    {entry.controlledTransaction && (
                      <span className="px-2 py-1 rounded bg-black/30 border border-white/20">Transakcja kontrolowana</span>
                    )}
                  </div>
                  <div className="text-sm opacity-80 mb-2">
                    {formatDate(entry.createdAt)} • {entry.author || entry.authorUid || ""}
                  </div>
                  {entry.type === "note" && entry.text && (
                    <p className="whitespace-pre-wrap text-sm mb-3">{entry.text}</p>
                  )}
                  {entry.type === "weapon" && (
                    <div className="grid md:grid-cols-2 gap-x-6 gap-y-1 text-sm mb-3">
                      <div><strong>Model:</strong> {(entry as WeaponEntry).weaponModel}</div>
                      <div><strong>Numery seryjne:</strong> {(entry as WeaponEntry).serialNumbers}</div>
                      {(entry as WeaponEntry).acquiredFrom && (
                        <div><strong>Pozyskano od:</strong> {(entry as WeaponEntry).acquiredFrom}</div>
                      )}
                      {(entry as WeaponEntry).crimeInvolvement && (
                        <div><strong>Użyta w przestępstwie:</strong> {(entry as WeaponEntry).crimeInvolvement}</div>
                      )}
                      {(entry as WeaponEntry).date && <div><strong>Data:</strong> {(entry as WeaponEntry).date}</div>}
                      {(entry as WeaponEntry).time && <div><strong>Godzina:</strong> {(entry as WeaponEntry).time}</div>}
                      {(entry as WeaponEntry).purchasePrice && (
                        <div><strong>Cena zakupu:</strong> {(entry as WeaponEntry).purchasePrice}</div>
                      )}
                      {(entry as WeaponEntry).blackMarketValue && (
                        <div><strong>Czarny rynek:</strong> {(entry as WeaponEntry).blackMarketValue}</div>
                      )}
                    </div>
                  )}
                  {entry.type === "drug" && (
                    <div className="grid md:grid-cols-2 gap-x-6 gap-y-1 text-sm mb-3">
                      <div><strong>Rodzaj:</strong> {(entry as DrugEntry).drugType}</div>
                      <div><strong>Ilość:</strong> {(entry as DrugEntry).amountGrams} g</div>
                      {(entry as DrugEntry).quality && <div><strong>Jakość:</strong> {(entry as DrugEntry).quality}</div>}
                      {(entry as DrugEntry).location && <div><strong>Miejsce:</strong> {(entry as DrugEntry).location}</div>}
                      {(entry as DrugEntry).acquiredFrom && (
                        <div><strong>Pozyskano od:</strong> {(entry as DrugEntry).acquiredFrom}</div>
                      )}
                      {(entry as DrugEntry).date && <div><strong>Data:</strong> {(entry as DrugEntry).date}</div>}
                      {(entry as DrugEntry).time && <div><strong>Godzina:</strong> {(entry as DrugEntry).time}</div>}
                      {(entry as DrugEntry).purchasePrice && (
                        <div><strong>Cena zakupu:</strong> {(entry as DrugEntry).purchasePrice}</div>
                      )}
                      {(entry as DrugEntry).blackMarketValue && (
                        <div><strong>Czarny rynek:</strong> {(entry as DrugEntry).blackMarketValue}</div>
                      )}
                      {(entry as DrugEntry).note && (
                        <div className="md:col-span-2 whitespace-pre-wrap"><strong>Notatka:</strong> {(entry as DrugEntry).note}</div>
                      )}
                    </div>
                  )}
                  {entry.type === "explosive" && (
                    <div className="grid md:grid-cols-2 gap-x-6 gap-y-1 text-sm mb-3">
                      <div><strong>Rodzaj:</strong> {(entry as ExplosiveEntry).materialType}</div>
                      {(entry as ExplosiveEntry).amount && <div><strong>Ilość:</strong> {(entry as ExplosiveEntry).amount}</div>}
                      {(entry as ExplosiveEntry).location && <div><strong>Miejsce:</strong> {(entry as ExplosiveEntry).location}</div>}
                      {(entry as ExplosiveEntry).acquiredFrom && (
                        <div><strong>Pozyskano od:</strong> {(entry as ExplosiveEntry).acquiredFrom}</div>
                      )}
                      {(entry as ExplosiveEntry).date && <div><strong>Data:</strong> {(entry as ExplosiveEntry).date}</div>}
                      {(entry as ExplosiveEntry).time && <div><strong>Godzina:</strong> {(entry as ExplosiveEntry).time}</div>}
                      {(entry as ExplosiveEntry).purchasePrice && (
                        <div><strong>Cena zakupu:</strong> {(entry as ExplosiveEntry).purchasePrice}</div>
                      )}
                      {(entry as ExplosiveEntry).blackMarketValue && (
                        <div><strong>Czarny rynek:</strong> {(entry as ExplosiveEntry).blackMarketValue}</div>
                      )}
                      {(entry as ExplosiveEntry).note && (
                        <div className="md:col-span-2 whitespace-pre-wrap"><strong>Notatka:</strong> {(entry as ExplosiveEntry).note}</div>
                      )}
                    </div>
                  )}
                  {entry.attachments && entry.attachments.length > 0 && (
                    <div className="grid gap-3 mt-3">
                      {entry.attachments.map((att, index) => renderAttachment(entry, att, index))}
                    </div>
                  )}
                  {canManageEntries(entry) && (
                    <div className="mt-4 flex gap-2">
                      <button className="btn bg-red-800 text-white" onClick={() => deleteEntry(entry)}>
                        Usuń wpis
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {entries.length === 0 && (
              <div className="card p-4 bg-white/70 text-beige-800">Brak wpisów operacyjnych.</div>
            )}
          </div>
        </div>
      </>
    </AuthGate>
  );
}
