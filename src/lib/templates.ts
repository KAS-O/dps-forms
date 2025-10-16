export type Field =
  | { key: string; label: string; type: 'text' | 'textarea' | 'number' | 'date' | 'select'; required?: boolean; options?: string[] }
  ;

export type Template = {
  slug: string;
  name: string;
  description?: string;
  fields: Field[];
};

export const TEMPLATES: Template[] = [
  {
    slug: 'protokol-kontroli-sanitarnej',
    name: 'Protokół kontroli sanitarnej',
    description: 'Wzór protokołu kontroli sanitarnej.',
    fields: [
      { key: 'data', label: 'Data', type: 'date', required: true },
      { key: 'funkcjonariusz', label: 'Funkcjonariusz', type: 'text', required: true },
      { key: 'jednostka', label: 'Jednostka', type: 'text' },
      { key: 'miejsce', label: 'Miejsce', type: 'text', required: true },
      { key: 'opis', label: 'Opis czynności', type: 'textarea', required: true },
      { key: 'wynik', label: 'Wynik/uwagi', type: 'textarea' },
    ]
  },
  {
    slug: 'bloczek-mandatowy',
    name: 'Bloczek mandatowy',
    description: 'Wystawienie mandatu.',
    fields: [
      { key: 'data', label: 'Data', type: 'date', required: true },
      { key: 'sprawca', label: 'Sprawca (imię i nazwisko/NICK)', type: 'text', required: true },
      { key: 'pesel', label: 'PESEL/ID RP', type: 'text' },
      { key: 'adres', label: 'Adres', type: 'text' },
      { key: 'wykroczenie', label: 'Wykroczenie', type: 'textarea', required: true },
      { key: 'kwota', label: 'Kwota (PLN)', type: 'number', required: true },
      { key: 'pkt', label: 'Punkty karne', type: 'number' },
      { key: 'funkcjonariusz', label: 'Funkcjonariusz', type: 'text', required: true },
    ]
  },
  {
    slug: 'wniosek-o-ukaranie',
    name: 'Wniosek o ukaranie do sądu',
    description: 'Kierowany do sądu RP.',
    fields: [
      { key: 'data', label: 'Data', type: 'date', required: true },
      { key: 'obwiniony', label: 'Obwiniony', type: 'text', required: true },
      { key: 'czyn', label: 'Zarzucany czyn', type: 'textarea', required: true },
      { key: 'dowody', label: 'Dowody', type: 'textarea' },
      { key: 'funkcjonariusz', label: 'Wnioskodawca (funkcjonariusz)', type: 'text', required: true },
    ]
  },
  {
    slug: 'zgloszenie-kradziezy',
    name: 'Zgłoszenie kradzieży',
    description: 'Zgłoszenie od obywatela.',
    fields: [
      { key: 'data', label: 'Data', type: 'date', required: true },
      { key: 'zglaszajacy', label: 'Zgłaszający', type: 'text', required: true },
      { key: 'kontakt', label: 'Kontakt', type: 'text' },
      { key: 'miejsce', label: 'Miejsce', type: 'text', required: true },
      { key: 'opis', label: 'Opis zdarzenia', type: 'textarea', required: true },
      { key: 'wartosc', label: 'Szacowana wartość szkody (PLN)', type: 'number' },
      { key: 'funkcjonariusz', label: 'Przyjmujący zgłoszenie', type: 'text', required: true },
    ]
  }
];
