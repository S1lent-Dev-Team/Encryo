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
| 💬 Unfurl-Vorschau | Discord-/Slack-Style Vorschaukarte zeigt, wie der Link beim Teilen aussieht |
| 📱 QR-Code | Share-Link als QR (Lazy-geladen) im Erfolgs-Screen & Dashboard |

## Teilen & Vorschau (Discord & Co.)

Beim Erstellen kann das Secret in den Link eingebettet werden:

- **ohne Passwort:** Key steckt immer hinter `#k.…`
- **mit Passwort:** optional `#p.…` (Sofort-Vorschau) **oder** Secret weglassen
  und das Passwort über einen separaten Kanal teilen

**Wichtiger Hinweis zur Discord-Vorschau:** Eine *echte* Unfurl-Vorschau des
entschlüsselten Inhalts ist im Zero-Knowledge-Modell prinzipiell unmöglich –
Discords Crawler führt kein JS aus und sieht das `#`-Fragment nie. Der Prototyp
liefert deshalb (a) eine **In-App Unfurl-Vorschau** (`SharePreview`), die exakt
zeigt, wie der Link aussieht, und (b) statische OG-/Twitter-Tags fürs
Domain-Unfurling. Echte **pro-Link** OG-Previews brauchen das Backend, das
serverseitig OG-Tags rendert – und sind dann eine bewusst *öffentliche* Vorschau
(z.B. nur eine Thumbnail), nicht der geschützte Inhalt.

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
| `GET` | `/api/links/:id` | Metadaten (ohne Ciphertext, nicht destruktiv; inkl. `recoverable`) |
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
persistente Daten ein Volume auf `DATA_DIR` (default `./data`) mounten. Für
größere Dateien später `files.ciphertext` durch Supabase Storage / S3 ersetzen –
betrifft nur `server/db.js`. Limit aktuell 25 MB pro Link.
