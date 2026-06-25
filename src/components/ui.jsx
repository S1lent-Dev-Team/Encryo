// ui.jsx — wiederverwendbare, bewusst zurückhaltende UI-Primitive.

import { createContext, useCallback, useContext, useState } from "react";
import { useI18n } from "../lib/i18n.js";

export function Card({ className = "", children }) {
  return (
    <div
      className={
        "rounded-xl border border-line bg-panel " +
        "shadow-[0_1px_0_0_rgba(255,255,255,0.02)_inset,0_8px_24px_-16px_rgba(0,0,0,0.7)] " +
        className
      }
    >
      {children}
    </div>
  );
}

export function Button({ children, variant = "primary", className = "", ...props }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium " +
    "transition-colors duration-150 active:translate-y-px disabled:opacity-40 disabled:pointer-events-none select-none";
  const variants = {
    primary: "bg-text text-ink hover:bg-white",
    accent: "bg-brand text-ink hover:brightness-105",
    outline: "border border-line-2 text-text hover:bg-panel-2",
    ghost: "text-muted hover:text-text hover:bg-panel-2",
    danger: "text-danger hover:bg-danger/10",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Input(props) {
  return (
    <input
      {...props}
      className={
        "w-full rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm text-text " +
        "outline-none placeholder:text-faint transition-colors focus:border-line-2 " +
        (props.className || "")
      }
    />
  );
}

// Passwortfeld mit Auge-Toggle (Anzeigen/Verbergen). Reicht alle übrigen Props
// (value, onChange, onKeyDown, placeholder, autoFocus, autoComplete …) an Input
// durch — ist also ein Drop-in-Ersatz für <Input type="password" />.
export function PasswordInput({ className = "", ...props }) {
  const [show, setShow] = useState(false);
  const { t } = useI18n();
  return (
    <div className="relative">
      <Input
        {...props}
        type={show ? "text" : "password"}
        className={"pr-10 " + className}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        tabIndex={-1}
        aria-label={show ? t("pw.hide") : t("pw.show")}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-faint transition-colors hover:text-text"
      >
        {show ? <Icon.eyeOff /> : <Icon.eye />}
      </button>
    </div>
  );
}

// Heuristischer Stärke-Indikator (0–4) — bewusst ohne externe Dependency.
// Bewertet Länge und Zeichenklassen; soll grob lenken, kein echtes Audit sein.
export function scorePassword(pw = "") {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  const classes =
    (/[a-z]/.test(pw) ? 1 : 0) +
    (/[A-Z]/.test(pw) ? 1 : 0) +
    (/[0-9]/.test(pw) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(pw) ? 1 : 0);
  if (classes >= 2) s++;
  if (classes >= 3) s++;
  return Math.min(4, s);
}

export function PasswordStrength({ password = "" }) {
  const { t } = useI18n();
  if (!password) return null;
  const score = scorePassword(password);
  const colors = [
    "bg-danger",
    "bg-danger",
    "bg-yellow-500",
    "bg-brand",
    "bg-brand",
  ];
  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={
              "h-1 flex-1 rounded-full transition-colors " +
              (i < score ? colors[score] : "bg-line-2")
            }
          />
        ))}
      </div>
      <p className="mt-1 text-[11px] text-muted">
        {t("pw.strength.label", { level: t(`pw.strength.${score}`) })}
      </p>
    </div>
  );
}

// Erzeugt ein starkes Zufallspasswort (CSPRNG). Eindeutige Zeichen, gut lesbar.
export function generatePassword(len = 20) {
  const charset =
    "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += charset[bytes[i] % charset.length];
  return out;
}

export function Toggle({ checked, onChange, label, hint, icon }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span className="flex items-start gap-2.5">
        {icon && <span className="mt-0.5 text-muted">{icon}</span>}
        <span>
          <span className="block text-sm font-medium text-text">{label}</span>
          {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={
          "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors " +
          (checked ? "bg-brand" : "bg-line-2")
        }
      >
        <span
          className={
            "absolute top-0.5 h-4 w-4 rounded-full bg-ink transition-all " +
            (checked ? "left-[18px]" : "left-0.5")
          }
        />
      </button>
    </label>
  );
}

export function Badge({ children, tone = "default" }) {
  const tones = {
    default: "bg-panel-2 text-muted border-line",
    brand: "bg-brand/10 text-brand border-brand/25",
    accent: "bg-brand/10 text-brand border-brand/25",
    danger: "bg-danger/10 text-danger border-danger/25",
  };
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium " +
        tones[tone]
      }
    >
      {children}
    </span>
  );
}

export function Spinner({ size = 16, className = "" }) {
  return (
    <span
      style={{ width: size, height: size }}
      className={
        "inline-block animate-spin rounded-full border-2 border-current/25 border-t-current " +
        className
      }
    />
  );
}

