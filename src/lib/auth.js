// auth.js — Account-System gegen das Backend (httpOnly-Cookie-Session).
// Kein localStorage. Das Account-Passwort wird serverseitig (scrypt) gehasht;
// es ist unabhängig vom Datei-Passwort, das den Server nie erreicht.

import {
  setRecoverySalt,
  setRecoveryKey,
  clearRecovery,
  ensureRecoveryKey,
} from "./recovery.js";
import { deriveRecoveryKey } from "./crypto.js";

const API = "/api/auth";

async function post(path, body) {
  const res = await fetch(API + path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function announce() {
  window.dispatchEvent(new Event("encryo:auth"));
}

// Recovery-Key direkt nach Login/Register ableiten — hier haben wir das Passwort
// noch im Klartext (im Browser). Danach lebt nur der abgeleitete Key im Speicher.
async function primeRecovery(password, recoverySalt) {
  if (!recoverySalt) return;
  setRecoverySalt(recoverySalt);
  try {
    setRecoveryKey(await deriveRecoveryKey(password, recoverySalt));
  } catch {
    /* nicht fatal: Recovery lässt sich später per Passwort-Eingabe nachholen */
  }
}

export async function register(username, password) {
  const r = await post("/register", { username, password });
  await primeRecovery(password, r.recoverySalt);
  announce();
  return r;
}

export async function login(username, password) {
  const r = await post("/login", { username, password });
  await primeRecovery(password, r.recoverySalt);
  announce();
  return r;
}

export async function logout() {
  await post("/logout");
  clearRecovery();
  announce();
}

// Account-Passwort ändern. `rewrapItems` sind die mit dem NEUEN Passwort
// re-verschlüsselten Recovery-Vaults (clientseitig erzeugt, siehe DashboardPage).
export async function changeAccountPassword(currentPassword, newPassword, rewrapItems) {
  const r = await post("/password", {
    currentPassword,
    newPassword,
    items: rewrapItems || [],
  });
  // Gecachten Recovery-Key auf das neue Passwort umstellen. Schlägt das fehl
  // (z.B. Salt noch nicht geladen), ist das nicht fatal — der Wechsel ist bereits
  // serverseitig durch; Recovery lässt sich danach per Passwort-Eingabe nachholen.
  try {
    await ensureRecoveryKey(newPassword);
  } catch {
    /* ignorieren */
  }
  return r;
}

// --- API-Tokens (für CLI/Skripte) ------------------------------------------
export async function listTokens() {
  const res = await fetch(API + "/tokens", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function createToken(label) {
  return post("/tokens", { label });
}

export async function deleteToken(id) {
  const res = await fetch(API + "/tokens/" + encodeURIComponent(id), {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Aktueller User laut Session-Cookie (oder null). Cached nebenbei das
// Recovery-Salt (nicht geheim), damit Recovery nach Reload per Passwort-Eingabe
// rekonstruiert werden kann.
export async function fetchMe() {
  try {
    const res = await fetch(API + "/me", { credentials: "same-origin" });
    const data = await res.json();
    if (data.username) setRecoverySalt(data.recoverySalt || null);
    else clearRecovery();
    return data.username || null;
  } catch {
    return null;
  }
}
