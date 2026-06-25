// index.js — Express-Server: REST-API + Auslieferung des gebauten Frontends.
// Ein Prozess, ein Port -> deploybar (z.B. Railway). Der Server sieht nie Klartext.

import express from "express";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import * as db from "./db.js";
import {
  checkUpload,
  effectiveExpiryHours,
  checkAccountQuota,
  LIMITS,
  ACCOUNT_QUOTA,
} from "../src/lib/limits.js";
import { formatBytes } from "../src/lib/format.js";
import { rateLimit } from "./ratelimit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");
const SERVE_BUILD = existsSync(DIST); // im Build-Betrieb liefern wir das Frontend selbst aus
const PORT = process.env.PORT || 8787;
const COOKIE = "encryo_sid";
// Obergrenze für ein öffentliches Vorschau-Thumbnail (base64-Zeichen ~ 1.9 MB Bild).
const MAX_PREVIEW_CHARS = 2_600_000;
// Optionale, zusätzlich erlaubte Origins (CSV) für den CSRF-/Origin-Check.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // React inline-styles (style={{…}})
  "img-src 'self' data: blob:", // Favicon (data:), QR (data:), entschlüsselte Bilder (blob:)
  "media-src 'self' blob:", // entschlüsselte Audio/Video
  "frame-src 'self' blob:", // PDF-Vorschau (blob:)
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const app = express();
app.set("trust proxy", true); // hinter Reverse-Proxy: korrektes Protokoll/Host + req.ip
// Ciphertext ist base64 -> bis ~500 MB Klartext (≈ 667 MB base64) müssen reinpassen
// (Account-Hardcap in src/lib/limits.js). Headroom auf 750 MB.
app.use(express.json({ limit: "750mb" }));
app.use(cookieParser());

// ------- Security-Header ---------------------------------------------------
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", CSP);
  next();
});

// ------- CSRF-/Origin-Schutz für schreibende API-Aufrufe -------------------
// sameSite=lax-Cookies decken viel ab; dieser Check ist Defense-in-Depth. Nur im
// Build-Betrieb aktiv (im Dev läuft das Frontend hinter dem Vite-Proxy auf einem
// anderen Port). Nicht-Browser-Clients (ohne Origin/Referer) werden nicht blockiert.
const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
app.use("/api", (req, res, next) => {
  if (!SERVE_BUILD || !STATE_CHANGING.has(req.method)) return next();
  const origin = req.get("origin") || req.get("referer");
  if (!origin) return next();
  try {
    const host = new URL(origin).host;
    if (host === req.get("host") || ALLOWED_ORIGINS.includes(new URL(origin).origin))
      return next();
  } catch {
    /* unparsebar -> ablehnen */
  }
  return res.status(403).json({ error: "Ungültiger Origin." });
});

// ------- Rate-Limiter ------------------------------------------------------
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 25,
  message: "Zu viele Anmeldeversuche. Bitte in einigen Minuten erneut versuchen.",
});
const createLimiter = rateLimit({ windowMs: 10 * 60_000, max: 40 });
const openLimiter = rateLimit({ windowMs: 10 * 60_000, max: 120 });

// ------- Auth-Middleware (Cookie-Session ODER Bearer-API-Token) ------------
app.use("/api", (req, _res, next) => {
  let user = db.getSessionUser(req.cookies[COOKIE]);
  if (!user) {
    const auth = req.get("authorization") || "";
    if (auth.startsWith("Bearer ")) user = db.getUserByApiToken(auth.slice(7).trim());
  }
  req.user = user || null;
  next();
});
const requireAuth = (req, res, next) =>
  req.user ? next() : res.status(401).json({ error: "Nicht angemeldet." });

function setSessionCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 30 * 24 * 3600_000,
  });
}