// ---- Icons (inline SVG, currentColor) -------------------------------------
// Größe über `size` (Pixel, default 16) — als width/height-Attribut, damit ein
// übergebenes className die Größe NICHT mehr überschreibt. Farbe via className.
const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};
const make = (children) =>
  function I({ size = 16, className = "", ...rest }) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={"inline-block shrink-0 " + className}
        {...STROKE}
        {...rest}
      >
        {children}
      </svg>
    );
  };

export const Icon = {
  lock: make(<><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></>),
  unlock: make(<><rect x="4.5" y="10.5" width="15" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 7.5-1.9" /></>),
  fire: make(<path d="M12 3s4 3.5 4 8a4 4 0 0 1-8 0c0-1.5.5-2.5.5-2.5S6 11 6 14a6 6 0 0 0 12 0c0-5-6-11-6-11Z" />),
  clock: make(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  eye: make(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>),
  copy: make(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>),
  check: make(<path d="m5 13 4 4L19 7" strokeWidth="2" />),
  upload: make(<><path d="M12 16V4m0 0 4 4m-4-4-4 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>),
  download: make(<><path d="M12 4v12m0 0 4-4m-4 4-4-4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>),
  file: make(<><path d="M14 3v5h5" /><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-5Z" /></>),
  trash: make(<path d="M4.5 7h15M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 .8 12h6.4L17 7" />),
  x: make(<path d="M6 6l12 12M18 6 6 18" />),
  shield: make(<><path d="M12 3.5l7 2.5v5c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-2.5Z" /><path d="m9.2 12 2 2 3.6-3.6" /></>),
  user: make(<><circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5a7 7 0 0 1 14 0" /></>),
  logout: make(<><path d="M14 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M9 12h11m0 0-3-3m3 3-3 3" /></>),
  qr: make(<><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2v2m4 0v4m-6 0h2" /></>),
  link: make(<><path d="M9 15l6-6" /><path d="M11 7.5 12.8 5.7a3.5 3.5 0 0 1 5 5L16 12.5" /><path d="M13 16.5 11.2 18.3a3.5 3.5 0 0 1-5-5L8 11.5" /></>),
  external: make(<><path d="M14 5h5v5m0-5-7 7" /><path d="M19 14v3a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3" /></>),
  plus: make(<path d="M12 5v14M5 12h14" />),
  history: make(<><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M5 4v3.5h3.5" /><path d="M12 8v4l3 1.5" /></>),
  image: make(<><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m5 17 4-4 4 4 3-3 3 3" /></>),
  bolt: make(<path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z" />),
  eyeOff: make(<><path d="M3 3l18 18" /><path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.4 3.1" /><path d="M6.5 7.6A15.8 15.8 0 0 0 2.5 12S6 18 12 18a9.3 9.3 0 0 0 3.6-.7" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>),
  key: make(<><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2 20 3m-3 0 3 3m-6 0 2.5 2.5" /></>),
  ban: make(<><circle cx="12" cy="12" r="8.5" /><path d="m6 6 12 12" /></>),
  refresh: make(<><path d="M20 11a8 8 0 0 0-14.3-4.4M4 4v3.5H7.5" /><path d="M4 13a8 8 0 0 0 14.3 4.4M20 20v-3.5H16.5" /></>),
  share: make(<><circle cx="6" cy="12" r="2.5" /><circle cx="17" cy="6" r="2.5" /><circle cx="17" cy="18" r="2.5" /><path d="m8.2 10.8 6.6-3.6M8.2 13.2l6.6 3.6" /></>),
  search: make(<><circle cx="11" cy="11" r="6" /><path d="m20 20-3.6-3.6" /></>),
  expand: make(<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />),
  sun: make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  moon: make(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />),
  chevronUp: make(<path d="m6 15 6-6 6 6" />),
  chevronDown: make(<path d="m6 9 6 6 6-6" />),
  chevronLeft: make(<path d="m15 6-6 6 6 6" />),
  chevronRight: make(<path d="m9 6 6 6-6 6" />),
  pencil: make(<><path d="M4 20h4l10-10-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></>),
  terminal: make(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>),
  dots: make(
    <>
      <circle cx="12" cy="5" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.7" fill="currentColor" stroke="none" />
    </>
  ),
};

// ---- Toasts ---------------------------------------------------------------
// Leichtgewichtiges, kontextbasiertes Toast-System. useToast() liefert eine
// push(message, tone)-Funktion (tone: "success" | "error" | "default").
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, tone = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  const tones = {
    success: "border-brand/30 bg-brand/15 text-brand",
    error: "border-danger/30 bg-danger/15 text-danger",
    default: "border-line-2 bg-panel-2 text-text",
  };

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={
              "animate-in flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium shadow-lg backdrop-blur " +
              (tones[t.tone] || tones.default)
            }
          >
            {t.tone === "error" ? <Icon.x size={15} /> : <Icon.check size={15} />}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
