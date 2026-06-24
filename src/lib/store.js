// store.js — Datenlayer gegen das echte Backend (Express + SQLite).
// Verschlüsselung passiert weiterhin komplett im Browser; hier geht nur
// Ciphertext + Metadaten über die Leitung. Der Key (im #-Fragment) und das
// Datei-Passwort werden NIE an den Server gesendet.

const API = "/api";

async function req(path, opts = {}) {
  const res = await fetch(API + path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* leere Antwort */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// POST /api/links  — legt einen Link an, Server vergibt die ID.
// opts: { files, salt, verifier, oneTime, expiresInHours, passwordProtected }
export async function createLink(opts) {
  return req("/links", { method: "POST", body: JSON.stringify(opts) });
}

// GET /api/links/:id — öffentliche Metadaten (ohne Ciphertext, nicht destruktiv).
export async function getLinkMeta(id) {
  return req(`/links/${encodeURIComponent(id)}`);
}

// POST /api/links/:id/open — atomar: view_count++, ggf. burn. Liefert Ciphertext.
export async function openLink(id) {
  return req(`/links/${encodeURIComponent(id)}/open`, { method: "POST" });
}

// DELETE /api/links/:id — nur als Owner (Session).
export async function deleteLink(id) {
  return req(`/links/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// POST /api/links/:id/revoke — Kill-Switch, sperrt den Link sofort (nur Owner).
export async function revokeLink(id) {
  return req(`/links/${encodeURIComponent(id)}/revoke`, { method: "POST" });
}

// GET /api/links/:id/recovery — verschlüsselter Recovery-Vault (nur Owner).
export async function getLinkRecovery(id) {
  return req(`/links/${encodeURIComponent(id)}/recovery`);
}

// GET /api/links — eigene Links (erfordert Login). Wirft bei 401.
export async function listMyLinks() {
  return req("/links");
}