// ------- Auth-Routen -------------------------------------------------------
app.post("/api/auth/register", authLimiter, (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (username.length < 3)
    return res.status(400).json({ error: "Username braucht mind. 3 Zeichen." });
  if (password.length < 6)
    return res.status(400).json({ error: "Passwort braucht mind. 6 Zeichen." });
  if (db.getUserByUsername(username))
    return res.status(409).json({ error: "Username ist bereits vergeben." });

  const user = db.createUser(username, password);
  setSessionCookie(res, db.createSession(user.id));
  res.json({ username: user.username, recoverySalt: user.recoverySalt });
});

app.post("/api/auth/login", authLimiter, (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.verifyUser(username, password);
  if (!user) return res.status(401).json({ error: "Username oder Passwort falsch." });
  setSessionCookie(res, db.createSession(user.id));
  res.json({ username: user.username, recoverySalt: user.recoverySalt });
});

app.post("/api/auth/logout", (req, res) => {
  db.deleteSession(req.cookies[COOKIE]);
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  res.json({
    username: req.user ? req.user.username : null,
    recoverySalt: req.user ? req.user.recoverySalt : null,
  });
});

// Account-Passwort ändern. Der Client liefert die mit dem NEUEN Passwort
// re-verschlüsselten Recovery-Vaults (items) gleich mit — so bleibt Recovery
// nach dem Wechsel intakt, ohne dass der Server je Klartext sieht.
app.post("/api/auth/password", authLimiter, requireAuth, (req, res) => {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (newPassword.length < 6)
    return res.status(400).json({ error: "Neues Passwort braucht mind. 6 Zeichen." });
  if (!db.verifyUser(req.user.username, currentPassword))
    return res.status(401).json({ error: "Aktuelles Passwort ist falsch." });

  db.changePassword(req.user.id, newPassword);
  const { updated } = db.rewrapRecovery(req.user.id, items);
  res.json({ ok: true, rewrapped: updated });
});

// ------- API-Token-Routen (für CLI/Skripte) --------------------------------
app.get("/api/auth/tokens", requireAuth, (req, res) => {
  res.json(db.listApiTokens(req.user.id));
});
app.post("/api/auth/tokens", authLimiter, requireAuth, (req, res) => {
  const label = typeof req.body?.label === "string" ? req.body.label.trim().slice(0, 64) : "";
  res.json(db.createApiToken(req.user.id, label));
});
app.delete("/api/auth/tokens/:id", requireAuth, (req, res) => {
  res.json(db.deleteApiToken(req.params.id, req.user.id));
});

