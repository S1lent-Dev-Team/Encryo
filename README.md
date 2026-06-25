# 🔒 Encryo

Zero-Knowledge Datei-Hosting: Dateien werden **im Browser** verschlüsselt, der
Server speichert nur Ciphertext. Wer den Link hat (mit dem Key im `#`-Fragment)
bzw. das Passwort kennt, kann entschlüsseln – sonst niemand.

> **Status:** lauffähiges Online-Produkt. Echtes **Express-Backend** mit
> serverseitiger Persistenz (SQLite) und **httpOnly-Cookie-Login** – kein
> localStorage. Daten überleben Reloads und Server-Neustarts.

## Schnellstart (produktiv – ein Server, ein Port)

```bash
npm install
npm run build     # Frontend bauen -> dist/
npm start         # Express serviert dist/ + API auf http://localhost:8787
```

Öffne **http://localhost:8787**. Da der Build statisch ausgeliefert wird, gibt es
**kein HMR und keine automatischen Reloads** mehr.

### Entwicklung (mit Hot-Reload, zwei Prozesse)

```bash
npm run server    # Backend auf :8787
npm run dev       # Vite-Frontend auf :5173 (proxyt /api -> :8787)
```

So testest du den kompletten Flow:

1. **Upload** (`/`): Datei(en) ablegen, optional Passwort / One-Time / Ablauf →
   **Verschlüsseln & Link erstellen**.
2. Link kopieren und in neuem Tab öffnen → Empfänger-Ansicht (Auto-Vorschau).
3. **Anmelden** → **Meine Links**: View-Counter, Status & Zugriffs-History.

## Features

| Feature | Umsetzung |
|---|---|
| 🔒 Passwortschutz | Key per **PBKDF2** (250k Iter., SHA-256) aus Passwort + Salt |
| 🔥 One-Time-View | Server brennt den Link atomar nach dem ersten Öffnen |
| ⏳ Ablaufdatum | `expires_at`, serverseitig geprüft (1h / 24h / 7d / nie) + Live-Countdown |
| 👁️ View-Counter | pro Öffnung erhöht; **Zugriffs-History** (Zeitstempel) im Dashboard |
| 📦 Collections | mehrere Dateien teilen **einen** Key/Link |
| 👤 Accounts | Username + Passwort (scrypt-Hash) zum Bündeln eigener Links |
| 🔑 Key-Recovery | Eingeloggt optional eine mit dem Account-Passwort verschlüsselte Key-Kopie ablegen → Voll-Link später per Account-Passwort wiederherstellen |
| 🧩 Fehlender Key | Keyless-Link ohne `#`-Fragment ist keine Sackgasse mehr: Key manuell einfügen **oder** als Owner per Account-Passwort recovern |
| 🚫 Kill-Switch | Link jederzeit manuell sperren (sofort & unwiderruflich) |
| 🔢 Max-Aufrufe | Link nach N Öffnungen automatisch verbrennen (race-sicher wie One-Time) |
| 🔐 Passwort-UX | Stärke-Anzeige, Anzeigen/Verbergen-Auge, Zufallspasswort-Generator (CSPRNG) |
| 🔄 PW-Wechsel | Account-Passwort ändern → Recovery-Vaults werden clientseitig neu verschlüsselt (Re-Wrap) |
| 🔗 Secret im Link | Key/Passwort optional im `#`-Fragment → Empfänger sieht Vorschau sofort |
| 🖼️ Auto-Vorschau | Steckt das Secret im Link, wird (außer bei One-Time) ohne Klick entschlüsselt |
| 👁️ Inhalts-Vorschau | Bild, PDF, Video, Audio & Text werden nach dem Entschlüsseln direkt angezeigt (Bild-Lightbox) |
| 🗂️ Sammel-Download | Collections als **eine ZIP** herunterladen (clientseitig gepackt, ohne Dependency) |
| 📋 Einfügen | Screenshots/Dateien per **Strg+V** aus der Zwischenablage hinzufügen |
| 📤 Teilen | natives Share-Sheet (Web Share API) auf mobilen Geräten |
| 💬 Embed-Vorschau | optionales **öffentliches** Thumbnail → echte Discord/Slack-Unfurl-Karte (server-OG) |
| 📦 Speicher | 50 MB ohne Account, 100 MB mit Account (dauerhaft); größere Uploads mit 24-Std-Ablauf |
| 📱 QR-Code | Share-Link als QR (Lazy-geladen) im Erfolgs-Screen & Dashboard, als PNG speicherbar |
| ✏️ Dateien | vor dem Upload umbenennen & per ▲▼ sortieren |
| 🗓️ Custom-Ablauf | Presets (1 Std/24 Std/7 Tage) **oder** freies Datum/Uhrzeit |
| ☑️ Bulk-Aktionen | mehrere Links im Dashboard markieren → sammelweise sperren/löschen |
| 🔑 API-Tokens | für CLI/Skripte (voller Account-Zugriff), im Dashboard verwaltbar |
| ⌨️ CLI | `bin/encryo.mjs` lädt zero-knowledge per Token hoch (Verschlüsselung lokal in Node) |
| 🧩 Chunked Upload | Dateien werden in ≤6-MB-Häppchen hochgeladen → umgeht Proxy-Body-Limits (z.B. 100 MB) |
| ⏯️ Upload-Steuerung | flüssiger %-Balken + Speed/Restzeit, **Abbrechen/Fortsetzen**, Auto-Retry pro Chunk (idempotent) |
| 🖼️ Lightbox-Galerie | mehrere Bilder mit ◀ ▶ / Pfeiltasten durchblättern, **Bild in Zwischenablage kopieren** |
| ⬇️ Download-Fortschritt | beim Öffnen großer Links: Herunterladen-% dann Entschlüsseln-% |

