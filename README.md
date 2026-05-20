# Panstwa Miasta Gra

Online wersja gry Panstwa Miasta z lobby do 12 osob, kategoriami, timerem,
losowaniem litery, przyciskiem gotowosci i odslanianiem odpowiedzi po komplecie
graczy albo po czasie.

## Stack

- Next.js App Router pod Vercel
- Firebase Auth anonymous + Firestore realtime
- OpenAI Responses API przez server route `/api/validate-answer`
- GitHub Contents API przez server route `/api/avatar`

## Start lokalnie

```bash
npm install
cp .env.example .env.local
npm run dev
```

Strona lokalnie: http://localhost:3000

## Firebase

W `.env.local` wklej config z Firebase Web App:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_DATABASE_URL=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=
NEXT_PUBLIC_FIREBASE_COLLECTION_ROOT=Panstwa Miasta Gra
```

Aplikacja zapisuje dane pod root collection `Panstwa Miasta Gra`:

- `uzytkownicy/lista/{intbaId}` - profil INTBA ID gracza
- `uzytkownicy/lista/{intbaId}/gra/panstwa-miasta` - staty gry, ostatnie lobby, licznik logowan i punkty
- `lobby/pokoje/{kod}` - ustawienia lobby i status rundy
- `lobby/pokoje/{kod}/gracze/{intbaId}` - gracze, gotowosc i punkty
- `lobby/pokoje/{kod}/rundy/{nr}/odpowiedzi/{intbaId}` - odpowiedzi rund

W Firebase wlacz Anonymous Auth i opublikuj `firestore.rules`.

## AI sprawdzanie odpowiedzi

Dodaj server-only env:

```bash
AI_PROVIDER=groq
AI_API_KEY=
AI_MODEL=openai/gpt-oss-20b
```

Mozesz tez uzyc `OPENAI_API_KEY` zamiast `AI_API_KEY` dla OpenAI. Klucze Groq
z prefiksem `gsk_` sa wykrywane automatycznie. Bez tokenu system nadal
sprawdza podstawowa zasade: odpowiedz musi zaczynac sie od wylosowanej litery.

## Avatar upload do GitHuba

Runtime upload do repo wymaga tokenu po stronie serwera:

```bash
GITHUB_TOKEN=
GITHUB_OWNER=
GITHUB_REPO=
GITHUB_BRANCH=main
```

Endpoint zapisuje pliki do `public/avatars/` przez GitHub Contents API i zwraca
raw.githubusercontent.com URL.

## Deploy na Vercel

1. Wypchnij repo na GitHub.
2. Zaimportuj repo w Vercel jako Next.js.
3. Dodaj zmienne srodowiskowe z `.env.example`.
4. Deploy.

Tokeny `AI_API_KEY` i `GITHUB_TOKEN` ustawiaj tylko jako server-side env w Vercel.
