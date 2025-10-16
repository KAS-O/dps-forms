export type Field =
  | {
      key: string;
      label: string;
      type:
        | "text"
        | "textarea"
        | "number"
        | "date"
        | "select"
        | "multiselect";
      required?: boolean;
      options?: string[];
    };

export type Template = {
  slug: string;
  name: string;
  description?: string;
  fields: Field[];
};

export const TEMPLATES: Template[] = [
  // Kontrola LSEB (zamiast sanitarnej) — z wielokrotnym wyborem
  {
    slug: "kontrola-lseb",
    name: "Kontrola LSEB",
    description: "Kontrola sanitarna / BHP / Ochrona prawa pracy",
    fields: [
      {
        key: "typ",
        label: "Rodzaj kontroli",
        type: "multiselect",
        options: [
          "Kontrola sanitarna",
          "Kontrola BHP",
          "Ochrona prawa pracy",
        ],
        required: true,
      },
      { key: "data", label: "Data", type: "date", required: true },
      { key: "miejsce", label: "Nazwa firmy / miejsce", type: "text", required: true },
      { key: "adres", label: "Adres", type: "text", required: true },
      { key: "ustalenia", label: "Ustalenia", type: "textarea", required: true },
      { key: "zalecenia", label: "Zalecenia", type: "textarea" },
      { key: "grzywna", label: "Grzywna (USD)", type: "number" },
    ],
  },

  // Bloczek mandatowy — bez punktów karnych
  {
    slug: "bloczek-mandatowy",
    name: "Bloczek mandatowy",
    fields: [
      { key: "data", label: "Data", type: "date", required: true },
      { key: "sprawca", label: "Sprawca (imię i nazwisko)", type: "text", required: true },
      { key: "cid", label: "CID", type: "text", required: true },
      { key: "miejsce", label: "Miejsce zdarzenia", type: "text", required: true },
      { key: "wykroczenie", label: "Wykroczenie", type: "textarea", required: true },
      { key: "kwota", label: "Kwota (USD)", type: "number", required: true },
      { key: "kroki", label: "Podjęte kroki", type: "textarea" },
      // brak pola "funkcjonariusz" — funkcjonariusze są wybierani globalnie
    ],
  },

  // Wniosek o ukaranie (bez kwoty — to nie „finanse”)
  {
    slug: "wniosek-o-ukaranie",
    name: "Wniosek o ukaranie do sądu",
    fields: [
      { key: "data", label: "Data", type: "date", required: true },
      { key: "obwiniony", label: "Obwiniony (imię i nazwisko)", type: "text", required: true },
      { key: "cid", label: "CID", type: "text" },
      { key: "czyn", label: "Zarzucany czyn", type: "textarea", required: true },
      { key: "dowody", label: "Dowody", type: "textarea" },
    ],
  },

  // Zgłoszenie kradzieży (z polami z Twoich wymagań)
  {
    slug: "zgloszenie-kradziezy",
    name: "Zgłoszenie kradzieży",
    fields: [
      { key: "data", label: "Data", type: "date", required: true },
      { key: "zglaszajacy", label: "Zgłaszający (imię i nazwisko)", type: "text", required: true },
      { key: "cid", label: "CID zgłaszającego", type: "text" },
      { key: "miejsce", label: "Miejsce", type: "text", required: true },
      { key: "co", label: "Co zostało skradzione", type: "textarea", required: true },
      { key: "opis", label: "Opis zdarzenia", type: "textarea", required: true },
      { key: "wartosc", label: "Szacowana wartość (USD)", type: "number" },
    ],
  },

  // NOWE: Protokół aresztowania / osadzenia
  {
    slug: "protokol-aresztowania",
    name: "Protokół aresztowania",
    fields: [
      { key: "data", label: "Data", type: "date", required: true },
      { key: "godzina", label: "Godzina", type: "text", required: true },
      { key: "osoba", label: "Osoba zatrzymana (imię i nazwisko)", type: "text", required: true },
      { key: "cid", label: "CID", type: "text", required: true },
      { key: "miejsce", label: "Miejsce zatrzymania", type: "text", required: true },
      { key: "okolicznosci", label: "Okoliczności zatrzymania", type: "textarea", required: true },
      { key: "zarzuty", label: "Zarzuty", type: "textarea", required: true },
      { key: "przedmioty", label: "Zatrzymane przedmioty", type: "textarea" },
      { key: "grzywna", label: "Grzywna (USD)", type: "number" },
      { key: "miesiace", label: "Miesiące osadzenia", type: "number", required: true },
    ],
  },

  // NOWE: Świadczenie społeczne — kwota nie wpływa na saldo DPS
  {
    slug: "swiadczenie-spoleczne",
    name: "Wypłata świadczeń socjalnych",
    fields: [
      { key: "data", label: "Data", type: "date", required: true },
      { key: "godzina", label: "Godzina", type: "text", required: true },
      { key: "beneficjent", label: "Beneficjent (imię i nazwisko)", type: "text", required: true },
      { key: "cid", label: "CID beneficjenta", type: "text", required: true },
      { key: "powod", label: "Powód przyznania świadczenia", type: "textarea", required: true },
       {
        key: "niepelnosprawnosc",
        label: "Stopień niepełnosprawności",
        type: "select",
        options: ["Brak", "Lekki", "Umiarkowany", "Znaczny"],
      },
      {
        key: "praca",
        label: "Czy posiada pracę?",
        type: "select",
        options: ["Tak", "Nie"],
        required: true,
      },
      { key: "kwota", label: "Wysokość świadczenia (USD)", type: "number", required: true },
      { key: "dni", label: "Następna wypłata dostępna dnia", type: "number", required: true },
    ],
  },
];
