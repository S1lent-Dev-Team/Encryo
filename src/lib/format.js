export function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  if (bytes == null) return "–";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatRelative(ts, lang = "de") {
  const en = lang === "en";
  if (!ts) return en ? "never" : "nie";
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const u = en ? { min: "min", h: "h", d: "days" } : { min: "Min", h: "Std", d: "Tage" };
  let label;
  if (mins < 60) label = `${mins} ${u.min}`;
  else if (hours < 48) label = `${hours} ${u.h}`;
  else label = `${days} ${u.d}`;
  if (en) return diff < 0 ? `${label} ago` : `in ${label}`;
  return diff < 0 ? `vor ${label}` : `in ${label}`;
}

export function formatDate(ts, lang = "de") {
  if (!ts) return "–";
  return new Date(ts).toLocaleString(lang === "en" ? "en-US" : "de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