## Teilen & Vorschau (Discord & Co.)

Beim Erstellen kann das Secret in den Link eingebettet werden:

- **ohne Passwort:** Key steckt immer hinter `#k.…`
- **mit Passwort:** optional `#p.…` (Sofort-Vorschau) **oder** Secret weglassen
  und das Passwort über einen separaten Kanal teilen

**Discord-/Slack-Unfurl (server-seitig pro Link):** Der Server rendert für
`/v/<id>` eigene Open-Graph-Tags (Titel, Größe, Schutz-Flags) – Discord & Co.
zeigen so eine **echte Pro-Link-Karte**, ohne dass JS oder das `#`-Fragment nötig
sind. Den verschlüsselten *Inhalt* kann der Crawler dabei nie sehen.

Ein **Embed-Bild** ist beim Erstellen **opt-in** (Toggle „Öffentliche Vorschau"):
Dann erzeugt der Browser ein verkleinertes Thumbnail des ersten Bildes und legt
es **unverschlüsselt & öffentlich** ab (`/api/links/:id/preview`, als `og:image`).
Das ist eine bewusste, klar gekennzeichnete Ausnahme vom Zero-Knowledge-Modell –
nur für dieses eine Vorschaubild. Ohne Opt-in bleibt die Karte rein
metadatenbasiert (kein Bild). Die In-App-Karte (`SharePreview`) zeigt vorab exakt,
wie der Link beim Teilen aussieht.

## Krypto-Design (`src/lib/crypto.js`)

- **AES-256-GCM** für die Dateiinhalte (IV pro Datei eindeutig).
- **Ohne Passwort:** zufälliger Key → landet im URL-Fragment (`/v/<id>#<key>`).
  Fragmente werden vom Browser **nie an den Server gesendet**.
- **Mit Passwort:** Key wird per PBKDF2 abgeleitet; nur das Salt liegt am Server.
- **Verifier:** eine verschlüsselte Konstante erlaubt dem Client zu prüfen, ob
  Key/Passwort stimmen – **bevor** ein One-Time-Link verbraucht wird. Ein
  falsches Passwort verbrennt den Link also nicht.

Round-Trip-Logik ist mit einem Node-Test abgedeckt (Encrypt→Open→Decrypt,
falsches Passwort brennt nicht, One-Time brennt, kein Klartext am „Server").

## Key-Recovery (Recovery-Vault)

Ein keyless Link trägt seinen Key nur im `#`-Fragment. Geht der Link verloren
oder wird er beim Kopieren abgeschnitten, ist der Inhalt sonst **endgültig** weg.
Eingeloggte Nutzer können den Link deshalb optional **wiederherstellbar** machen:

- Beim Erstellen wird eine **verschlüsselte Kopie des Link-Secrets**
  (`{ t:"k"|"p", v }`) im Account abgelegt. Der **Wrapping-Key** wird
  *clientseitig* aus dem Account-Passwort + einem pro-User-`recovery_salt`
  abgeleitet (PBKDF2, gleicher Mechanismus wie ein Datei-Passwort).
- Der Server speichert nur den **Ciphertext des Vaults** (`recovery_iv/ct`),
  niemals den Wrapping-Key. Der Recovery-Key lebt ausschließlich **im Speicher**
  des Browsers (nach Login abgeleitet; nach Reload per Passwort-Eingabe erneut).
- Recovern kann man (a) im **Dashboard** („Voll-Link" → kompletten Share-Link
  rekonstruieren/kopieren/QR) und (b) direkt auf der **Empfänger-Ansicht**, wenn
  dort der Key fehlt („Mit Account-Passwort wiederherstellen").
- **Passwort ändern** re-wrappt alle eigenen Vaults clientseitig mit dem neuen
  Passwort, bevor der Server den Hash umstellt – der Klartext erreicht den Server
  nie.

**Trust-Modell (bewusster Trade-off):** Recovery ist *opt-in pro Link* und an den
Account gebunden. Da der Login das rohe Account-Passwort an den Server sendet
(scrypt), ist der Server beim Login mit dem Account-Passwort betraut – ein
wiederherstellbarer Link ist daher **nicht** „rein" zero-knowledge wie ein
keyless Link ohne Recovery. **Datei-Inhalte und Datei-Keys bleiben unverändert
zero-knowledge** (der Server sieht weiterhin nie den Klartext oder den Datei-Key).

Der Recovery-Round-Trip (wrap→unwrap, falsches Passwort scheitert, Re-Wrap) ist
mit `npm test` abgedeckt (`test/recovery.test.mjs`).

## Architektur

```
server/
  index.js    Express: REST-API (Auth + Links) + Auslieferung von dist/
  db.js       Persistenz via node:sqlite (Users, Sessions, Links, Files, Accesses)
src/
  lib/
    crypto.js   Web-Crypto: Keys, Encrypt/Decrypt, PBKDF2, Verifier, wrap/unwrapSecret  (nur Client)
    recovery.js In-Memory-Halter für den Account-Recovery-Key (kein Storage)
    store.js    fetch(/api): createLink/getLinkMeta/openLink/deleteLink/revokeLink/getLinkRecovery
    auth.js     fetch(/api/auth): register/login/logout/fetchMe/changeAccountPassword (Cookie-Session)
    link.js     Share-URL bauen/lesen (Key/Passwort im #-Fragment)
    limits.js   geteilte Upload-Limits (Client + Server)
    zip.js      dependency-freier ZIP-Writer für den Sammel-Download
    prefs.js    zuletzt genutzte UI-Optionen in localStorage (keine Secrets)
  components/   ui.jsx, Dropzone, SharePreview, QrCode
  pages/        UploadPage, ViewPage, DashboardPage, LoginPage
data/           SQLite-DB (gitignored, persistiert auf Platte)
```

## API

| Methode | Pfad | Zweck |
|---|---|---|
| `POST` | `/api/auth/register` · `/login` · `/logout` | Account + httpOnly-Cookie-Session (liefert `recoverySalt`) |
| `GET` | `/api/auth/me` | aktueller User (+ `recoverySalt`) |
| `POST` | `/api/auth/password` | Account-Passwort ändern + re-wrapte Vaults speichern (Login nötig) |
| `POST` | `/api/links` | Link anlegen (Ciphertext + Metadaten, optional `maxViews`/`recovery`) |
| `GET` | `/api/links/:id` | Metadaten (ohne Ciphertext, nicht destruktiv; inkl. `recoverable`, `hasPreview`) |
| `GET` | `/api/links/:id/preview` | öffentliches Vorschau-Thumbnail (nur falls opt-in), z.B. als `og:image` |
| `POST` | `/api/links/:id/open` | **atomar**: `view_count++`, bei One-Time/Max-Views `burned=1`, liefert Ciphertext |
| `GET` | `/api/links/:id/recovery` | verschlüsselter Recovery-Vault (nur Owner) |
| `POST` | `/api/links/:id/revoke` | Kill-Switch: Link sofort sperren (nur Owner) |
| `GET` | `/api/links` | eigene Links inkl. Vault-Blob (Login nötig) |
| `DELETE` | `/api/links/:id` | löschen (nur Owner) |

One-Time **und** Max-Views sind serverseitig race-sicher: das atomare
`UPDATE … WHERE burned=0 AND (max_views IS NULL OR view_count < max_views)` lässt
zwei parallele Aufrufe denselben Link nicht beide über das Limit hinaus öffnen.

**Was der Server NIE sieht:** den Decryption-Key (im `#`-Fragment), das
Datei-Passwort und den Klartext. Gespeichert werden nur Ciphertext + Metadaten
(inkl. Dateiname, wie im Datenmodell vorgesehen).

## Deployment (z.B. Railway)

`npm run build && npm start`. Der Server hört auf `process.env.PORT`. Für
persistente Daten ein Volume auf `DATA_DIR` (default `./data`) mounten.

**Speicher-Limits** (geteilt zwischen Client & Server in `src/lib/limits.js`):

| | Freikontingent (dauerhaft) | darüber |
|---|---|---|
| ohne Account | 50 MB / Link | 50–100 MB: Ablauf autom. 24 Std · über 100 MB → Account nötig |
| mit Account | 100 MB / Link | 100–500 MB: Ablauf autom. 24 Std · Gesamt-Kontingent 8 GB/Account |

Der Ciphertext liegt aktuell als base64 in SQLite (`files.ciphertext`). Für
großvolumigen Produktivbetrieb sollte das durch Object-Storage (Supabase / S3)
ersetzt werden – betrifft nur `server/db.js`. Das JSON-Body-Limit des Servers ist
entsprechend auf 750 MB gesetzt. Ciphertext von toten Links (verbrannt/gesperrt/
abgelaufen) wird stündlich freigegeben (`reclaimDeadCiphertext`), Metadaten +
Statistik bleiben erhalten.

**Chunked Upload:** Große Dateien werden in ≤6-MB-Häppchen hochgeladen
(`POST /api/uploads` → `…/:id/chunk` → `…/:id/complete`) und serverseitig
zusammengesetzt. So reißt keine einzelne Anfrage das Body-Limit eines
vorgelagerten Proxys/Tunnels (z.B. Cloudflare-Free: 100 MB) — der Auslöser für
den früheren `HTTP 413` bei großen Uploads. Sessions liegen im Speicher (TTL
30 min) und sind auf das Account-Hardlimit gedeckelt.

## Sicherheit & Betrieb

- **Rate-Limiting** (In-Memory, [server/ratelimit.js](server/ratelimit.js)): Login/Register/Passwort
  25 / 15 min, Link-Erstellung 40 / 10 min, Öffnen 120 / 10 min — je Client-IP.
- **Session-Ablauf:** Sessions gelten 30 Tage; abgelaufene werden beim Zugriff
  entwertet und stündlich aus der DB entfernt.
- **Account-Kontingent:** max. 200 Links bzw. 1 GB gesamt pro Account
  (`ACCOUNT_QUOTA` in `src/lib/limits.js`).
- **Header:** strikte `Content-Security-Policy` (kein inline-Script — daher liegt
  der Theme-Bootstrap als `public/theme-init.js` vor), `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy`.
- **CSRF/Origin:** schreibende API-Aufrufe werden im Build-Betrieb gegen den
  Host geprüft (zusätzlich zu `sameSite=lax`). Weitere erlaubte Origins via
  `ALLOWED_ORIGINS` (CSV).

## Tests & CI

`npm test` führt vier Suiten aus (alle dependency-frei):

- `test/recovery.test.mjs` — Recovery-Vault-Krypto-Round-Trip
- `test/limits.test.mjs` — Upload-/Quota-Logik
- `test/ratelimit.test.mjs` — Rate-Limiter-Middleware
- `test/db.test.mjs` — Persistenz (createLink, One-Time/Max-Views-Burn,
  Revoke/Delete-Owner-Checks, `ownerUsage`, `reclaimDeadCiphertext`, Sessions)
  gegen eine frische Temp-DB (`DATA_DIR`).

GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) baut + testet
bei jedem Push/PR auf Node 24.

## CLI (programmatische Uploads)

Tokens im Dashboard unter **API-Tokens** anlegen, dann zero-knowledge hochladen
(Verschlüsselung läuft lokal in Node, der Server sieht nur Ciphertext):

```bash
ENCRYO_SERVER=https://encryo.s1lent.dev ENCRYO_TOKEN=enc_… \
  node bin/encryo.mjs upload bild.png --one-time
```

Optionen: `--password <pw>`, `--no-embed`, `--one-time`, `--max-views <n>`,
`--expire <stunden>`. Der ausgegebene Link trägt den Schlüssel im `#`-Fragment.

| Methode | Pfad | Zweck |
|---|---|---|
| `GET`/`POST`/`DELETE` | `/api/auth/tokens` | API-Tokens auflisten/erstellen/widerrufen (Login nötig) |

Bei `POST /api/links` etc. authentisiert ein `Authorization: Bearer <token>`
gleichwertig zur Cookie-Session.

## Sprache & Theme

Die Oberfläche ist **Deutsch/Englisch** (Umschalter im Header, Auswahl wird lokal
gemerkt) und unterstützt ein **helles & dunkles Theme** (Sonne/Mond im Header,
inkl. dynamischer `theme-color`). Auch die server-seitigen Unfurl-Tags richten
sich nach `Accept-Language`.

## PWA & Barrierefreiheit

- **Installierbar / offline:** `public/manifest.webmanifest` + Service-Worker
  (`public/sw.js`, nur im Production-Build registriert). Navigationen
  network-first, gehashte `/assets/` cache-first, `/api` nie gecacht.
- **Accessibility:** Toasts als `aria-live`-Region, die Bild-Lightbox ist ein
  `role="dialog"` mit Fokus-Fang (Esc schließt, Fokus kehrt zurück).
- **Mobil:** die Zeilen-Aktionen im Dashboard klappen auf kleinen Screens in ein
  Kebab-Menü (⋮); auf Desktop bleibt die Button-Spalte.

---

Ein Projekt von **[S1lent](https://s1lent.dev)** · [s1lent.dev](https://s1lent.dev)
