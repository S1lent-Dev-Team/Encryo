import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Dropzone from "../components/Dropzone.jsx";
import SharePreview from "../components/SharePreview.jsx";
import QrCode from "../components/QrCode.jsx";
import {
  Card,
  Button,
  Toggle,
  Input,
  PasswordInput,
  PasswordStrength,
  generatePassword,
  Badge,
  Icon,
  Spinner,
  useToast,
} from "../components/ui.jsx";
import { prepareSecret, encryptFileWith, makeVerifier, wrapSecret } from "../lib/crypto.js";
import { startUpload, uploadChunks, completeUpload, uploadTotalChars } from "../lib/store.js";
import { buildShareUrl } from "../lib/link.js";
import { formatBytes, formatRelative } from "../lib/format.js";
import { useCurrentUser } from "../lib/useAuth.js";
import { getRecoveryKey } from "../lib/recovery.js";
import { login } from "../lib/auth.js";
import { limitsFor, checkUpload, FORCED_EXPIRY_HOURS } from "../lib/limits.js";
import { loadPrefs, savePrefs } from "../lib/prefs.js";
import { useI18n } from "../lib/i18n.js";

const EXPIRY_OPTIONS = [
  { key: "1", hours: 1, label: "upload.expiry.1h" },
  { key: "24", hours: 24, label: "upload.expiry.24h" },
  { key: "168", hours: 168, label: "upload.expiry.7d" },
];

let _uid = 0;
const nextId = () => ++_uid;

