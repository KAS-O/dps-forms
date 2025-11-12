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

## Dział kadr i konta użytkowników
- Przy zakładaniu kont wymagany jest **numer odznaki** (1–6 cyfr). Numer można też edytować dla istniejących profili – pole jest
  przechowywane w kolekcji `profiles` jako `badgeNumber`.
- Do poprawnego działania API działu kadr potrzebne są uprawnienia Firebase Admin. W środowisku produkcyjnym ustaw zmienne:
  `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL` oraz `FIREBASE_ADMIN_PRIVATE_KEY` (lub skorzystaj z jednego z
  obsługiwanych sposobów dostarczenia poświadczeń opisanych w `src/lib/firebaseAdmin.ts`).
- Aktualne reguły Firestore już pozwalają kadrze kierowniczej (`isBoard()`) na odczyt i modyfikację profili – nie są wymagane
  dodatkowe zmiany ani indeksy dla nowych funkcji działu kadr.

### Nowy system kadr – co należy skonfigurować
1. Zainstaluj zależności po aktualizacji repozytorium: `npm install` (dodano bibliotekę `google-auth-library`).
2. Zapewnij poświadczenia administracyjne Firebase **w jednym z obsługiwanych miejsc**:
   - ustaw zmienną środowiskową `FIREBASE_ADMIN_SERVICE_ACCOUNT` (JSON lub Base64),
   - lub wskaż ścieżkę w `FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH` / `GOOGLE_APPLICATION_CREDENTIALS`,
   - **albo** umieść plik JSON z kontem serwisowym w `firebase/service-account.json` (lub `serviceAccount.json` / `admin-service-account.json`).
3. Upewnij się, że w `.env` nadal są ustawione publiczne klucze Firebase (`NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, itp.).
4. Po każdej zmianie w `firebase/firestore.rules` wykonaj `firebase deploy --only firestore:rules` (zaktualizowano reguły tak, aby dowództwo mogło tworzyć profile nowych kont).
5. W konsoli Firebase włącz logowanie e-mail/hasło i dodaj bazowy użytkownik dowództwa, który będzie zakładał kolejne konta.

Panel kadr działa zarówno z pełnym Firebase Admin SDK, jak i w trybie awaryjnym (REST API), jeśli biblioteka `firebase-admin` nie może się zainicjalizować. W obu przypadkach wymagane są poświadczenia konta serwisowego – brak konfiguracji spowoduje komunikat o błędzie w panelu.

### Konfiguracja Firebase Admin dla Vercel/Firebase
1. W konsoli Firebase przejdź do **Ustawienia projektu → Konta usługi** i wygeneruj nowy klucz JSON dla konta z rolą
   co najmniej **Firebase Authentication Admin** (w praktyce rola `Editor` również działa).
2. Zabezpiecz plik JSON i ustaw go jako zmienną środowiskową na Vercelu, np. pod kluczem `FIREBASE_ADMIN_SERVICE_ACCOUNT`.
   Możesz wkleić cały JSON (pamiętaj o cudzysłowach) lub wrzucić go w Base64 i użyć zmiennej `FIREBASE_ADMIN_SERVICE_ACCOUNT`
   albo `FIREBASE_ADMIN_SERVICE_ACCOUNT_PATH` wskazującej na plik – wszystkie warianty są obsługiwane przez
   `src/lib/firebaseAdmin.ts`.
3. Jeżeli korzystasz z osobnych zmiennych (`FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`,
   `FIREBASE_ADMIN_PRIVATE_KEY`), upewnij się, że klucz prywatny ma poprawnie zamienione znaki nowej linii (`\n`).
4. Po wgraniu kluczy zrestartuj deployment. Panel kadrowy powinien zacząć pobierać konta (z fallbackiem do kolekcji `profiles`)
   oraz umożliwi tworzenie/edycję/usuwanie użytkowników.

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
