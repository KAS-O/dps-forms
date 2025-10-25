import { useMemo, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import AuthGate from "@/components/AuthGate";
import Nav from "@/components/Nav";
import AnnouncementSpotlight from "@/components/AnnouncementSpotlight";
import { TEMPLATES } from "@/lib/templates";

export default function Dashboard() {
  const [query, setQuery] = useState("");

  const filteredTemplates = useMemo(() => {
    const needle = query.toLowerCase();
    return TEMPLATES.filter(
      (template) => template.name.toLowerCase().includes(needle) || template.slug.includes(needle)
    );
  }, [query]);

  return (
    <AuthGate>
      <>
        <Head>
          <title>LSPD 77RP — Dashboard</title>
        </Head>
        <Nav />
        <div className="min-h-screen px-4 py-8 max-w-6xl mx-auto grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold mb-4">Wybierz dokument</h1>
              <input
                className="input"
                placeholder="Szukaj dokumentu po nazwie..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {filteredTemplates.map((template) => (
                <Link key={template.slug} href={`/doc/${template.slug}`} className="card p-4 transition hover:shadow-lg">
                  <h2 className="text-lg font-semibold">{template.name}</h2>
                  {template.description && <p className="text-sm text-beige-700 mt-1">{template.description}</p>}
                </Link>
              ))}
              {filteredTemplates.length === 0 && <p>Brak wyników dla podanego zapytania.</p>}
            </div>
          </div>
          <AnnouncementSpotlight />
        </div>
      </>
    </AuthGate>
  );
}