// ------- Gemeinsame Validierung + Link-Anlage ------------------------------
// Genutzt vom Einmal-Upload (/api/links) UND vom Chunk-Abschluss.
function finalizeLink(req, res, body) {
  const {
    files,
    salt,
    verifier,
    oneTime,
    expiresInHours,
    passwordProtected,
    maxViews,
    recovery,
    preview,
    protected: viewProtect,
  } = body || {};
  if (!Array.isArray(files) || files.length === 0)
    return res.status(400).json({ error: "Keine Dateien." });
  for (const f of files) {
    if (!f.iv || !f.ciphertext || typeof f.filename !== "string")
      return res.status(400).json({ error: "Ungültige Datei-Payload." });
  }
  const total = files.reduce((s, f) => s + (f.size || 0), 0);
  const isLoggedIn = !!req.user;
  const check = checkUpload({ totalSize: total, isLoggedIn });
  if (!check.ok) {
    if (check.reason === "NEED_ACCOUNT")
      return res.status(403).json({
        error: `Dateien über ${formatBytes(LIMITS.anon.hard)} brauchen einen Account.`,
      });
    return res
      .status(413)
      .json({ error: `Maximal ${formatBytes(LIMITS.account.hard)} pro Link.` });
  }
  // Gesamt-Kontingent pro Account prüfen (Missbrauchs-/Speicherschutz).
  if (isLoggedIn) {
    const usage = db.ownerUsage(req.user.id);
    const q = checkAccountQuota({
      currentLinks: usage.count,
      currentBytes: usage.bytes,
      addBytes: total,
    });
    if (!q.ok) {
      if (q.reason === "LINK_LIMIT")
        return res.status(409).json({
          error: `Link-Limit erreicht (max. ${ACCOUNT_QUOTA.maxLinks}). Bitte alte Links löschen.`,
        });
      return res.status(413).json({
        error: `Speicher-Kontingent erschöpft (max. ${formatBytes(ACCOUNT_QUOTA.maxTotal)}).`,
      });
    }
  }

  // Über dem Freikontingent wird der Ablauf serverseitig auf 24 Std gedeckelt.
  const hours = effectiveExpiryHours({
    totalSize: total,
    isLoggedIn,
    requestedHours: expiresInHours || null,
  });

  // Öffentliche Vorschau nur akzeptieren, wenn klein genug (sonst stillschweigend droppen).
  const previewOk =
    preview &&
    typeof preview.mime === "string" &&
    typeof preview.data === "string" &&
    preview.data.length <= MAX_PREVIEW_CHARS
      ? preview
      : null;

  const { id, expiresAt } = db.createLink({
    files,
    salt: salt || null,
    verifier: verifier || null,
    oneTime: !!oneTime,
    expiresInHours: hours,
    passwordProtected: !!passwordProtected,
    maxViews: Number.isInteger(maxViews) ? maxViews : null,
    recovery: recovery && recovery.iv && recovery.ciphertext ? recovery : null,
    preview: previewOk,
    protected: !!viewProtect,
    ownerId: req.user ? req.user.id : null,
  });
  res.json({ id, expiresAt, forced: !!check.forced });
}

// ------- Chunked Upload ----------------------------------------------------
// Umgeht Body-Limits vorgelagerter Proxys/Tunnel (z.B. 100 MB). Die Datei wird
// in kleinen Häppchen hochgeladen und serverseitig zusammengesetzt.
const uploadSessions = new Map(); // uploadId -> { createdAt, files: [], chars }
const UPLOAD_SESSION_TTL = 30 * 60_000;
const MAX_UPLOAD_CHARS = Math.ceil(LIMITS.account.hard * 1.4); // base64-Obergrenze (~Hardcap)

function purgeUploadSessions() {
  const cutoff = Date.now() - UPLOAD_SESSION_TTL;
  for (const [id, s] of uploadSessions) if (s.createdAt < cutoff) uploadSessions.delete(id);
}

// ------- Link-Routen -------------------------------------------------------
// Einmal-Upload (kleine Dateien / Abwärtskompatibilität).
app.post("/api/links", createLimiter, (req, res) => finalizeLink(req, res, req.body || {}));

// Chunked: Session anlegen -> Chunks anhängen -> abschließen.
app.post("/api/uploads", createLimiter, (_req, res) => {
  const uploadId = randomUUID();
  uploadSessions.set(uploadId, { createdAt: Date.now(), files: [], chars: 0 });
  res.json({ uploadId });
});

app.post("/api/uploads/:id/chunk", (req, res) => {
  const s = uploadSessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "Upload-Session unbekannt oder abgelaufen." });
  const { fileIndex, chunkIndex, filename, size, mimetype, iv, chunk } = req.body || {};
  if (
    typeof fileIndex !== "number" || fileIndex < 0 ||
    typeof chunkIndex !== "number" || chunkIndex < 0 ||
    typeof chunk !== "string"
  )
    return res.status(400).json({ error: "Ungültiger Chunk." });
  let f = s.files[fileIndex];
  if (!f) {
    f = s.files[fileIndex] = {
      filename: String(filename || "datei"),
      size: Number(size) || 0,
      mimetype: typeof mimetype === "string" ? mimetype : "application/octet-stream",
      iv: typeof iv === "string" ? iv : "",
      chunks: [],
    };
  }
  // Indexbasiert -> idempotent: ein erneut gesendeter Chunk überschreibt sich
  // selbst (für Retry/Resume), ohne den Ciphertext zu verdoppeln.
  const prev = f.chunks[chunkIndex] ? f.chunks[chunkIndex].length : 0;
  s.chars += chunk.length - prev;
  if (s.chars > MAX_UPLOAD_CHARS) {
    uploadSessions.delete(req.params.id);
    return res.status(413).json({ error: `Maximal ${formatBytes(LIMITS.account.hard)} pro Link.` });
  }
  f.chunks[chunkIndex] = chunk;
  res.json({ ok: true });
});

