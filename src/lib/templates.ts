export type Field =
  | { key: string; label: string; type: 'text' | 'textarea' | 'number' | 'date' | 'select'; required?: boolean; options?: string[] };

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
    fields: [
      { key: 'data', label: 'Data', type: 'date', required: true },
      { key: 'sprawca', label: 'Sprawca (imię i nazwisko)', type: 'text', required: true },
      { key: 'cid', label: 'CID', type: 'text', required: true },
      { key: 'miejsce', label: 'Miejsce zdarzenia', type: 'text', required: true },
      { key: 'wykroczenie', label: 'Wykroczenie', type: 'textarea', required: true },
      { key: 'kwota', label: 'Kwota (USD)', type: 'number', required: true },
      { key: 'pkt', label: 'Punkty karne', type: 'number' },
      { key: 'kroki', label: 'Podjęte kroki', type: 'textarea' },
      { key: 'funkcjonariusz', label: 'Funkcjonariusz', type: 'text', required: true },
    ]
  },
  {
    slug: 'wniosek-o-ukaranie',
    name: 'Wniosek o ukaranie do sądu',
    fields: [
      { key: 'data', label: 'Data', type: 'date', required: true },
      { key: 'obwiniony', label: 'Obwiniony (imię i nazwisko)', type: 'text', required: true },
      { key: 'cid', label: 'CID', type: 'text' },
      { key: 'czyn', label: 'Zarzucany czyn', type: 'textarea', required: true },
      { key: 'dowody', label: 'Dowody', type: 'textarea' },
      { key: 'funkcjonariusz', label: 'Wnioskodawca (funkcjonariusz)', type: 'text', required: true },
    ]
  },
  {
    slug: 'zgloszenie-kradziezy',
    name: 'Zgłoszenie kradzieży',
    fields: [
      { key: 'data', label: 'Data', type: 'date', required: true },
      { key: 'zglaszajacy', label: 'Zgłaszający (imię i nazwisko)', type: 'text', required: true },
      { key: 'cid', label: 'CID zgłaszającego', type: 'text' },
      { key: 'miejsce', label: 'Miejsce', type: 'text', required: true },
      { key: 'co', label: 'Co zostało skradzione', type: 'textarea', required: true },
      { key: 'opis', label: 'Opis zdarzenia', type: 'textarea', required: true },
      { key: 'wartosc', label: 'Szacowana wartość (USD)', type: 'number' },
      { key: 'funkcjonariusz', label: 'Przyjmujący zgłoszenie', type: 'text', required: true },
    ]
  }
];
