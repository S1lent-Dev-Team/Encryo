import { useEffect, useState } from "react";

// Rendert den Share-Link als QR-Code (praktisch fürs Teilen aufs Handy).
// 'qrcode' wird dynamisch importiert -> landet nur im Bundle, wenn genutzt.
export default function QrCode({ value, size = 168 }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState(false);

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
    return <div className="text-xs text-muted">QR-Code nicht verfügbar</div>;
  if (!src)
    return (
      <div
        style={{ width: size, height: size }}
        className="animate-pulse rounded-lg bg-panel-2"
      />
    );
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt="QR-Code des Links"
      className="rounded-lg bg-white p-2"
    />
  );
}
