// recovery.js — In-Memory-Halter für den Account-Recovery-Key.
//
// Der Recovery-Key (ein CryptoKey, abgeleitet aus Account-Passwort + recovery_salt)
// wird NUR im Speicher gehalten — niemals in localStorage/sessionStorage. Nach
// Login/Register ist er da (wir hatten gerade das Passwort); nach einem Reload
// (Cookie-Session ohne Passwort) ist er weg und muss durch erneute Eingabe des
// Account-Passworts rekonstruiert werden.

import { deriveRecoveryKey } from "./crypto.js";

let _salt = null; // base64url-Salt des aktuellen Users (nicht geheim)
let _key = null; // CryptoKey oder null

export function setRecoverySalt(salt) {
  // Wechselt der User (anderes Salt), wird ein evtl. gecachter Key ungültig.
  if (salt !== _salt) _key = null;
  _salt = salt || null;
}

export function getRecoverySalt() {
  return _salt;
}

export function setRecoveryKey(key) {
  _key = key || null;
}

export function getRecoveryKey() {
  return _key;
}

// Leitet den Recovery-Key aus dem Account-Passwort ab und cached ihn.
// Wirft, wenn kein Salt bekannt ist (dann ist der Auth-Status noch nicht geladen).
export async function ensureRecoveryKey(password) {
  if (!_salt) throw new Error("RECOVERY_SALT_MISSING");
  _key = await deriveRecoveryKey(password, _salt);
  return _key;
}

export function clearRecovery() {
  _key = null;
  _salt = null;
}
