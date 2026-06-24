import { Icon } from "./ui.jsx";
import { formatBytes, formatRelative } from "../lib/format.js";

// Discord-/Slack-Style "Unfurl"-Vorschaukarte: zeigt, wie der Link beim Teilen
// aussieht. Bei eingebettetem Key + Bild rendern wir die echte Thumbnail
// (der Uploader hat die Datei lokal) — exakt das, was ein Empfänger sieht.
export default function SharePreview({
  url,
  fileCount,
  totalSize,
  oneTime,
  passwordProtected,
  expiresAt,
  imageUrl,
}) {
  let host = "encryo.app";
  try {
    host = new URL(url).host;
  } catch {}

  const title =
    fileCount === 1 ? "Verschlüsselte Datei" : `${fileCount} verschlüsselte Dateien`;

  const parts = [`${fileCount} ${fileCount === 1 ? "Datei" : "Dateien"}`, formatBytes(totalSize)];
  if (passwordProtected) parts.push("passwortgeschützt");
  if (oneTime) parts.push("One-Time");
  if (expiresAt) parts.push(`läuft ab ${formatRelative(expiresAt)}`);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-[#2b2d31]">
      {/* Discord rendert einen farbigen Balken links + Embed-Inhalt */}
      <div className="flex gap-3 border-l-[3px] border-brand p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] text-[#b5bac1]">
            <Icon.shield className="text-brand" /> {host}
          </div>
          <div className="mt-1 text-sm font-semibold text-[#dbdee1]">{title}</div>
          <div className="mt-0.5 text-xs text-[#b5bac1]">{parts.join(" · ")}</div>
        </div>
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            className="h-16 w-16 shrink-0 rounded-md object-cover"
          />
        )}
      </div>
    </div>
  );
}
