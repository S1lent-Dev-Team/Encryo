// prefs.js — merkt sich zuletzt genutzte UI-Optionen (Ablauf, Secret einbetten …)
// in localStorage. Hier landen NUR Oberflächen-Vorlieben — niemals Schlüssel,
// Passwörter oder Session-Daten. Das berührt das Zero-Knowledge-Modell nicht.

const KEY = "encryo:prefs";

const DEFAULTS = {
  embedSecret: true,
  useExpiry: false,
  expiry: "24",
  limitMaxViews: false,
  oneTime: false,
};

export function loadPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs) {
  try {
    const slim = {};
    for (const k of Object.keys(DEFAULTS)) slim[k] = prefs[k];
    localStorage.setItem(KEY, JSON.stringify(slim));
  } catch {
    /* localStorage nicht verfügbar (z.B. privater Modus) — kein Drama */
  }
}
