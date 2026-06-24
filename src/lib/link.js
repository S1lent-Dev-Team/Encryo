// link.js — baut/zerlegt Share-URLs.
//
// Das Secret steht im URL-Fragment (#…). Fragmente werden vom Browser NICHT an
// den Server gesendet -> der Server kann selbst dann nicht entschlüsseln, wenn er
// den kompletten Request-Pfad loggt.
//
// Fragment-Formate:
//   #k.<rawKey>           Key direkt im Link (Link ohne Passwort)
//   #p.<password>         Passwort im Link eingebettet (Sofort-Vorschau)
//   (kein Fragment)       Empfänger muss das Passwort selbst eingeben

export function buildShareUrl(id, { key, password } = {}) {
  const base = `${window.location.origin}/v/${id}`;
  if (key) return `${base}#k.${key}`;
  if (password) return `${base}#p.${encodeURIComponent(password)}`;
  return base;
}

// Liest das Secret aus dem aktuellen Fragment.
// -> { type: "key" | "password" | null, value }
export function parseFragment() {
  const h = window.location.hash;
  if (!h || h.length < 2) return { type: null, value: null };
  const raw = h.slice(1);
  if (raw.startsWith("k.")) return { type: "key", value: raw.slice(2) };
  if (raw.startsWith("p.")) return { type: "password", value: decodeURIComponent(raw.slice(2)) };
  // Fallback: blanker Key ohne Präfix (Altlinks)
  return { type: "key", value: raw };
}
