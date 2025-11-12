/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { useRouter } from "next/router";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useProfile } from "@/hooks/useProfile";
import { UNIT_SECTIONS, unitHasAccess } from "@/lib/internalUnits";
import { getInternalUnitOption } from "@/lib/hr";
import { ROLE_LABELS, resolveRoleGroup, isHighCommandRole } from "@/lib/roles";
import { useDialog } from "@/components/DialogProvider";
import { auth, db, storage, serverTimestamp } from "@/lib/firebase";
import { addDoc, collection, doc, updateDoc } from "firebase/firestore";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace(/[^0-9a-fA-F]/g, "");
  const expand = (value: string) => (value.length === 1 ? value + value : value);
  if (normalized.length === 3) {
    const r = parseInt(expand(normalized[0]), 16);
    const g = parseInt(expand(normalized[1]), 16);
    const b = parseInt(expand(normalized[2]), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (normalized.length === 6) {
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return `rgba(59, 130, 246, ${alpha})`;
}

function formatField(label: string, value: string | null | undefined) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-white/50">{label}</span>
      <span className="font-semibold text-white/90">{value && value.trim() ? value : "—"}</span>
    </div>
  );
}

export default function CommandSidebar() {
  const {
    role,
    login,
    fullName,
    badgeNumber,
    units,
    additionalRanks,
    photoURL,
    ready,
  } = useProfile();
  const router = useRouter();
  const { prompt, alert, confirm } = useDialog();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [ticketSaving, setTicketSaving] = useState(false);

  const accessibleSections = useMemo(() => {
    if (isHighCommandRole(role)) {
      return UNIT_SECTIONS;
    }
    return UNIT_SECTIONS.filter((section) => unitHasAccess(section.unit, additionalRanks));
  }, [role, additionalRanks]);

  const unitOptions = useMemo(() => {
    return units
      .map((unit) => getInternalUnitOption(unit))
      .filter((option): option is NonNullable<ReturnType<typeof getInternalUnitOption>> => !!option);
  }, [units]);

  const group = resolveRoleGroup(role);
  const roleLabel = role ? ROLE_LABELS[role] || role : "—";

  const triggerUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      await alert({
        title: "Nieprawidłowy plik",
        message: "Możesz wgrać jedynie plik graficzny (JPG, PNG, WEBP).",
        tone: "danger",
      });
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      await alert({
        title: "Zbyt duży plik",
        message: "Zdjęcie profilowe może mieć maksymalnie 6 MB.",
        tone: "danger",
      });
      return;
    }
    const user = auth.currentUser;
    if (!user) {
      await alert({
        title: "Błąd",
        message: "Brak zalogowanego użytkownika.",
        tone: "danger",
      });
      return;
    }
    try {
      setUploading(true);
      const storageRef = ref(storage, `profiles/${user.uid}/avatar`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await updateDoc(doc(db, "profiles", user.uid), { photoURL: url });
      await alert({
        title: "Zapisano",
        message: "Zdjęcie profilowe zostało zaktualizowane.",
        tone: "info",
      });
    } catch (error: any) {
      console.error(error);
      await alert({
        title: "Błąd",
        message: error?.message || "Nie udało się zapisać zdjęcia profilowego.",
        tone: "danger",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!photoURL) return;
    const ok = await confirm({
      title: "Usuń zdjęcie",
      message: "Czy na pewno chcesz usunąć zdjęcie profilowe?",
      confirmLabel: "Usuń",
      tone: "danger",
    });
    if (!ok) return;
    const user = auth.currentUser;
    if (!user) {
      await alert({
        title: "Błąd",
        message: "Brak zalogowanego użytkownika.",
        tone: "danger",
      });
      return;
    }
    try {
      setUploading(true);
      const storageRef = ref(storage, `profiles/${user.uid}/avatar`);
      await deleteObject(storageRef).catch(() => undefined);
      await updateDoc(doc(db, "profiles", user.uid), { photoURL: null });
      await alert({
        title: "Usunięto",
        message: "Zdjęcie profilowe zostało usunięte.",
        tone: "info",
      });
    } catch (error: any) {
      console.error(error);
      await alert({
        title: "Błąd",
        message: error?.message || "Nie udało się usunąć zdjęcia profilowego.",
        tone: "danger",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleTicket = async () => {
    if (ticketSaving) return;
    const content = await prompt({
      title: "Nowy ticket",
      message: "Opisz zgłoszenie dla zarządu:",
      inputLabel: "Treść ticketa",
      placeholder: "Wpisz swoją wiadomość…",
      multiline: true,
    });
    if (content == null) return;
    const trimmed = content.trim();
    if (!trimmed) {
      await alert({
        title: "Pusta wiadomość",
        message: "Treść ticketa nie może być pusta.",
        tone: "danger",
      });
      return;
    }
    const user = auth.currentUser;
    if (!user) {
      await alert({
        title: "Błąd",
        message: "Brak zalogowanego użytkownika.",
        tone: "danger",
      });
      return;
    }
    try {
      setTicketSaving(true);
      const payload = {
        authorUid: user.uid,
        authorLogin: login || null,
        authorName: fullName || null,
        authorBadgeNumber: badgeNumber || null,
        authorRole: role || null,
        authorUnits: units || [],
        content: trimmed,
        status: "open",
        createdAt: serverTimestamp(),
      };
      await addDoc(collection(db, "tickets"), payload);
      await alert({
        title: "Wysłano",
        message: "Ticket został przekazany do zarządu.",
        tone: "info",
      });
    } catch (error: any) {
      console.error(error);
      await alert({
        title: "Błąd",
        message: error?.message || "Nie udało się wysłać ticketa.",
        tone: "danger",
      });
    } finally {
      setTicketSaving(false);
    }
  };

  const currentPath = router.asPath;

  const sidebarContent = (
    <div className="space-y-6">
      <div className="card p-6 space-y-5" data-section="account-overview">
        <div className="flex items-start gap-4">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/10">
            {photoURL ? (
              <img src={photoURL} alt={fullName || login || "Profil"} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-2xl">👮‍♂️</div>
            )}
          </div>
          <div className="flex-1 space-y-1">
            <div className="text-lg font-semibold text-white/90">{fullName || login || "Funkcjonariusz LSPD"}</div>
            <div className="text-sm text-white/60">{roleLabel}</div>
            {group && (
              <span
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
                style={{
                  background: withAlpha(group.accent, 0.18),
                  borderColor: withAlpha(group.accent, 0.45),
                  color: "#f8fafc",
                }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: group.accent }} aria-hidden />
                {group.title}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {formatField("Login", login)}
          {formatField("Imię i nazwisko", fullName)}
          {formatField("Numer odznaki", badgeNumber)}
          {formatField("Stopień", roleLabel)}
        </div>

        <div className="space-y-2">
          <div className="text-xs uppercase tracking-[0.3em] text-white/40">Jednostki</div>
          {unitOptions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {unitOptions.map((option) => (
                <span
                  key={option.value}
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold"
                  style={{
                    background: option.background,
                    color: option.color,
                    borderColor: option.borderColor,
                  }}
                >
                  {option.shortLabel || option.abbreviation || option.label}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-sm text-white/60">Brak przypisanych jednostek.</div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn h-10 px-4 text-xs font-semibold"
            onClick={triggerUpload}
            disabled={uploading}
          >
            {uploading ? "Zapisywanie…" : photoURL ? "Zmień zdjęcie" : "Dodaj zdjęcie"}
          </button>
          {photoURL && (
            <button
              type="button"
              className="btn h-10 px-4 text-xs font-semibold bg-red-600/80 hover:bg-red-600"
              onClick={handleRemovePhoto}
              disabled={uploading}
            >
              Usuń zdjęcie
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        <div className="pt-2">
          <button
            type="button"
            className="btn w-full justify-center bg-gradient-to-r from-sky-500/90 via-blue-500/90 to-indigo-500/90 text-sm font-semibold"
            onClick={handleTicket}
            disabled={ticketSaving}
          >
            {ticketSaving ? "Wysyłanie…" : "Otwórz ticket dla zarządu"}
          </button>
        </div>
      </div>

      <div className="card p-5 space-y-4" data-section="unit-navigation">
        <div>
          <h3 className="text-base font-semibold text-white/90">Panele jednostek</h3>
          <p className="text-xs text-white/60">
            Dostępne sekcje specjalistyczne. Jednostki High Command widzą wszystkie panele.
          </p>
        </div>
        {accessibleSections.length > 0 ? (
          <div className="grid gap-2">
            {accessibleSections.map((section) => {
              const isActive = currentPath === section.href || currentPath.startsWith(`${section.href}/`);
              return (
                <Link
                  key={section.href}
                  href={section.href}
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
                    isActive ? "bg-white/15 border-white/40 shadow-[0_16px_35px_rgba(15,23,42,0.35)]" : "bg-white/5 border-white/10 hover:border-white/30"
                  }`}
                  style={{
                    boxShadow: isActive ? `0 18px 36px -18px ${withAlpha(section.navColor, 0.8)}` : undefined,
                  }}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: section.navColor }} aria-hidden />
                  <div className="flex flex-col">
                    <span className="font-semibold text-white/90">{section.label}</span>
                    <span className="text-[11px] text-white/50">Panel jednostki</span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 px-4 py-3 text-sm text-white/60">
            Brak dodatkowych sekcji jednostek.
          </div>
        )}
      </div>
    </div>
  );

  if (!ready) {
    return (
      <aside className="w-full lg:w-80 flex-shrink-0">
        <div className="space-y-6 lg:sticky lg:top-28">
          <div className="card p-6 animate-pulse text-sm text-white/60">Ładowanie profilu…</div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-full lg:w-80 flex-shrink-0">
      <div className="space-y-6 lg:sticky lg:top-28">{sidebarContent}</div>
    </aside>
  );
}