// "YYYY-MM-DDTHH:MM" in lokaler Zeit (für <input type="datetime-local">).
function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Restzeit menschenlesbar ("45 s" / "2:05 min").
function fmtEta(sec) {
  if (sec == null || !isFinite(sec)) return "…";
  sec = Math.max(0, Math.ceil(sec));
  if (sec < 60) return sec + " s";
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, "0")} min`;
}

// Verkleinert große Bilder vor der Verschlüsselung (max. 2560px, JPEG ~0.85).
// Gibt das Original zurück, wenn keine Ersparnis entsteht oder der Typ ungeeignet
// ist (GIF/SVG bleiben unangetastet). Läuft komplett im Browser.
async function compressImage(file, maxDim = 2560, quality = 0.85) {
  if (!file.type.startsWith("image/")) return file;
  if (file.type === "image/gif" || file.type === "image/svg+xml") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file; // keine Ersparnis -> Original
    return new File([blob], file.name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

// Erzeugt aus einem Bild ein verkleinertes JPEG-Thumbnail (base64) für die
// optionale ÖFFENTLICHE Unfurl-Vorschau. Läuft komplett im Browser.
async function makeThumbnail(file, max = 800) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const data = canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
  return { mime: "image/jpeg", data };
}

export default function UploadPage() {
  const { user } = useCurrentUser();
  const { t } = useI18n();
  const toast = useToast();
  const [p0] = useState(loadPrefs);

  // items: { id, file, name } — name ist umbenennbar, Reihenfolge sortierbar.
  const [items, setItems] = useState([]);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [embedSecret, setEmbedSecret] = useState(p0.embedSecret);
  const [oneTime, setOneTime] = useState(p0.oneTime);
  const [useExpiry, setUseExpiry] = useState(p0.useExpiry);
  const [expiry, setExpiry] = useState(p0.expiry);
  const [customExpiry, setCustomExpiry] = useState("");
  const [limitMaxViews, setLimitMaxViews] = useState(p0.limitMaxViews);
  const [maxViews, setMaxViews] = useState("");
  const [publicPreview, setPublicPreview] = useState(false);
  const [viewProtect, setViewProtect] = useState(p0.viewProtect);
  const [compressImages, setCompressImages] = useState(p0.compressImages);
  const [recover, setRecover] = useState(false);
  const [accountPw, setAccountPw] = useState("");

  const [status, setStatus] = useState("idle"); // idle | working | paused | done
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(null); // Bytes/s
  const [uploadEta, setUploadEta] = useState(null); // Sekunden
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const busyRef = useRef(false);
  const submitRef = useRef(() => {});
  const abortRef = useRef(null); // AbortController des laufenden Uploads
  const pendingRef = useRef(null); // Resume-Kontext { uploadId, payloads, opts, … }
  const speedRef = useRef({ t: null, b: 0, ema: null });

  useEffect(() => {
    savePrefs({ embedSecret, useExpiry, expiry, limitMaxViews, oneTime, compressImages, viewProtect });
  }, [embedSecret, useExpiry, expiry, limitMaxViews, oneTime, compressImages, viewProtect]);

  // Bilder/Dateien per Strg+V (Screenshot) und ⌘/Strg+Enter zum Verschlüsseln.
  useEffect(() => {
    function onPaste(e) {
      if (busyRef.current) return;
      const f = e.clipboardData?.files;
      if (f && f.length) addFiles(Array.from(f));
    }
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        submitRef.current();
      }
    }
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Vor versehentlichem Verlassen während Verschlüsselung/Upload warnen.
  useEffect(() => {
    if (status !== "working" && status !== "paused") return;
    function onBeforeUnload(e) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [status]);

  const isLoggedIn = !!user;
  const { free, hard } = limitsFor(isLoggedIn);
  const totalSize = items.reduce((s, it) => s + it.file.size, 0);
  const check = checkUpload({ totalSize, isLoggedIn });
  const blocked = items.length > 0 && !check.ok;
  const needAccount = blocked && check.reason === "NEED_ACCOUNT";
  const overFree = check.ok && check.forced; // erlaubt, aber Ablauf wird gedeckelt
  const firstImage = items.find((it) => it.file.type.startsWith("image/"));

  // Nach Reload (Cookie-Session) liegt der Recovery-Key nicht im Speicher.
  const needAccountPw = recover && !!user && !getRecoveryKey();

  function addFiles(incoming) {
    setError("");
    setItems((prev) => {
      const seen = new Set(prev.map((it) => it.file.name + it.file.size));
      const merged = [...prev];
      for (const f of incoming)
        if (!seen.has(f.name + f.size)) merged.push({ id: nextId(), file: f, name: f.name });
      return merged;
    });
  }
  const removeFile = (id) => setItems((prev) => prev.filter((it) => it.id !== id));
  const renameFile = (id, name) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, name } : it)));
  function moveFile(idx, dir) {
    setItems((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  async function handleUpload() {
    setError("");
    if (!items.length) return setError(t("upload.err.noFile"));
    if (usePassword && password.length < 4) return setError(t("upload.err.pwShort"));
    if (!check.ok)
      return setError(
        check.reason === "NEED_ACCOUNT"
          ? t("upload.err.needAccount", { hard: formatBytes(hard) })
          : t("upload.err.tooBig", { hard: formatBytes(hard) })
      );
    const mv = limitMaxViews && maxViews.trim() ? parseInt(maxViews, 10) : null;
    if (limitMaxViews && (mv === null || !Number.isInteger(mv) || mv < 1))
      return setError(t("upload.err.maxViews"));
    // Custom-Ablauf muss in der Zukunft liegen.
    if (useExpiry && expiry === "custom") {
      const ts = customExpiry ? new Date(customExpiry).getTime() : NaN;
      if (!Number.isFinite(ts) || ts <= Date.now()) return setError(t("upload.err.expiryPast"));
    }

    try {
      busyRef.current = true;
      setStatus("working");
      setProgress({ done: 0, total: items.length });
      setUploadPct(0);

      // 0) Recovery-Key besorgen, falls Recovery aktiviert ist.
      let recoveryKey = null;
      if (recover && user) {
        recoveryKey = getRecoveryKey();
        if (!recoveryKey) {
          if (!accountPw) {
            setStatus("idle");
            busyRef.current = false;
            return setError(t("upload.err.recoverConfirm"));
          }
          try {
            await login(user, accountPw);
            recoveryKey = getRecoveryKey();
          } catch {
            setStatus("idle");
            busyRef.current = false;
            return setError(t("upload.err.recoverPw"));
          }
        }
      }

      // 1) Link-Secret (Key bleibt im Browser)
      const { key, salt, fragment } = await prepareSecret(usePassword ? password : null);
      // 2) Dateien lokal verschlüsseln (optional vorher Bilder komprimieren)
      const payloads = [];
      for (const it of items) {
        let file = it.file;
        let name = it.name?.trim() || it.file.name;
        if (compressImages) {
          const c = await compressImage(it.file);
          if (c !== it.file) {
            file = c;
            name = name.replace(/\.\w+$/, "") + ".jpg"; // Inhalt ist jetzt JPEG
          }
        }
        const p = await encryptFileWith(key, file);
        p.filename = name;
        payloads.push(p);
        setProgress((pr) => ({ ...pr, done: pr.done + 1 }));
      }
      // 3) Verifier für die Key-Prüfung beim Empfänger
      const verifier = await makeVerifier(key);

      // 3b) Recovery-Vault
      let recovery = null;
      if (recoveryKey) {
        const secretObj = usePassword ? { t: "p", v: password } : { t: "k", v: fragment };
        recovery = await wrapSecret(recoveryKey, secretObj);
      }

      // 3c) Optionale öffentliche Vorschau (unverschlüsseltes Thumbnail).
      let preview = null;
      if (publicPreview && firstImage) {
        try {
          preview = await makeThumbnail(firstImage.file);
        } catch {
          preview = null;
        }
      }

      // 4) Ablaufzeit bestimmen (Preset oder Custom-Datum)
      let hours = null;
      if (useExpiry) {
        if (expiry === "custom")
          hours = (new Date(customExpiry).getTime() - Date.now()) / 3600_000;
        else hours = EXPIRY_OPTIONS.find((o) => o.key === expiry)?.hours ?? null;
      }

      // 5) Upload-Kontext bauen (erlaubt Abbrechen/Resume ohne neu zu verschlüsseln)
      const linkOpts = usePassword
        ? embedSecret
          ? { password }
          : {}
        : { key: fragment };
      const uploadId = await startUpload();
      pendingRef.current = {
        uploadId,
        payloads,
        opts: {
          salt,
          verifier,
          oneTime,
          expiresInHours: hours,
          passwordProtected: usePassword,
          maxViews: mv,
          recovery,
          preview,
          protected: viewProtect,
        },
        linkOpts,
        resultBase: {
          usePassword,
          embedSecret: usePassword ? embedSecret : true,
          oneTime,
          maxViews: mv,
          recoverable: !!recovery,
          publicPreview: !!preview,
          protected: viewProtect,
          fileCount: items.length,
          totalSize,
          imageFile: firstImage ? firstImage.file : null,
        },
        totalChars: uploadTotalChars(payloads),
        totalBytes: totalSize,
        from: undefined,
      };
      busyRef.current = false;
      // 6) Chunks hochladen + abschließen (eigene Fehlerbehandlung in runUpload)
      await runUpload();
    } catch (e) {
      console.error(e);
      setError(t("upload.err.encrypt", { msg: e?.message || e }));
      setStatus("idle");
      busyRef.current = false;
    }
  }

  // Lädt die (bereits verschlüsselten) Chunks hoch und schließt ab. Bei Abbruch
  // oder Fehler -> Status "paused" mit Resume-Möglichkeit (kein Neu-Verschlüsseln).
  async function runUpload() {
    const ctx = pendingRef.current;
    if (!ctx) return;
    abortRef.current = new AbortController();
    setError("");
    setStatus("working");
    busyRef.current = true;
    speedRef.current = { t: performance.now(), b: null, ema: null };
    const onProgress = (sentChars) => {
      const frac = Math.min(1, sentChars / ctx.totalChars);
      setUploadPct(frac);
      const bytes = frac * ctx.totalBytes;
      const r = speedRef.current;
      const now = performance.now();
      if (r.b == null) {
        r.b = bytes;
        r.t = now;
        return;
      }
      const dt = (now - r.t) / 1000;
      if (dt >= 0.25) {
        const inst = (bytes - r.b) / dt;
        r.ema = r.ema == null ? inst : r.ema * 0.6 + inst * 0.4;
        r.t = now;
        r.b = bytes;
        setUploadSpeed(r.ema);
        setUploadEta(r.ema > 0 ? (ctx.totalBytes - bytes) / r.ema : null);
      }
    };
    try {
      await uploadChunks(ctx.uploadId, ctx.payloads, {
        signal: abortRef.current.signal,
        onProgress,
        from: ctx.from,
      });
      const { id, expiresAt } = await completeUpload(ctx.uploadId, ctx.opts);
      setResult({ id, url: buildShareUrl(id, ctx.linkOpts), ...ctx.resultBase, expiresAt: expiresAt ?? null });
      pendingRef.current = null;
      setStatus("done");
    } catch (e) {
      ctx.from = e.position || ctx.from; // hier später fortsetzen
      setUploadSpeed(null);
      setUploadEta(null);
      setStatus("paused");
      setError(e.aborted ? t("upload.cancelled") : t("upload.uploadFailed", { msg: e.message }));
    } finally {
      busyRef.current = false;
    }
  }

  const cancelUpload = () => abortRef.current?.abort();
  const resumeUpload = () => runUpload();
  function discardUpload() {
    abortRef.current?.abort();
    pendingRef.current = null;
    reset();
  }

  // Aktuellsten Handler in einen Ref spiegeln, damit das (einmal gebundene)
  // ⌘/Strg+Enter immer den frischen State sieht.
  submitRef.current = () => {
    if (status === "idle" && items.length && check.ok) handleUpload();
  };

  function reset() {
    setItems([]);
    setUsePassword(false);
    setPassword("");
    setOneTime(false);
    setMaxViews("");
    setCustomExpiry("");
    setPublicPreview(false);
    setRecover(false);
    setAccountPw("");
    setResult(null);
    setError("");
    setProgress({ done: 0, total: 0 });
    setUploadPct(0);
    setUploadSpeed(null);
    setUploadEta(null);
    pendingRef.current = null;
    setStatus("idle");
  }

  if (status === "done" && result)
    return <SuccessView result={result} onReset={reset} />;

  const usedPct = Math.min(100, (totalSize / free) * 100);
  const barColor = blocked ? "bg-danger" : overFree ? "bg-yellow-500" : "bg-brand";
  const fileWord = (n) => t(n === 1 ? "common.file.one" : "common.file.other");
  const expiryButtons = [...EXPIRY_OPTIONS, { key: "custom", label: "upload.expiry.custom" }];

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-7 animate-in">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel-2/60 px-2.5 py-1 text-[11px] font-medium text-muted">
          <Icon.shield className="text-brand" size={13} /> {t("upload.zkBadge")}
        </span>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {t("upload.titleBefore")}
          <span className="text-gradient">{t("upload.titleHighlight")}</span>
          {t("upload.titleAfter")}
        </h1>
        <p className="mt-2 max-w-md text-sm text-muted">{t("upload.subtitle")}</p>
      </div>

      <Card className="animate-in p-5">
        <Dropzone onFiles={addFiles} disabled={status === "working"} />

        {items.length > 0 && (
          <div className="mt-4 space-y-2">
            {items.map((it, i) => (
              <div
                key={it.id}
                className="flex items-center gap-2 rounded-lg border border-line bg-panel-2/50 px-3 py-2"
              >
                <span className="text-faint">
                  {it.file.type.startsWith("image/") ? <Icon.image /> : <Icon.file />}
                </span>
                <div className="min-w-0 flex-1">
                  <input
                    aria-label={t("upload.renameAria")}
                    value={it.name}
                    onChange={(e) => renameFile(it.id, e.target.value)}
                    className="-mx-1 w-full truncate rounded bg-transparent px-1 text-sm text-text outline-none transition-colors focus:bg-panel"
                  />
                  <p className="text-xs text-muted">{formatBytes(it.file.size)}</p>
                </div>
                {items.length > 1 && (
                  <div className="flex flex-col text-faint">
                    <button
                      onClick={() => moveFile(i, -1)}
                      disabled={i === 0}
                      className="rounded p-0.5 transition-colors hover:text-text disabled:opacity-30"
                      aria-label={t("upload.moveUp")}
                    >
                      <Icon.chevronUp size={14} />
                    </button>
                    <button
                      onClick={() => moveFile(i, 1)}
                      disabled={i === items.length - 1}
                      className="rounded p-0.5 transition-colors hover:text-text disabled:opacity-30"
                      aria-label={t("upload.moveDown")}
                    >
                      <Icon.chevronDown size={14} />
                    </button>
                  </div>
                )}
                <button
                  onClick={() => removeFile(it.id)}
                  className="rounded-md p-1.5 text-faint transition-colors hover:bg-panel hover:text-danger"
                  aria-label={t("upload.removeFile")}
                >
                  <Icon.x />
                </button>
              </div>
            ))}

            {/* Speicher-Anzeige gegen das geltende Limit */}
            <div className="px-1 pt-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-2">
                <div
                  className={"h-full rounded-full transition-all " + barColor}
                  style={{ width: `${usedPct}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted">
                <span>
                  {items.length} {fileWord(items.length)} · {formatBytes(totalSize)} /{" "}
                  {formatBytes(free)}
                  {!isLoggedIn && t("upload.withoutAccount")}
                </span>
                {overFree && <span className="text-yellow-500">{t("upload.autoExpiry")}</span>}
                {blocked && <span className="text-danger">{t("upload.overLimit")}</span>}
              </div>
            </div>
          </div>
        )}

        {needAccount && (
          <div className="mt-3 rounded-lg border border-line bg-panel-2/40 px-3 py-2.5 text-sm text-muted">
            {t("upload.needAccount.pre", { hard: formatBytes(hard) })}
            <Link to="/login" className="text-brand hover:underline">
              {t("common.signInOrRegister")}
            </Link>
            {t("upload.needAccount.post", { free: formatBytes(limitsFor(true).free) })}
          </div>
        )}

        {/* Optionen */}
        <div className="mt-5 space-y-5 border-t border-line pt-5">
          <div>
            <Toggle
              checked={usePassword}
              onChange={setUsePassword}
              icon={<Icon.lock />}
              label={t("upload.password.label")}
              hint={t("upload.password.hint")}
            />
            {usePassword && (
              <div className="mt-3 space-y-3 rounded-lg border border-line bg-panel-2/40 p-3">
                <div>
                  <div className="flex items-stretch gap-2">
                    <PasswordInput
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("upload.password.placeholder")}
                      autoComplete="new-password"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setPassword(generatePassword())}
                      className="shrink-0 px-2.5"
                      title={t("upload.password.generateTitle")}
                    >
                      <Icon.refresh /> {t("upload.password.generate")}
                    </Button>
                  </div>
                  <PasswordStrength password={password} />
                </div>
                <Toggle
                  checked={embedSecret}
                  onChange={setEmbedSecret}
                  icon={<Icon.link />}
                  label={t("upload.embed.label")}
                  hint={t("upload.embed.hint")}
                />
              </div>
            )}
          </div>

          <Toggle
            checked={oneTime}
            onChange={setOneTime}
            icon={<Icon.fire />}
            label={t("upload.oneTime.label")}
            hint={t("upload.oneTime.hint")}
          />

          {firstImage && (
            <div>
              <Toggle
                checked={publicPreview}
                onChange={setPublicPreview}
                icon={<Icon.image />}
                label={t("upload.preview.label")}
                hint={t("upload.preview.hint")}
              />
              {publicPreview && (
                <p className="mt-2 rounded-lg border border-yellow-500/25 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-200/90">
                  {t("upload.preview.warnPre")}
                  <b>{t("upload.preview.warnBold")}</b>
                  {t("upload.preview.warnPost")}
                </p>
              )}
            </div>
          )}

          {firstImage && (
            <Toggle
              checked={compressImages}
              onChange={setCompressImages}
              icon={<Icon.image />}
              label={t("upload.compress.label")}
              hint={t("upload.compress.hint")}
            />
          )}

          {firstImage && (
            <div>
              <Toggle
                checked={viewProtect}
                onChange={setViewProtect}
                icon={<Icon.shield />}
                label={t("upload.protect.label")}
                hint={t("upload.protect.hint")}
              />
              {viewProtect && (
                <p className="mt-2 rounded-lg border border-yellow-500/25 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-200/90">
                  {t("upload.protect.warn")}
                </p>
              )}
            </div>
          )}

          <div>
            <Toggle
              checked={limitMaxViews}
              onChange={setLimitMaxViews}
              icon={<Icon.eye />}
              label={t("upload.maxViews.label")}
              hint={t("upload.maxViews.hint")}
            />
            {limitMaxViews && (
              <div className="mt-3">
                <Input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={maxViews}
                  onChange={(e) => setMaxViews(e.target.value)}
                  placeholder={t("upload.maxViews.placeholder")}
                  className="max-w-40"
                  autoFocus
                />
              </div>
            )}
          </div>

          {user && (
            <div>
              <Toggle
                checked={recover}
                onChange={setRecover}
                icon={<Icon.key />}
                label={t("upload.recover.label")}
                hint={t("upload.recover.hint")}
              />
              {recover && needAccountPw && (
                <div className="mt-3 rounded-lg border border-line bg-panel-2/40 p-3">
                  <label className="mb-1.5 block text-xs font-medium text-muted">
                    {t("upload.recover.confirmLabel")}
                  </label>
                  <PasswordInput
                    value={accountPw}
                    onChange={(e) => setAccountPw(e.target.value)}
                    placeholder={t("upload.recover.accountPwPlaceholder")}
                    autoComplete="current-password"
                  />
                  <p className="mt-1.5 text-[11px] text-faint">
                    {t("upload.recover.confirmHint")}
                  </p>
                </div>
              )}
            </div>
          )}

          <div>
            <Toggle
              checked={useExpiry || overFree}
              onChange={overFree ? () => {} : setUseExpiry}
              icon={<Icon.clock />}
              label={t("upload.expiry.label")}
              hint={
                overFree
                  ? t("upload.expiry.hintForced", {
                      free: formatBytes(free),
                      hours: FORCED_EXPIRY_HOURS,
                    })
                  : t("upload.expiry.hint")
              }
            />
            {overFree ? (
              <p className="mt-3 rounded-lg border border-yellow-500/25 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-200/90">
                {t("upload.expiry.forcedNote", {
                  free: formatBytes(free),
                  hours: FORCED_EXPIRY_HOURS,
                })}
              </p>
            ) : (
              useExpiry && (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                    {expiryButtons.map((o) => (
                      <button
                        key={o.key}
                        onClick={() => setExpiry(o.key)}
                        className={
                          "rounded-lg border px-2 py-2 text-xs font-medium transition-colors " +
                          (expiry === o.key
                            ? "border-brand/40 bg-brand/10 text-text"
                            : "border-line text-muted hover:border-line-2 hover:text-text")
                        }
                      >
                        {t(o.label)}
                      </button>
                    ))}
                  </div>
                  {expiry === "custom" && (
                    <div className="mt-2">
                      <Input
                        type="datetime-local"
                        value={customExpiry}
                        min={toLocalInput(new Date())}
                        onChange={(e) => setCustomExpiry(e.target.value)}
                      />
                    </div>
                  )}
                </>
              )
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        {(status === "working" || status === "paused") && (
          <div className="mt-4">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-2">
              <div
                className={
                  "h-full rounded-full transition-all " +
                  (status === "paused" ? "bg-yellow-500" : "bg-brand")
                }
                style={{
                  width: `${
                    uploadPct > 0
                      ? uploadPct * 100
                      : progress.total
                      ? (progress.done / progress.total) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
            <p className="mt-1 flex items-center justify-between text-xs text-muted">
              <span>
                {uploadPct > 0
                  ? t("upload.uploading", { pct: Math.round(uploadPct * 100) })
                  : t("upload.progress", { done: progress.done, total: progress.total })}
              </span>
              {status === "working" && uploadPct > 0 && uploadSpeed != null && (
                <span className="text-faint">
                  {t("upload.speedEta", {
                    speed: formatBytes(uploadSpeed),
                    eta: fmtEta(uploadEta),
                  })}
                </span>
              )}
            </p>
          </div>
        )}

        {status === "paused" ? (
          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button onClick={resumeUpload} className="flex-1">
              <Icon.upload /> {t("upload.resume")}
            </Button>
            <Button variant="ghost" onClick={discardUpload} className="flex-1 text-danger hover:bg-danger/10">
              <Icon.x /> {t("upload.discard")}
            </Button>
          </div>
        ) : status === "working" ? (
          <Button
            variant="outline"
            onClick={cancelUpload}
            className="mt-5 w-full text-danger hover:bg-danger/10"
          >
            <Icon.x /> {t("upload.cancel")}
          </Button>
        ) : (
          <>
            <Button
              onClick={handleUpload}
              disabled={items.length === 0 || blocked}
              className="mt-5 w-full"
            >
              <Icon.lock /> {t("upload.submit")}
            </Button>
            <p className="mt-2 text-center text-[11px] text-faint">{t("upload.shortcutHint")}</p>
          </>
        )}
      </Card>
    </div>
  );
}

function SuccessView({ result, onReset }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [showQr, setShowQr] = useState(false);
  const [imgUrl, setImgUrl] = useState(null);

  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  useEffect(() => {
    if (!result.imageFile) return;
    const u = URL.createObjectURL(result.imageFile);
    setImgUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [result.imageFile]);

  async function copy() {
    await navigator.clipboard.writeText(result.url);
    toast(t("success.copied"));
  }
  async function share() {
    try {
      await navigator.share({ title: "Encryo", url: result.url });
    } catch {
      /* abgebrochen */
    }
  }

  const expiryLabel = result.expiresAt ? formatRelative(result.expiresAt, lang) : t("common.never");
  const secretInLink = !result.usePassword || result.embedSecret;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-5 flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/15 text-brand">
          <Icon.check />
        </span>
        <h1 className="text-lg font-semibold">{t("success.title")}</h1>
      </div>

      <Card className="animate-in p-5">
        <label className="mb-1.5 block text-xs font-medium text-muted">
          {t("success.shareLink")}
        </label>
        <div className="flex items-stretch gap-2">
          <Input
            readOnly
            value={result.url}
            onFocus={(e) => e.target.select()}
            className="font-mono text-xs"
          />
          <Button onClick={copy} className="shrink-0">
            <Icon.copy /> {t("success.copy")}
          </Button>
          {canShare && (
            <Button
              variant="outline"
              onClick={share}
              className="shrink-0 px-2.5"
              title={t("success.shareTitle")}
            >
              <Icon.share />
            </Button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {result.usePassword && (
            <Badge tone="brand">
              <Icon.lock /> {t("badge.password")}
            </Badge>
          )}
          {secretInLink ? (
            <Badge tone="default">
              <Icon.link /> {t("badge.keyInLink")}
            </Badge>
          ) : (
            <Badge tone="default">
              <Icon.lock /> {t("badge.passwordSeparate")}
            </Badge>
          )}
          {result.oneTime && (
            <Badge tone="danger">
              <Icon.fire /> {t("badge.oneTime")}
            </Badge>
          )}
          {result.maxViews && (
            <Badge>
              <Icon.eye /> {t("badge.maxViews", { n: result.maxViews })}
            </Badge>
          )}
          {result.recoverable && (
            <Badge tone="brand">
              <Icon.key /> {t("badge.recoverable")}
            </Badge>
          )}
          {result.publicPreview && (
            <Badge>
              <Icon.image /> {t("badge.publicPreview")}
            </Badge>
          )}
          {result.protected && (
            <Badge tone="brand">
              <Icon.shield /> {t("badge.protected")}
            </Badge>
          )}
          <Badge>
            <Icon.clock /> {expiryLabel}
          </Badge>
        </div>

        <p className="mt-3 text-xs text-muted">
          {result.usePassword && !result.embedSecret
            ? t("success.secretNote.separate")
            : t("success.secretNote.inLink")}
        </p>

        {/* Unfurl-Vorschau */}
        <div className="mt-5 border-t border-line pt-5">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Icon.eye /> {t("success.shareHeading")}
          </p>
          <SharePreview
            url={result.url}
            fileCount={result.fileCount}
            totalSize={result.totalSize}
            oneTime={result.oneTime}
            passwordProtected={result.usePassword}
            expiresAt={result.expiresAt}
            imageUrl={result.publicPreview ? imgUrl : null}
          />
          {!result.publicPreview && (
            <p className="mt-2 text-xs text-faint">{t("success.noPreviewNote")}</p>
          )}
        </div>

        {/* QR */}
        <div className="mt-4">
          <button
            onClick={() => setShowQr((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-text"
          >
            <Icon.qr /> {showQr ? t("success.hideQr") : t("success.showQr")}
          </button>
          {showQr && (
            <div className="mt-3 flex justify-center rounded-lg border border-line bg-panel-2/40 py-4">
              <QrCode value={result.url} downloadName={`encryo-${result.id}.png`} />
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={onReset} className="flex-1">
            <Icon.plus /> {t("success.newLink")}
          </Button>
          <a href={result.url} target="_blank" rel="noreferrer" className="flex-1">
            <Button variant="ghost" className="w-full">
              <Icon.external /> {t("success.recipientView")}
            </Button>
          </a>
          <Link to="/dashboard" className="flex-1">
            <Button variant="ghost" className="w-full">
              <Icon.eye /> {t("nav.myLinks")}
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
