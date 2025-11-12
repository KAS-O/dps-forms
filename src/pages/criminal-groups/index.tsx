import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { useSessionActivity } from "@/components/ActivityLogger";
import { useCriminalGroups, withAlpha } from "@/hooks/useCriminalGroups";

export default function CriminalGroupsPage() {
  const { groups, loading, error } = useCriminalGroups();
  const { session, logActivity } = useSessionActivity();

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Grupy przestępcze</title>
        </Head>
        <Nav />
        <div className="max-w-6xl mx-auto px-4 py-6 grid gap-6">
          <div className="card p-6 space-y-5" data-section="criminal-groups">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <span className="section-chip">
                  <span className="section-chip__dot" style={{ background: "#ec4899" }} />
                  Grupy przestępcze
                </span>
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight">Rejestr organizacji przestępczych</h1>
                  <p className="text-sm text-beige-100/75">
                    Podgląd najgroźniejszych grup działających na terenie miasta. Każda karta zawiera kolorystykę,
                    zakres działań i informacje operacyjne.
                  </p>
                </div>
              </div>
              <div className="hidden md:flex items-center gap-3">
                <span className="section-chip">
                  <span className="section-chip__dot" style={{ background: "#38bdf8" }} />
                  Wydział Kryminalny
                </span>
              </div>
            </div>
            {error && <div className="card p-3 bg-red-50 text-red-700">{error}</div>}
            {loading ? (
              <p>Ładowanie...</p>
            ) : groups.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {groups.map((group) => {
                  const color = group.group?.colorHex || "#7c3aed";
                  const glow = withAlpha(color, 0.28);
                  return (
                    <a
                      key={group.id}
                      href={`/criminal-groups/${group.id}`}
                      className="card p-5 transition hover:-translate-y-1"
                      data-section="criminal-groups"
                      style={{
                        borderColor: withAlpha(color, 0.55),
                        boxShadow: `0 26px 60px -30px ${withAlpha(color, 0.7)}`,
                        background: `linear-gradient(135deg, ${withAlpha(color, 0.4)}, rgba(10, 16, 34, 0.95))`,
                      }}
                      onClick={() => {
                        if (!session) return;
                        void logActivity({ type: "criminal_group_open", dossierId: group.id });
                      }}
                    >
                      <span
                        className="absolute inset-0 opacity-60 animate-pulse-soft"
                        style={{
                          background: `radial-gradient(circle at 20% 20%, ${glow}, transparent 55%)`,
                        }}
                      />
                      <div className="relative flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <span className="text-3xl animate-bounce-slow" aria-hidden>
                              🐍
                            </span>
                            <div>
                              <h2 className="text-xl font-semibold text-white tracking-tight">
                                {group.group?.name || group.title}
                              </h2>
                              <p className="text-xs uppercase tracking-[0.3em] text-white/70">
                                Kolorystyka: {group.group?.colorName || "—"}
                              </p>
                            </div>
                          </div>
                          <span className="section-chip hidden sm:inline-flex" style={{ borderColor: `${color}aa` }}>
                            <span className="section-chip__dot" style={{ background: color }} />
                            Profil
                          </span>
                        </div>
                        <div className="grid gap-2 text-sm text-white/85">
                          <div className="flex items-center gap-2">
                            <span aria-hidden>🏷️</span>
                            <span>Rodzaj organizacji: {group.group?.organizationType || "—"}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span aria-hidden>📍</span>
                            <span>Baza: {group.group?.base || "—"}</span>
                          </div>
                          {group.group?.operations ? (
                            <div className="flex items-start gap-2 text-sm text-white/85">
                              <span aria-hidden>⚔️</span>
                              <span className="leading-relaxed">
                                Zakres działalności: {group.group.operations}
                              </span>
                            </div>
                          ) : null}
                        </div>
                        <span className="relative inline-flex items-center justify-center mt-2 w-max px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-[0.4em] bg-white/15 text-white/90">
                          Otwórz kartę organizacji
                        </span>
                      </div>
                    </a>
                  );
                })}
              </div>
            ) : (
              <p>Brak zapisanych grup przestępczych.</p>
            )}
          </div>
        </div>
      </>
    </AuthGate>
  );
}
