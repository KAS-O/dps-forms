import { useAnnouncement } from "@/hooks/useAnnouncement";

const DURATION_LABELS: Record<string, string> = {
  "30m": "30 minut",
  "1h": "1 godzina",
  "3h": "3 godziny",
  "5h": "5 godzin",
  "8h": "8 godzin",
  "12h": "12 godzin",
  "24h": "24 godziny",
  "2d": "2 dni",
  "3d": "3 dni",
  "7d": "Tydzień",
  forever: "Do czasu usunięcia",
};

export default function AnnouncementSpotlight() {
  const { announcement } = useAnnouncement();

  if (!announcement) return null;

  const expiresAtLabel = announcement.expiresAtDate
    ? `Wygasa: ${announcement.expiresAtDate.toLocaleString()}`
    : "Wygasa: do czasu usunięcia";

  return (
    <aside className="card relative overflow-hidden bg-gradient-to-br from-purple-700/90 via-fuchsia-600/80 to-indigo-700/90 text-white shadow-[0_0_35px_rgba(168,85,247,0.35)]">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.25),_rgba(17,24,39,0)_65%)]" />
      <div className="relative p-5 grid gap-3">
        <span className="text-xs uppercase tracking-[0.3em] text-white/70">Ogłoszenie</span>
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-white/90">
          {announcement.message}
        </p>
        <div className="text-xs text-white/60 flex flex-wrap gap-2">
          {announcement.duration && (
            <span>
              Czas: {DURATION_LABELS[announcement.duration] || announcement.duration}
            </span>
          )}
          <span>{expiresAtLabel}</span>
        </div>
      </div>
    </aside>
  );
}
