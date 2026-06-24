// index.js — Express-Server: REST-API + Auslieferung des gebauten Frontends.
// Ein Prozess, ein Port -> deploybar (z.B. Railway). Der Server sieht nie Klartext.

import express from "express";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import * as db from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "dist");
const PORT = process.env.PORT || 8787;
const COOKIE = "encryo_sid";

const app = express();
app.use(express.json({ limit: "64mb" })); // Ciphertext ist base64 -> großzügig
app.use(cookieParser());

// ------- Auth-Middleware (Cookie-Session) ----------------------------------
app.use("/api", (req, _res, next) => {
  req.user = db.getSessionUser(req.cookies[COOKIE]);
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
app.post("/api/auth/register", (req, res) => {
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

app.post("/api/auth/login", (req, res) => {
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
app.post("/api/auth/password", requireAuth, (req, res) => {
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

// ------- Link-Routen -------------------------------------------------------
app.post("/api/links", (req, res) => {
  const {
    files,
    salt,
    verifier,
    oneTime,
    expiresInHours,
    passwordProtected,
    maxViews,
    recovery,
  } = req.body || {};
  if (!Array.isArray(files) || files.length === 0)
    return res.status(400).json({ error: "Keine Dateien." });
  for (const f of files) {
    if (!f.iv || !f.ciphertext || typeof f.filename !== "string")
      return res.status(400).json({ error: "Ungültige Datei-Payload." });
  }
  const total = files.reduce((s, f) => s + (f.size || 0), 0);
  if (total > 25 * 1024 * 1024)
    return res.status(413).json({ error: "Maximal 25 MB pro Link." });

  const { id } = db.createLink({
    files,
    salt: salt || null,
    verifier: verifier || null,
    oneTime: !!oneTime,
    expiresInHours: expiresInHours || null,
    passwordProtected: !!passwordProtected,
    maxViews: Number.isInteger(maxViews) ? maxViews : null,
    recovery: recovery && recovery.iv && recovery.ciphertext ? recovery : null,
    ownerId: req.user ? req.user.id : null,
  });
  res.json({ id });
});

app.get("/api/links/:id", (req, res) => {
  res.json(db.getLinkMeta(req.params.id));
});

app.post("/api/links/:id/open", (req, res) => {
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
if (existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(DIST, "index.html")));
} else {
  app.get("/", (_req, res) =>
    res
      .status(200)
      .send("Frontend nicht gebaut. Bitte 'npm run build' ausführen.")
  );
}

app.listen(PORT, () => {
  console.log(`Encryo läuft auf http://localhost:${PORT}`);
});