app.post("/api/uploads/:id/complete", createLimiter, (req, res) => {
  const s = uploadSessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "Upload-Session unbekannt oder abgelaufen." });
  // Chunks lückenlos zusammensetzen; fehlt einer -> Upload unvollständig.
  const files = [];
  for (const f of s.files) {
    if (!f) continue;
    for (let i = 0; i < f.chunks.length; i++)
      if (f.chunks[i] == null)
        return res.status(400).json({ error: "Upload unvollständig (fehlender Chunk)." });
    files.push({
      filename: f.filename,
      size: f.size,
      mimetype: f.mimetype,
      iv: f.iv,
      ciphertext: f.chunks.join(""),
    });
  }
  uploadSessions.delete(req.params.id);
  finalizeLink(req, res, { ...(req.body || {}), files });
});

app.get("/api/links/:id", (req, res) => {
  res.json(db.getLinkMeta(req.params.id));
});

app.post("/api/links/:id/open", openLimiter, (req, res) => {
  res.json(db.openLink(req.params.id));
});

app.get("/api/links", requireAuth, (req, res) => {
  res.json(db.listLinksByOwner(req.user.id));
});

// Verschlüsselten Recovery-Vault eines Links holen (nur Owner) — z.B. wenn der
// Empfänger-Link das #-Fragment verloren hat und der eingeloggte Owner ihn rettet.
app.get("/api/links/:id/recovery", requireAuth, (req, res) => {
  const r = db.getLinkRecovery(req.params.id, req.user.id);
  if (!r.ok) {
    const code = r.reason === "FORBIDDEN" ? 403 : 404;
    return res.status(code).json(r);
  }
  res.json(r);
});

// Öffentliches Vorschau-Thumbnail (unverschlüsselt, opt-in) — z.B. als og:image
// für Unfurl-Embeds. Bewusst ohne Login, da es ein öffentliches Bild ist.
app.get("/api/links/:id/preview", (req, res) => {
  const p = db.getLinkPreview(req.params.id);
  if (!p) return res.status(404).end();
  res.setHeader("Content-Type", p.mime);
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(Buffer.from(p.data, "base64"));
});

// Kill-Switch: Link sofort sperren (nur Owner).
app.post("/api/links/:id/revoke", requireAuth, (req, res) => {
  const r = db.revokeLink(req.params.id, req.user.id);
  if (!r.ok) return res.status(r.reason === "FORBIDDEN" ? 403 : 404).json(r);
  res.json(r);
});

app.delete("/api/links/:id", requireAuth, (req, res) => {
  const r = db.deleteLink(req.params.id, req.user.id);
  if (!r.ok) return res.status(r.reason === "FORBIDDEN" ? 403 : 404).json(r);
  res.json(r);
});

