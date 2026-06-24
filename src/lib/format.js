export function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  if (bytes == null) return "–";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatRelative(ts) {
  if (!ts) return "nie";
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  let label;
  if (mins < 60) label = `${mins} Min`;
  else if (hours < 48) label = `${hours} Std`;
  else label = `${days} Tage`;
  return diff < 0 ? `vor ${label}` : `in ${label}`;
}

export function formatDate(ts) {
  if (!ts) return "–";
  return new Date(ts).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
