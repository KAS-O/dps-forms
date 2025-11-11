# DPS Forms Starter

Minimalny panel formularzy dla Department of Public Safety (RP FiveM)
- Logowanie e‑mail/hasło (Firebase) – konta tworzy admin
- Lista wzorów z wyszukiwarką
- Dynamiczne formularze
- Generowanie PDF (klient, jsPDF)
- Wysyłka na Discord (webhook)

## Szybki start (dev)
1) `cp .env.local.example .env.local` i uzupełnij klucze Firebase + `DISCORD_WEBHOOK_URL`
2) `npm i`
3) `npm run dev` i wejdź na http://localhost:3000

## Deploy
Najprościej: Vercel. Ustaw zmienne środowiskowe tak jak w `.env.local.example`.

### Firestore i Storage rules
W katalogu `firebase/` znajdują się aktualne reguły bezpieczeństwa (`firestore.rules`, `storage.rules`).

Po zmianach w repozytorium zdeployuj je poleceniami:

```bash
firebase deploy --only firestore:rules
firebase deploy --only storage:rules
```

Reguły obejmują m.in. możliwość zakładania teczek (`/dossiers/{id}`) przez zalogowanych funkcjonariuszy oraz modyfikację wpisów tylko przez autora lub kadrę kierowniczą.

### Dział kadr
- Numery odznak są zapisywane w dokumentach `profiles/{uid}` w polu `badgeNumber` i są wykorzystywane podczas filtrowania kont.
- Obecne reguły Firestore już pozwalają dowództwu (`isBoard()`) na odczyt i aktualizację profili, dlatego nie są wymagane dodatkowe uprawnienia ani indeksy dla nowych funkcji działu kadr.

## Zmiany w v2
- Wysyłka **obrazu (PNG)** zamiast PDF – podgląd A4 robiony z HTML przez `html2canvas`.
- Wiadomość na Discord zawiera **embed** z:
  - tytuł „Sukces” i opis „Do archiwum spłynął dokument”,
  - pola: Funkcjonariusz (login/e-mail), Data i godzina, Typ dokumentu,
  - dołączony obraz dokumentu.

## Zmiany w v3 (logowanie LOGIN+HASŁO)
- Formularz logowania ma pola **Login** i **Hasło** (bez e-maila).
- W środku login zamieniany jest na `LOGIN@<NEXT_PUBLIC_LOGIN_DOMAIN>` (domyślnie `dps.local`).
- W Firebase dodawaj użytkowników jako e-mail `LOGIN@dps.local` z wybranym hasłem.
- W embeddzie na Discordzie pokazywany jest sam **LOGIN** (bez domeny).