// ------- Frontend (gebauter Build) + SPA-Fallback --------------------------
// HTML wird selbst ausgeliefert (index:false), damit pro Seite die passenden
// Open-Graph-Tags injiziert werden können — für /v/:id entstehen so echte
// Unfurl-Karten in Discord/Slack.
function escAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// OG-Texte zweisprachig. Discord-Crawler schicken oft kein Accept-Language —
// dann bleibt es bei Deutsch (Default).
const OG_STRINGS = {
  de: {
    genericTitle: "Encryo · verschlüsselt teilen",
    genericDesc:
      "Ende-zu-Ende verschlüsseltes Datei-Hosting. Dateien werden im Browser verschlüsselt, der Server sieht nur Ciphertext.",
    fallbackTitle: "Verschlüsselte Dateien · Encryo",
    fallbackDesc: "Im Browser verschlüsselt — der Server sieht nur Ciphertext.",
    fileTitle: (n) =>
      (n === 1 ? "1 verschlüsselte Datei" : `${n} verschlüsselte Dateien`) + " · Encryo",
    pw: "passwortgeschützt",
    oneTime: "One-Time",
    descSuffix: " — zum Entschlüsseln öffnen.",
  },
  en: {
    genericTitle: "Encryo · share encrypted",
    genericDesc:
      "End-to-end encrypted file hosting. Files are encrypted in the browser, the server only sees ciphertext.",
    fallbackTitle: "Encrypted files · Encryo",
    fallbackDesc: "Encrypted in the browser — the server only sees ciphertext.",
    fileTitle: (n) => (n === 1 ? "1 encrypted file" : `${n} encrypted files`) + " · Encryo",
    pw: "password-protected",
    oneTime: "one-time",
    descSuffix: " — open to decrypt.",
  },
};

function ogStrings(req) {
  return OG_STRINGS[req.acceptsLanguages("de", "en") === "en" ? "en" : "de"];
}

function ogBlock({ title, description, image, url }) {
  const t = escAttr(title);
  const d = escAttr(description);
  const lines = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Encryo" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
  ];
  if (url) lines.push(`<meta property="og:url" content="${escAttr(url)}" />`);
  if (image) {
    lines.push(`<meta property="og:image" content="${escAttr(image)}" />`);
    lines.push(`<meta name="twitter:card" content="summary_large_image" />`);
  } else {
    lines.push(`<meta name="twitter:card" content="summary" />`);
  }
  return lines.join("\n    ");
}

if (SERVE_BUILD) {
  const TEMPLATE = readFileSync(join(DIST, "index.html"), "utf8");
  const render = (res, og) =>
    res.type("html").send(TEMPLATE.replace("<!--OG-->", og));
  const origin = (req) => `${req.protocol}://${req.get("host")}`;

  // Assets, aber NICHT index.html automatisch (HTML übernehmen wir selbst).
  app.use(express.static(DIST, { index: false }));

  // Pro-Link-Seite: echte Unfurl-Karte (Größe/Flags; Bild nur bei opt-in Vorschau).
  app.get("/v/:id", (req, res) => {
    const L = ogStrings(req);
    const m = db.getLinkMeta(req.params.id);
    let title = L.fallbackTitle;
    let description = L.fallbackDesc;
    let image = null;
    if (m.found) {
      title = L.fileTitle(m.fileCount);
      const parts = [formatBytes(m.totalSize)];
      if (m.passwordProtected) parts.push(L.pw);
      if (m.oneTime) parts.push(L.oneTime);
      description = parts.join(" · ") + L.descSuffix;
      if (m.hasPreview) image = `${origin(req)}/api/links/${req.params.id}/preview`;
    }
    render(res, ogBlock({ title, description, image, url: origin(req) + req.originalUrl }));
  });

  // Übrige SPA-Routen: generische Karte.
  app.get(/^(?!\/api).*/, (req, res) => {
    const L = ogStrings(req);
    render(
      res,
      ogBlock({ title: L.genericTitle, description: L.genericDesc, url: origin(req) + "/" })
    );
  });
} else {
  app.get("/", (_req, res) =>
    res
      .status(200)
      .send("Frontend nicht gebaut. Bitte 'npm run build' ausführen.")
  );
}

// Wartung beim Start + stündlich: abgelaufene Sessions löschen und Ciphertext
// toter Links freigeben.
function maintenance() {
  db.purgeExpiredSessions();
  db.reclaimDeadCiphertext();
  purgeUploadSessions();
}
maintenance();
setInterval(maintenance, 3600_000).unref?.();

app.listen(PORT, () => {
  console.log(`Encryo läuft auf http://localhost:${PORT}`);
});
