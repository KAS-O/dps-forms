import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import Head from "next/head";
import { TEMPLATES } from "@/lib/templates";
import Link from "next/link";
import { useMemo, useState } from "react";

export default function Dashboard() {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    return TEMPLATES.filter(t =>
      t.name.toLowerCase().includes(q.toLowerCase()) ||
      t.slug.includes(q.toLowerCase())
    );
  }, [q]);

  return (
    <AuthGate>
      <>
        <Head>
          <title>DPS 77RP — Dashboard</title>
        </Head>

        <Nav />

        <div className="min-h-screen px-4 py-8 max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">Wybierz dokument</h1>

          <input
            className="input mb-4"
            placeholder="Szukaj dokumentu po nazwie..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

          <div className="grid md:grid-cols-2 gap-4">
            {filtered.map((t) => (
              <Link
                key={t.slug}
                href={`/doc/${t.slug}`}
                className="card p-4 hover:shadow-lg"
              >
                <h2 className="text-lg font-semibold">{t.name}</h2>
                {t.description && (
                  <p className="text-sm text-beige-700 mt-1">{t.description}</p>
                )}
              </Link>
            ))}
          </div>
        </div>
      </>
    </AuthGate>
  );
}
