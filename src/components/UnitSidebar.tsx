import Link from "next/link";
import { useRouter } from "next/router";
import { useMemo, useState } from "react";
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

  const hasMembership = membershipUnits.length > 0;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-24 z-30 hidden lg:block">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 xl:flex-row xl:items-start">
        <section className="pointer-events-auto w-full flex-1 rounded-3xl border border-white/10 bg-[var(--card)]/85 p-6 shadow-[0_32px_60px_-32px_rgba(34,197,94,0.55)] backdrop-blur">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-white/50">Jednostki specjalistyczne</p>
                <h2 className="mt-1 text-2xl font-semibold text-white">Twoje sekcje</h2>
              </div>
              <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/70">
                {accessibleSections.length}
              </span>
            </div>
            {hasMembership ? (
              <div className="flex flex-wrap gap-2">
                {membershipUnits.map((unit) => (
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
                ))}
              </div>
            ) : (
              <p className="text-sm text-white/60">Nie posiadasz przypisania do żadnej jednostki.</p>
            )}
            <p className="text-xs text-white/55">
              Uzyskaj szybki dostęp do paneli swoich jednostek. Kliknij kafelek, aby otworzyć sekcję w nowej karcie panelu.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {accessibleSections.length > 0 ? (
                accessibleSections.map((section) => {
                  const isActive = currentPath === section.href || currentPath.startsWith(`${section.href}/`);
                  return (
                    <Link
                      key={section.href}
                      href={section.href}
                      className={`group relative overflow-hidden rounded-2xl border px-4 py-4 transition ${
                        isActive
                          ? "border-white/40 bg-white/15 shadow-[0_20px_42px_-28px_rgba(59,130,246,0.7)]"
                          : "border-white/10 bg-white/5 hover:-translate-y-1 hover:bg-white/10"
                      }`}
                    >
                      <span
                        className="absolute inset-0 opacity-40"
                        style={{ background: `linear-gradient(135deg, ${section.navColor}40, transparent)` }}
                        aria-hidden
                      />
                      <div className="relative flex items-center gap-3">
                        <span
                          className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-semibold text-white"
                          style={{ background: section.navColor }}
                        >
                          {section.shortLabel}
                        </span>
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-white">{section.label}</span>
                          <span className="text-[11px] text-white/70">Panel operacyjny jednostki</span>
                        </div>
                      </div>
                    </Link>
                  );
                })
              ) : (
                <div className="col-span-2 rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-white/55">
                  Brak dodatkowych sekcji jednostek do wyświetlenia.
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="pointer-events-auto w-full max-w-xl rounded-3xl border border-white/15 bg-[var(--card)]/92 p-6 shadow-[0_32px_60px_-32px_rgba(59,130,246,0.6)] backdrop-blur" aria-label="Informacje o koncie funkcjonariusza">
          <div className="flex flex-col gap-6">
            <div className="flex items-center gap-4">
              <div className="relative">
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
                <label className="absolute -bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-white/80 shadow-lg transition hover:bg-white/20">
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                  {uploadState === "saving" ? "Zapisywanie..." : "Zmień"}
                </label>
              </div>
              <div className="flex flex-1 flex-col gap-1 text-sm text-white/80">
                <p className="text-lg font-semibold text-white">{fullName || login || "Nieznany funkcjonariusz"}</p>
                <p className="text-xs uppercase tracking-[0.3em] text-white/60">{groupLabel || "Brak grupy"}</p>
                <p className="text-xs text-white/60">Login: {login || "—"}</p>
                <p className="text-xs text-white/60">Stopień: {roleLabel}</p>
                <p className="text-xs text-white/60">Numer odznaki: {badgeNumber ? `#${badgeNumber}` : "Brak"}</p>
                {highestRanks.length > 0 && (
                  <p className="text-xs text-white/60">Rangi jednostek: {highestRanks.join(", ")}</p>
                )}
              </div>
            </div>

            <div className="grid gap-2 text-sm text-white/70">
              <button
                type="button"
                onClick={handleCreateTicket}
                className="btn w-full justify-center"
                disabled={ticketSaving}
              >
                {ticketSaving ? "Wysyłanie..." : "Otwórz ticket do zarządu"}
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
        </aside>
      </div>
    </div>
  );
}
