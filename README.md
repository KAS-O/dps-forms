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

## Ikony jednostek specjalistycznych
- Wszystkie logotypy jednostek możesz umieścić w katalogu `public/unit-icons/` (utwórz go, jeśli jeszcze nie istnieje).
- Aplikacja szuka plików PNG o nazwach odpowiadających identyfikatorom jednostek: `iad.png`, `swat-sert.png`, `usms.png`, `dtu.png`, `gu.png`, `ftd.png`.
- Zalecany format to kwadratowe PNG (np. 256×256 px) z przezroczystym tłem. Możesz użyć wyższej rozdzielczości, grafika zostanie automatycznie przeskalowana w panelu.
- Po dodaniu lub podmianie pliku zrestartuj dev server/Vercela, aby nowa grafika została zaczytana przez przeglądarkę.

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

## Dział kadr i konta użytkowników
- Przy zakładaniu kont wymagany jest **numer odznaki** (1–6 cyfr). Numer można też edytować dla istniejących profili – pole jest
  przechowywane w kolekcji `profiles` jako `badgeNumber`.
- Panel kadrowy korzysta z REST API Firebase (`Identity Toolkit`) oraz kolekcji `profiles` w Firestore – nie jest już wymagane
  konfigurowanie Firebase Admin SDK na serwerze.
- W środowisku produkcyjnym upewnij się, że dostępne są zmienne środowiskowe:
  - `NEXT_PUBLIC_FIREBASE_API_KEY` (możesz opcjonalnie ustawić kopię w `FIREBASE_REST_API_KEY`),
  - `NEXT_PUBLIC_FIREBASE_PROJECT_ID` (lub osobno `FIREBASE_REST_PROJECT_ID`).
- Po wdrożeniu zmian zaktualizuj reguły Firestore poleceniem `firebase deploy --only firestore:rules` – nowa wersja pozwala
  kadrze dowódczej (`isBoard()`) tworzyć profile innych użytkowników.
- Tworzenie kont odbywa się w pełni z poziomu panelu – po wprowadzeniu loginu, hasła i numeru odznaki profil zostaje automatycznie
  dopisany do kolekcji `profiles`.
- Resetowanie haseł lub usuwanie kont wymaga użycia konsoli Firebase (np. zakładki **Authentication**) – panel wyświetla linki
  i umożliwia edycję danych profilowych, ale nie usuwa kont z Firebase Auth.

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
