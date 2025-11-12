import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useProfile } from "@/hooks/useProfile";
import { useDialog } from "@/components/DialogProvider";
import { auth, db, storage } from "@/lib/firebase";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes, deleteObject } from "firebase/storage";
import { getInternalUnitOption } from "@/lib/hr";
import { UNIT_SECTIONS, unitHasAccess } from "@/lib/internalUnits";
import { ROLE_LABELS, ROLE_GROUP_LABELS, getRoleGroup, hasBoardAccess } from "@/lib/roles";

const MAX_PHOTO_SIZE = 5 * 1024 * 1024; // 5 MB

function getInitials(name: string | null | undefined): string {
  if (!name) return "";
  const parts = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) return "";
  return parts
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function formatBadge(badge: string | null): string {
  if (!badge) return "—";
  const trimmed = badge.trim();
  return trimmed ? `#${trimmed}` : "—";
}

export default function PanelSidebar() {
  const { role, login, fullName, badgeNumber, units, additionalRanks, photoURL, uid, ready } = useProfile();
  const router = useRouter();
  const { alert, prompt } = useDialog();
  const [uploading, setUploading] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false);
  const [ticketSaving, setTicketSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const roleLabel = role ? ROLE_LABELS[role] || role : "";
  const roleGroup = getRoleGroup(role);
  const roleGroupLabel = ROLE_GROUP_LABELS[roleGroup];

  const unitOptions = useMemo(
    () =>
      units
        .map((value) => getInternalUnitOption(value))
        .filter((option): option is NonNullable<ReturnType<typeof getInternalUnitOption>> => !!option),
    [units]
  );

  const visibleUnitSections = useMemo(() => {
    if (hasBoardAccess(role)) {
      return UNIT_SECTIONS;
    }
    return UNIT_SECTIONS.filter((section) => unitHasAccess(section.unit, additionalRanks));
  }, [role, additionalRanks]);

  const initials = getInitials(fullName || login);

  const triggerFileDialog = () => {
    if (uploading) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async () => {
    const input = fileInputRef.current;
    const file = input?.files?.[0];
    if (!file) return;
    if (!uid) {
      await alert({
        title: "Brak konta",
        message: "Nie udało się zidentyfikować użytkownika.",
        tone: "danger",
      });
      return;
    }
    if (!storage) {
      await alert({
        title: "Brak konfiguracji",
        message: "Przechowywanie zdjęć nie jest skonfigurowane.",
        tone: "danger",
      });
      return;
    }
    if (file.size > MAX_PHOTO_SIZE) {
      await alert({
        title: "Zbyt duży plik",
        message: "Maksymalny rozmiar zdjęcia profilowego to 5 MB.",
        tone: "info",
      });
      return;
    }

    try {
      setUploading(true);
      const user = auth.currentUser;
      if (!user) {
        throw new Error("Brak zalogowanego użytkownika.");
      }
      const storageRef = ref(storage, `profile-photos/${uid}`);
      await uploadBytes(storageRef, file, { contentType: file.type || "image/jpeg" });
      const url = await getDownloadURL(storageRef);
      await setDoc(
        doc(db, "profiles", uid),
        {
          photoURL: url,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error: any) {
      console.error(error);
      await alert({
        title: "Nie udało się zapisać zdjęcia",
        message: error?.message || "Wystąpił błąd podczas aktualizacji zdjęcia profilowego.",
        tone: "danger",
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setUploading(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!photoURL || !uid) return;
    if (!storage) {
      await alert({
        title: "Brak konfiguracji",
        message: "Przechowywanie zdjęć nie jest skonfigurowane.",
        tone: "danger",
      });
      return;
    }
    try {
      setRemovingPhoto(true);
      const ok = await prompt({
        title: "Usuń zdjęcie",
        message: "Wpisz TAK aby potwierdzić usunięcie zdjęcia profilowego.",
        inputLabel: "Potwierdzenie",
        placeholder: "TAK",
      });
      if (ok == null || ok.trim().toLowerCase() !== "tak") {
        return;
      }
      const storageRef = ref(storage, `profile-photos/${uid}`);
      await deleteObject(storageRef).catch(() => Promise.resolve());
      await setDoc(
        doc(db, "profiles", uid),
        {
          photoURL: null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error: any) {
      console.error(error);
      await alert({
        title: "Nie udało się usunąć zdjęcia",
        message: error?.message || "Wystąpił błąd podczas usuwania zdjęcia profilowego.",
        tone: "danger",
      });
    } finally {
      setRemovingPhoto(false);
    }
  };

  const openTicketForm = async () => {
    if (ticketSaving) return;
    const message = await prompt({
      title: "Nowy ticket",
      message: "Opisz zgłoszenie dla zarządu.",
      multiline: true,
      inputLabel: "Treść ticketa",
      placeholder: "Opisz dokładnie sprawę...",
    });
    if (message == null) {
      return;
    }
    const trimmed = message.trim();
    if (!trimmed) {
      await alert({
        title: "Brak treści",
        message: "Treść ticketa nie może być pusta.",
        tone: "info",
      });
      return;
    }

    try {
      setTicketSaving(true);
      const user = auth.currentUser;
      if (!user) {
        throw new Error("Brak zalogowanego użytkownika.");
      }
      const token = await user.getIdToken();
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Nie udało się wysłać ticketa.");
      }
      await alert({
        title: "Wysłano ticket",
        message: "Twoje zgłoszenie trafiło do zarządu.",
        tone: "info",
      });
    } catch (error: any) {
      console.error(error);
      await alert({
        title: "Błąd ticketa",
        message: error?.message || "Nie udało się utworzyć ticketa.",
        tone: "danger",
      });
    } finally {
      setTicketSaving(false);
    }
  };

  const renderUnitLinks = () => {
    if (!visibleUnitSections.length) {
      return <p className="text-sm text-white/60">Brak przypisanych jednostek.</p>;
    }
    return (
      <div className="flex flex-col gap-2">
        {visibleUnitSections.map((section) => {
          const active = router.asPath === section.href || router.asPath.startsWith(`${section.href}/`);
          return (
            <Link
              key={section.href}
              href={section.href}
              className={`group flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition ${
                active
                  ? "border-white/40 bg-white/15 text-white shadow-[0_12px_24px_-18px_rgba(255,255,255,0.6)]"
                  : "border-white/10 bg-white/5 text-white/80 hover:border-white/20 hover:bg-white/10"
              }`}
            >
              <span className="flex items-center gap-3">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: section.navColor }}
                  aria-hidden
                />
                {section.label}
              </span>
              <span className="text-xs text-white/50">Przejdź</span>
            </Link>
          );
        })}
      </div>
    );
  };

  return (
    <aside className="w-full space-y-6 lg:w-80 xl:w-96">
      <div className="card space-y-5 p-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="relative h-28 w-28 overflow-hidden rounded-full border border-white/10 bg-white/10 shadow-inner">
            {photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoURL} alt={fullName || login || "Profil"} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-500/40 to-sky-500/30 text-2xl font-semibold text-white">
                {initials || "?"}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
          <div className="space-y-1">
            <p className="text-lg font-semibold text-white/90">{fullName || login || "Nieznany"}</p>
            <p className="text-sm text-white/60">{roleLabel || "Brak stopnia"}</p>
            <p className="text-xs uppercase tracking-[0.2em] text-white/50">{roleGroupLabel}</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-white/70">
            <span className="rounded-full bg-white/10 px-3 py-1">{login || "—"}</span>
            <span className="rounded-full bg-white/10 px-3 py-1">{formatBadge(badgeNumber)}</span>
          </div>
          <div className="flex flex-wrap justify-center gap-2 text-xs">
            <button
              type="button"
              onClick={triggerFileDialog}
              className="btn btn--small btn--ghost"
              disabled={uploading}
            >
              {uploading ? "Zapisywanie..." : photoURL ? "Zmień zdjęcie" : "Dodaj zdjęcie"}
            </button>
            {photoURL && (
              <button
                type="button"
                className="btn btn--small bg-red-600/80 text-white hover:bg-red-600"
                onClick={handleRemovePhoto}
                disabled={removingPhoto}
              >
                {removingPhoto ? "Usuwanie..." : "Usuń zdjęcie"}
              </button>
            )}
          </div>
        </div>
        {unitOptions.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-white/80">Jednostki</h3>
            <div className="flex flex-wrap gap-2">
              {unitOptions.map((option) => (
                <span
                  key={option.value}
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold shadow-sm"
                  style={{
                    background: option.background,
                    color: option.color,
                    borderColor: option.borderColor,
                  }}
                >
                  {option.shortLabel || option.abbreviation}
                </span>
              ))}
            </div>
          </div>
        )}
        <button
          type="button"
          className="btn w-full bg-sky-600 text-sm font-semibold text-white hover:bg-sky-500"
          onClick={openTicketForm}
          disabled={ticketSaving}
        >
          {ticketSaving ? "Wysyłanie ticketa..." : "Otwórz ticket"}
        </button>
      </div>

      <div className="card space-y-4 p-6">
        <div>
          <h3 className="text-base font-semibold text-white/90">Sekcje jednostek</h3>
          <p className="text-xs text-white/60">Lista jednostek dostępnych w panelu.</p>
        </div>
        {ready ? renderUnitLinks() : <p className="text-sm text-white/60">Ładowanie danych...</p>}
      </div>
    </aside>
  );
}
