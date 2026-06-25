import { useEffect, useState } from "react";
import { Icon } from "./ui.jsx";
import { useI18n } from "../lib/i18n.js";

// Rendert den Share-Link als QR-Code (praktisch fürs Teilen aufs Handy).
// 'qrcode' wird dynamisch importiert -> landet nur im Bundle, wenn genutzt.
// downloadName: ist es gesetzt, erscheint ein "PNG speichern"-Button.
export default function QrCode({ value, size = 168, downloadName }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    let alive = true;
    import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(value, {
          margin: 1,
          width: size,
          color: { dark: "#0a0b0d", light: "#ffffff" },
        })
      )
      .then((d) => alive && setSrc(d))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [value, size]);

  if (err)
    return <div className="text-xs text-muted">{t("qr.unavailable")}</div>;
  if (!src)
    return (
      <div
        style={{ width: size, height: size }}
        className="animate-pulse rounded-lg bg-panel-2"
      />
    );
  return (
    <div className="flex flex-col items-center gap-2">
      <img
        src={src}
        width={size}
        height={size}
        alt="QR-Code des Links"
        className="rounded-lg bg-white p-2"
      />
      {downloadName && (
        <a
          href={src}
          download={downloadName}
          className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-text"
        >
          <Icon.download size={13} /> {t("qr.savePng")}
        </a>
      )}
    </div>
  );
}
