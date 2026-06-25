import { Icon } from "./ui.jsx";
import { formatBytes, formatRelative } from "../lib/format.js";
import { useI18n } from "../lib/i18n.js";

// Discord-Style "Unfurl"-Vorschaukarte: zeigt, wie der Link beim Teilen
// aussieht — exakt wie die serverseitig injizierten OG-Tags (siehe
// server/index.js). Ein großes Embed-Bild erscheint nur, wenn der Uploader die
// öffentliche Vorschau aktiviert hat (imageUrl gesetzt); sonst eine reine
// Metadaten-Karte (Größe/Schutz), ohne Bild.
export default function SharePreview({
  url,
  fileCount,
  totalSize,
  oneTime,
  passwordProtected,
  expiresAt,
  imageUrl,
}) {
  const { t, lang } = useI18n();
  let host = "encryo.app";
  try {
    host = new URL(url).host;
  } catch {}

  const title =
    fileCount === 1 ? t("share.title.one") : t("share.title.other", { n: fileCount });

  const parts = [formatBytes(totalSize)];
  if (passwordProtected) parts.push(t("share.passwordProtected"));
  if (oneTime) parts.push(t("share.oneTime"));
  if (expiresAt) parts.push(t("share.expiresAt", { rel: formatRelative(expiresAt, lang) }));

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-[#2b2d31]">
      <div className="border-l-4 border-brand p-3">
        <div className="flex items-center gap-1.5 text-[11px] text-[#b5bac1]">
          <Icon.shield className="text-brand" /> {host}
        </div>
        <div className="mt-1 text-sm font-semibold text-[#00a8fc]">{title}</div>
        <div className="mt-1 text-xs leading-relaxed text-[#dbdee1]">
          {t("share.body")}
        </div>
        <div className="mt-1.5 text-[11px] text-[#b5bac1]">{parts.join(" · ")}</div>
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            className="mt-3 max-h-64 w-full rounded-md object-cover"
          />
        )}
      </div>
    </div>
  );
}
