// limits.js — geteilte Upload-Limits. Wird vom Client (UX/Anzeige) UND vom
// Server (autoritative Prüfung) importiert, damit beide Seiten identisch
// rechnen. Bewusst frei von Browser-/Node-spezifischen APIs.
//
// Modell:
//   - Ohne Account: bis FREE Speicher pro Link, beliebig haltbar. Darüber nicht
//     erlaubt → ein Account ist nötig (höhere Dateien nur mit Account).
//   - Mit Account: bis FREE beliebig haltbar; darüber (bis HARD) weiterhin
//     erlaubt, aber der Ablauf wird automatisch auf max. FORCED_EXPIRY_HOURS
//     begrenzt. Über HARD wird abgelehnt.

const MB = 1024 * 1024;

export const LIMITS = {
  anon: { free: 50 * MB, hard: 100 * MB },
  account: { free: 100 * MB, hard: 500 * MB },
};

// Ablauf-Obergrenze (Stunden) für Uploads über dem Freikontingent.
export const FORCED_EXPIRY_HOURS = 24;

// Gesamt-Kontingent pro Account (Missbrauchs-/Speicherschutz). Anonyme Uploads
// werden über Rate-Limits + das Pro-Link-Limit eingehegt.
export const ACCOUNT_QUOTA = {
  maxLinks: 200,
  maxTotal: 8192 * MB, // 8GB Frei für jeden Account
};

// -> { ok, reason? }  (reason: "LINK_LIMIT" | "STORAGE_LIMIT")
export function checkAccountQuota({ currentLinks, currentBytes, addBytes }) {
  if (currentLinks >= ACCOUNT_QUOTA.maxLinks) return { ok: false, reason: "LINK_LIMIT" };
  if (currentBytes + addBytes > ACCOUNT_QUOTA.maxTotal)
    return { ok: false, reason: "STORAGE_LIMIT" };
  return { ok: true };
}

export function limitsFor(isLoggedIn) {
  return isLoggedIn ? LIMITS.account : LIMITS.anon;
}

// Entscheidet, ob ein Upload erlaubt ist und ob ein Ablauf erzwungen wird.
// -> { ok, reason?, forced? }  (reason: "NEED_ACCOUNT" | "TOO_BIG")
export function checkUpload({ totalSize, isLoggedIn }) {
  const { free, hard } = limitsFor(isLoggedIn);
  if (totalSize > hard)
    return { ok: false, reason: isLoggedIn ? "TOO_BIG" : "NEED_ACCOUNT" };
  if (totalSize > free) return { ok: true, forced: true };
  return { ok: true, forced: false };
}

// Wendet die Ablauf-Obergrenze an: über dem Freikontingent wird auf höchstens
// FORCED_EXPIRY_HOURS gedeckelt (kürzere Nutzerwahl bleibt erhalten, "nie"/länger
// wird auf 24 Std gesetzt).
export function effectiveExpiryHours({ totalSize, isLoggedIn, requestedHours }) {
  const { free } = limitsFor(isLoggedIn);
  if (totalSize > free)
    return Math.min(requestedHours ?? Infinity, FORCED_EXPIRY_HOURS);
  return requestedHours ?? null;
}
