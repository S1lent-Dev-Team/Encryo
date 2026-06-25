// crypto.js — alle kryptografischen Operationen laufen im Browser (Web Crypto API).
// Der Server bekommt ausschließlich Ciphertext + IV + (bei Passwort) Salt zu sehen.
//
// Schema:
//   AES-256-GCM für die eigentliche Datei.
//   - Ohne Passwort: zufälliger Key -> wird in den URL-Fragment (#...) gepackt und
//     verlässt damit niemals den Browser über das Netzwerk (Fragmente werden nicht
//     an den Server gesendet).
//   - Mit Passwort: Key wird per PBKDF2 (SHA-256) aus Passwort + zufälligem Salt
//     abgeleitet. Im Fragment steht dann nichts – der Empfänger braucht das Passwort.

const PBKDF2_ITERATIONS = 250_000;
const AES_ALGO = "AES-GCM";
const KEY_LENGTH = 256;

// ---------------------------------------------------------------------------
// Base64URL Helpers (URL-sicher, ohne Padding)
// ---------------------------------------------------------------------------
export function bufToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlToBuf(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

// ---------------------------------------------------------------------------
// Key-Erzeugung & Ableitung
// ---------------------------------------------------------------------------
export async function generateKey() {
  return crypto.subtle.generateKey({ name: AES_ALGO, length: KEY_LENGTH }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function exportKeyToFragment(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bufToB64url(raw);
}

export async function importKeyFromFragment(fragment) {
  const raw = b64urlToBuf(fragment);
  return crypto.subtle.importKey("raw", raw, { name: AES_ALGO }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function deriveKeyFromPassword(password, saltB64url) {
  const salt = b64urlToBuf(saltB64url);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: AES_ALGO, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

export function newSalt() {
  return bufToB64url(randomBytes(16));
}

// Optionaler clientseitiger Passwort-Hash (PBKDF2 -> Bits, kein CryptoKey).
// Das Account-Login hasht serverseitig mit scrypt; diese Hilfsfunktion bleibt
// für clientseitige Ableitungen verfügbar.
export async function hashPassword(password, saltB64url) {
  const salt = b64urlToBuf(saltB64url);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    256
  );
  return bufToB64url(bits);
}

// ---------------------------------------------------------------------------
// Verschlüsseln / Entschlüsseln
// ---------------------------------------------------------------------------
// Gibt { iv, ciphertext } zurück (beide base64url). ArrayBuffer rein, base64url raus,
// damit das Ergebnis JSON-/Storage-tauglich ist.
export async function encryptBytes(key, plaintextBuf) {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: AES_ALGO, iv },
    key,
    plaintextBuf
  );
  return {
    iv: bufToB64url(iv),
    ciphertext: bufToB64url(ciphertext),
  };
}

export async function decryptToBytes(key, ivB64url, ciphertextB64url) {
  const iv = new Uint8Array(b64urlToBuf(ivB64url));
  const plaintext = await crypto.subtle.decrypt(
    { name: AES_ALGO, iv },
    key,
    b64urlToBuf(ciphertextB64url)
  );
  return plaintext; // ArrayBuffer
}

// ---------------------------------------------------------------------------
// High-Level: ein Link = ein Secret (alle Dateien einer Collection teilen Key+Salt)
// ---------------------------------------------------------------------------

// Erzeugt das Link-Secret.
//   - Ohne Passwort: zufälliger Key -> fragment (für die URL), salt === null.
//   - Mit Passwort:  Key aus PBKDF2 -> salt (auf dem Server gespeichert), fragment === null.
export async function prepareSecret(password) {
  if (password) {
    const salt = newSalt();
    const key = await deriveKeyFromPassword(password, salt);
    return { key, salt, fragment: null };
  }
  const key = await generateKey();
  const fragment = await exportKeyToFragment(key);
  return { key, salt: null, fragment };
}

// Verschlüsselt eine einzelne Datei mit dem Link-Key. IV ist pro Datei eindeutig.
export async function encryptFileWith(key, file) {
  const plaintext = await file.arrayBuffer();
  const { iv, ciphertext } = await encryptBytes(key, plaintext);
  return {
    filename: file.name,
    size: file.size,
    mimetype: file.type || "application/octet-stream",
    iv,
    ciphertext,
  };
}

// Stellt den Key aus Fragment (URL) oder Passwort+Salt wieder her.
export async function resolveKey({ salt, fragment, password }) {
  if (salt) {
    if (!password) throw new Error("PASSWORD_REQUIRED");
    return deriveKeyFromPassword(password, salt);
  }
  if (!fragment) throw new Error("KEY_MISSING");
  return importKeyFromFragment(fragment);
}

// Entschlüsselt eine Datei-Payload -> Blob (zum Download/Anzeigen).
export async function decryptToBlob(key, file) {
  const plaintext = await decryptToBytes(key, file.iv, file.ciphertext);
  return new Blob([plaintext], { type: file.mimetype });
}

// ---------------------------------------------------------------------------
// Verifier — erlaubt dem Client, den Key zu prüfen, OHNE etwas zu entschlüsseln.
// Wichtig für One-Time-Links: ein falsches Passwort soll den Link nicht "verbrennen".
// Der Verifier ist eine verschlüsselte Konstante; ohne korrekten Key wertlos.
// ---------------------------------------------------------------------------
const VERIFIER_MAGIC = "encryo-v1";

export async function makeVerifier(key) {
  const buf = new TextEncoder().encode(VERIFIER_MAGIC);
  return encryptBytes(key, buf); // { iv, ciphertext }
}

export async function checkVerifier(key, verifier) {
  if (!verifier) return true; // Altdaten ohne Verifier: nicht blockieren
  try {
    const buf = await decryptToBytes(key, verifier.iv, verifier.ciphertext);
    return new TextDecoder().decode(buf) === VERIFIER_MAGIC;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Recovery-Vault — eine mit dem Account-Passwort verschlüsselte Kopie des
// Link-Secrets, aus der sich der vollständige Share-Link rekonstruieren lässt.
// Der Wrapping-Key wird wie ein Passwort-Key per PBKDF2 abgeleitet (gleicher
// Mechanismus wie ein Datei-Passwort, nur mit dem Account-Recovery-Salt).
// ---------------------------------------------------------------------------
export const deriveRecoveryKey = deriveKeyFromPassword;

// Verschlüsselt ein Secret-Objekt ({ t: "k"|"p", v }) -> { iv, ciphertext }.
export async function wrapSecret(recoveryKey, obj) {
  const buf = new TextEncoder().encode(JSON.stringify(obj));
  return encryptBytes(recoveryKey, buf);
}

// Macht wrapSecret rückgängig -> das ursprüngliche Secret-Objekt.
export async function unwrapSecret(recoveryKey, blob) {
  const buf = await decryptToBytes(recoveryKey, blob.iv, blob.ciphertext);
  return JSON.parse(new TextDecoder().decode(buf));
}
