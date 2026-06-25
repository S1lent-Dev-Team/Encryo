#!/usr/bin/env node
// encryo.mjs — CLI für programmatische, zero-knowledge Uploads.
//
// Verschlüsselt Dateien lokal (dieselbe Web-Crypto-Logik wie der Browser) und
// lädt nur Ciphertext hoch. Authentisierung per API-Token (Dashboard → API-Tokens).
//
//   node bin/encryo.mjs upload <datei...> [optionen]
//
// Optionen:
//   --server <url>     Basis-URL (oder env ENCRYO_SERVER), z.B. https://encryo.app
//   --token <token>    API-Token (oder env ENCRYO_TOKEN)
//   --password <pw>    Passwortschutz (Key aus PBKDF2 statt im Link)
//   --no-embed         Passwort NICHT in den Link einbetten (separat teilen)
//   --one-time         Link nach erstem Öffnen verbrennen
//   --max-views <n>    nach n Öffnungen sperren
//   --expire <stunden> Ablauf in Stunden (z.B. 24)
//
// Beispiel:
//   ENCRYO_SERVER=https://encryo.s1lent.dev ENCRYO_TOKEN=enc_… \
//     node bin/encryo.mjs upload bild.png --one-time

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import {
  prepareSecret,
  encryptBytes,
  makeVerifier,
} from "../src/lib/crypto.js";

const MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".pdf": "application/pdf",
  ".txt": "text/plain", ".md": "text/markdown", ".json": "application/json",
  ".csv": "text/csv", ".zip": "application/zip", ".mp4": "video/mp4",
  ".mp3": "audio/mpeg", ".webm": "video/webm",
};

function fail(msg) {
  console.error("Fehler: " + msg);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { files: [], embed: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-embed") out.embed = false;
    else if (a === "--one-time") out.oneTime = true;
    else if (a === "--server") out.server = argv[++i];
    else if (a === "--token") out.token = argv[++i];
    else if (a === "--password") out.password = argv[++i];
    else if (a === "--max-views") out.maxViews = parseInt(argv[++i], 10);
    else if (a === "--expire") out.expire = parseFloat(argv[++i]);
    else if (a.startsWith("--")) fail("unbekannte Option: " + a);
    else out.files.push(a);
  }
  return out;
}

async function upload(opts) {
  const server = (opts.server || process.env.ENCRYO_SERVER || "").replace(/\/+$/, "");
  const token = opts.token || process.env.ENCRYO_TOKEN;
  if (!server) fail("--server oder ENCRYO_SERVER fehlt.");
  if (!token) fail("--token oder ENCRYO_TOKEN fehlt.");
  if (!opts.files.length) fail("keine Datei angegeben.");

  // 1) Secret + 2) Dateien lokal verschlüsseln
  const { key, salt, fragment } = await prepareSecret(opts.password || null);
  const files = [];
  for (const path of opts.files) {
    const buf = await readFile(path);
    const { iv, ciphertext } = await encryptBytes(key, buf);
    files.push({
      filename: basename(path),
      size: buf.length,
      mimetype: MIME[extname(path).toLowerCase()] || "application/octet-stream",
      iv,
      ciphertext,
    });
  }
  const verifier = await makeVerifier(key);

  // 3) Upload (nur Ciphertext + Metadaten); Auth per Bearer-Token
  const res = await fetch(server + "/api/links", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({
      files,
      salt,
      verifier,
      oneTime: !!opts.oneTime,
      expiresInHours: Number.isFinite(opts.expire) ? opts.expire : null,
      passwordProtected: !!opts.password,
      maxViews: Number.isInteger(opts.maxViews) ? opts.maxViews : null,
    }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {}
    fail(msg);
  }
  const { id, expiresAt } = await res.json();

  // 4) Share-Link bauen (Secret bleibt im #-Fragment, nie am Server)
  let url = `${server}/v/${id}`;
  if (opts.password) {
    if (opts.embed) url += `#p.${encodeURIComponent(opts.password)}`;
  } else {
    url += `#k.${fragment}`;
  }

  console.log(url);
  if (opts.password && !opts.embed)
    console.error("(Passwort separat teilen — nicht im Link enthalten.)");
  if (expiresAt)
    console.error("Läuft ab: " + new Date(expiresAt).toLocaleString());
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "upload") {
  upload(parseArgs(rest)).catch((e) => fail(e?.message || String(e)));
} else {
  console.log(
    "encryo — zero-knowledge Upload-CLI\n\n" +
      "  node bin/encryo.mjs upload <datei...> [--server url] [--token tok]\n" +
      "      [--password pw] [--no-embed] [--one-time] [--max-views n] [--expire stunden]\n\n" +
      "  Server/Token auch via ENCRYO_SERVER / ENCRYO_TOKEN."
  );
  process.exit(cmd ? 1 : 0);
}
