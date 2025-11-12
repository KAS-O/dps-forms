import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { getAdditionalRankOption, getInternalUnitOption, type AdditionalRank } from "@/lib/hr";
import { UNIT_SECTIONS, unitHasAccess } from "@/lib/internalUnits";
import { useProfile } from "@/hooks/useProfile";
import { ROLE_LABELS, getRoleGroupLabel } from "@/lib/roles";
import { useDialog } from "@/components/DialogProvider";
import { auth, db, storage } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteField,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";

type UploadState = "idle" | "saving" | "removing";

function getStorageInstance(): FirebaseStorage | null {
  const instance = storage as unknown as FirebaseStorage | null;
  if (instance && typeof (instance as any).app !== "undefined") {
    return instance;
  }
  return null;
}

function formatInitials(fullName?: string | null, login?: string | null): string {
  const source = fullName && fullName.trim().length > 0 ? fullName : login || "";
  if (!source) return "?";
  const parts = source
    .replace(/[^a-ząćęłńóśźż0-9\s]/gi, " ")
    .split(" ")
    .filter(Boolean);
  if (parts.length === 0) {
    return source.slice(0, 2).toUpperCase();
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function resolveRankLabels(ranks: AdditionalRank[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  ranks.forEach((rank) => {
    const label = getAdditionalRankOption(rank)?.label;
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  });
  return labels;
}

export default function UnitSidebar() {
  const { role, login, fullName, badgeNumber, units, additionalRanks, photoURL, photoPath, ready } = useProfile();
  const router = useRouter();
  const { prompt, alert, confirm } = useDialog();
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [ticketSaving, setTicketSaving] = useState(false);

  useEffect(() => {
    document.body.classList.add("has-unit-sidebar");
    return () => {
      document.body.classList.remove("has-unit-sidebar");
    };
  }, []);

  const accessibleSections = useMemo(() => {
    return UNIT_SECTIONS.filter((section) => unitHasAccess(section.unit, additionalRanks, role)).sort((a, b) =>
      a.label.localeCompare(b.label, "pl", { sensitivity: "base" })
    );
  }, [additionalRanks, role]);

  const membershipUnits = useMemo(
    () =>
      units
        .map((value) => getInternalUnitOption(value))
        .filter((option): option is NonNullable<ReturnType<typeof getInternalUnitOption>> => !!option),
    [units]
  );

  const highestRanks = useMemo(() => {
    if (!additionalRanks.length) return [] as string[];
    return resolveRankLabels(additionalRanks);
  }, [additionalRanks]);

  const roleLabel = role ? ROLE_LABELS[role] || role : "—";
  const groupLabel = getRoleGroupLabel(role);

  const currentPath = router.asPath;

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const user = auth.currentUser;
    if (!user) {
      await alert({ tone: "danger", title: "Brak sesji", message: "Nie można zapisać zdjęcia — spróbuj ponownie." });
      return;
    }
    const storageInstance = getStorageInstance();
    if (!storageInstance) {
      await alert({ tone: "danger", title: "Brak konfiguracji", message: "Usługa przechowywania nie jest dostępna." });
      return;
    }

    setUploadState("saving");
    try {
      const normalizedName = file.name.toLowerCase();
      const extension = normalizedName.includes(".") ? normalizedName.split(".").pop() : "jpg";
      const objectPath = `profiles/${user.uid}/avatar_${Date.now()}.${extension}`;
      const objectRef = ref(storageInstance, objectPath);
      await uploadBytes(objectRef, file, { contentType: file.type || "image/jpeg" });
      const url = await getDownloadURL(objectRef);

      if (photoPath) {
        try {
          const previousRef = ref(storageInstance, photoPath);
          await deleteObject(previousRef);
        } catch (error) {
          console.warn("Nie udało się usunąć poprzedniego zdjęcia profilowego", error);
        }
      }

      await updateDoc(doc(db, "profiles", user.uid), {
        photoURL: url,
        photoPath: objectPath,
        updatedAt: serverTimestamp(),
      });

      await alert({ tone: "info", title: "Zapisano zdjęcie", message: "Zdjęcie profilowe zostało zaktualizowane." });
    } catch (error: any) {
      console.error("Nie udało się przesłać zdjęcia profilowego", error);
      await alert({
        tone: "danger",
        title: "Błąd przesyłania",
        message: error?.message || "Nie udało się zapisać zdjęcia profilowego.",
      });
    } finally {
      setUploadState("idle");
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
      await alert({ tone: "danger", title: "Brak sesji", message: "Nie można usunąć zdjęcia w tej chwili." });
      return;
    }
    const storageInstance = getStorageInstance();
    if (!storageInstance) {
      await alert({ tone: "danger", title: "Brak konfiguracji", message: "Usługa przechowywania nie jest dostępna." });
      return;
    }

    setUploadState("removing");
    try {
      if (photoPath) {
        try {
          await deleteObject(ref(storageInstance, photoPath));
        } catch (error) {
          console.warn("Nie udało się usunąć pliku zdjęcia", error);
        }
      }

      await updateDoc(doc(db, "profiles", user.uid), {
        photoURL: deleteField(),
        photoPath: deleteField(),
        updatedAt: serverTimestamp(),
      });

      await alert({ tone: "info", title: "Usunięto zdjęcie", message: "Zdjęcie profilowe zostało usunięte." });
    } catch (error: any) {
      console.error("Nie udało się usunąć zdjęcia profilowego", error);
      await alert({
        tone: "danger",
        title: "Błąd",
        message: error?.message || "Nie udało się usunąć zdjęcia profilowego.",
      });
    } finally {
      setUploadState("idle");
    }
  };

  const handleCreateTicket = async () => {
    const content = await prompt({
      title: "Nowy ticket do zarządu",
      message: "Opisz zgłoszenie, które ma trafić do zarządu.",
      confirmLabel: "Wyślij",
      cancelLabel: "Anuluj",
      multiline: true,
      inputLabel: "Treść zgłoszenia",
      placeholder: "Wpisz szczegóły sprawy...",
    });
    if (content == null) return;
    const message = content.trim();
    if (!message) {
      await alert({ tone: "danger", title: "Puste zgłoszenie", message: "Wprowadź treść ticketa przed wysłaniem." });
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      await alert({ tone: "danger", title: "Brak sesji", message: "Nie można wysłać ticketa — zaloguj się ponownie." });
      return;
    }

    setTicketSaving(true);
    try {
      const payload: Record<string, unknown> = {
        message,
        createdAt: serverTimestamp(),
        authorUid: user.uid,
        authorLogin: login || null,
        authorFullName: fullName || null,
        authorBadgeNumber: badgeNumber || null,
        authorRole: role || null,
        authorRoleLabel: role ? ROLE_LABELS[role] || role : null,
        authorRoleGroup: groupLabel || null,
        authorUnits: units || [],
        authorRanks: additionalRanks || [],
      };

      await addDoc(collection(db, "tickets"), payload);
      await alert({
        tone: "info",
        title: "Ticket wysłany",
        message: "Twoje zgłoszenie zostało przekazane do zarządu.",
      });
    } catch (error: any) {
      console.error("Nie udało się utworzyć ticketa", error);
      await alert({
        tone: "danger",
        title: "Błąd",
        message: error?.message || "Nie udało się wysłać ticketa.",
      });
    } finally {
      setTicketSaving(false);
    }
  };

  if (!ready) {
    return null;
  }

  const widthClass = "w-[clamp(240px,18vw,300px)]";

  return (
    <aside
      className={`hidden lg:flex fixed left-0 top-0 h-full ${widthClass} flex-col gap-6 overflow-hidden px-5 pb-8 pt-24`}
      aria-label="Panel funkcjonariusza"
    >
      <div className="rounded-3xl border border-white/10 bg-[var(--card)]/90 p-5 shadow-[0_24px_48px_-24px_rgba(59,130,246,0.5)] backdrop-blur">
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-4">
            <div className="flex flex-col items-center gap-3">
              {photoURL ? (
                <img
                  src={photoURL}
                  alt={fullName || login || "Profil"}
                  className="h-20 w-20 rounded-2xl object-cover shadow-lg"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/10 text-xl font-bold text-white/80 shadow-lg">
                  {formatInitials(fullName, login)}
                </div>
              )}
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-white/80 transition hover:bg-white/20">
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                {uploadState === "saving" ? "Zapisywanie..." : "Zmień zdjęcie"}
              </label>
            </div>

            <div className="flex flex-1 flex-col gap-3 text-left text-sm text-white/80">
              <div className="space-y-1">
                <p className="text-lg font-semibold text-white">{fullName || login || "Nieznany funkcjonariusz"}</p>
                <p className="text-xs uppercase tracking-wide text-white/60">{groupLabel || "Brak grupy"}</p>
                <p className="text-xs text-white/60">Login: {login || "—"}</p>
                <p className="text-xs text-white/60">Stopień: {roleLabel}</p>
                <p className="text-xs text-white/60">Numer odznaki: {badgeNumber ? `#${badgeNumber}` : "Brak"}</p>
                {highestRanks.length > 0 && (
                  <p className="text-xs text-white/60">Dodatkowe rangi: {highestRanks.join(", ")}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {membershipUnits.length > 0 ? (
                  membershipUnits.map((unit) => (
                    <span
                      key={unit.value}
                      className="rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
                      style={{
                        background: unit.background,
                        color: unit.color,
                        borderColor: unit.borderColor,
                      }}
                    >
                      {unit.shortLabel || unit.abbreviation}
                    </span>
                  ))
                ) : (
                  <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-wide text-white/60">
                    Brak przypisania do jednostki
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 text-left">
            <button
              type="button"
              onClick={handleCreateTicket}
              className="btn w-full justify-center"
              disabled={ticketSaving}
            >
              {ticketSaving ? "Wysyłanie..." : "Otwórz ticket"}
            </button>
            {photoURL && (
              <button
                type="button"
                onClick={handleRemovePhoto}
                className="rounded-full border border-white/15 bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-white/75 transition hover:bg-white/20"
                disabled={uploadState === "removing"}
              >
                {uploadState === "removing" ? "Usuwanie..." : "Usuń zdjęcie"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-[var(--card)]/85 p-5 shadow-[0_20px_40px_-24px_rgba(34,197,94,0.4)] backdrop-blur">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-white/70">Sekcje jednostek</h2>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-white/60">
            {accessibleSections.length}
          </span>
        </div>
        <p className="mt-2 text-xs text-white/50">
          Dostępne sekcje specjalistyczne. Kliknij, aby przejść do panelu danej jednostki.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          {accessibleSections.length > 0 ? (
            accessibleSections.map((section) => {
              const isActive = currentPath === section.href || currentPath.startsWith(`${section.href}/`);
              return (
                <Link
                  key={section.href}
                  href={section.href}
                  className={`group relative overflow-hidden rounded-2xl border border-white/10 p-4 transition-all ${
                    isActive ? "border-white/40 shadow-[0_16px_32px_-24px_rgba(59,130,246,0.7)]" : "hover:-translate-y-1"
                  }`}
                  style={{
                    background: `linear-gradient(135deg, ${section.navColor}33, rgba(8,18,36,0.85))`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-semibold text-white"
                      style={{ background: section.navColor }}
                    >
                      {section.shortLabel}
                    </span>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-white">{section.label}</span>
                      <span className="text-[11px] text-white/70">Szybki dostęp do zasobów jednostki</span>
                    </div>
                  </div>
                </Link>
              );
            })
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
              Brak dodatkowych sekcji jednostek do wyświetlenia.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
