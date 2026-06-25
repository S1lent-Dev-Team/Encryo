import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card, Button, Input, PasswordInput, Badge, Icon, Spinner, useToast } from "../components/ui.jsx";
import { getLinkMeta, openLink, getLinkRecovery } from "../lib/store.js";
import { makeZipBlob } from "../lib/zip.js";
import {
  resolveKey,
  checkVerifier,
  decryptToBlob,
  unwrapSecret,
  deriveRecoveryKey,
} from "../lib/crypto.js";
import { parseFragment } from "../lib/link.js";
import { getRecoveryKey, setRecoveryKey, getRecoverySalt } from "../lib/recovery.js";
import { useCurrentUser } from "../lib/useAuth.js";
import { formatBytes, formatDate } from "../lib/format.js";
import { useI18n } from "../lib/i18n.js";

// Macht aus beliebiger Nutzereingabe das rohe Key-Fragment: akzeptiert den rohen
// Key, ein "k.<key>"-Fragment, ein "#k.<key>" oder einen ganzen Share-Link.
function parseKeyInput(raw) {
  let s = (raw || "").trim();
  const hash = s.indexOf("#");
  if (hash >= 0) s = s.slice(hash + 1);
  if (s.startsWith("k.")) s = s.slice(2);
  return s;
}

export default function ViewPage() {
  const { id } = useParams();
  const { user } = useCurrentUser();
  const { t } = useI18n();
  const toast = useToast();
  const frag = useMemo(() => parseFragment(), []);

  const [phase, setPhase] = useState("loading"); // loading | gate | opening | opened | gone
  const [meta, setMeta] = useState(null);
  const [goneReason, setGoneReason] = useState(null);
  const [password, setPassword] = useState(frag.type === "password" ? frag.value : "");
  const [manualKey, setManualKey] = useState(""); // bei fehlendem #-Fragment
  const [accountPw, setAccountPw] = useState(""); // für Owner-Recovery
  const [needAccountPw, setNeedAccountPw] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState([]);
  const [viewCount, setViewCount] = useState(0);
  const [decProgress, setDecProgress] = useState({ done: 0, total: 0 });
  const [downloadPct, setDownloadPct] = useState(0);
  const urlsRef = useRef([]);
  const autoTried = useRef(false);

  // haben wir das Secret schon (ohne Nutzereingabe)?
  const haveSecret = frag.type === "key" || frag.type === "password";

  // Metadaten laden (nicht-destruktiv)
  useEffect(() => {
    let alive = true;
    (async () => {
      const m = await getLinkMeta(id);
      if (!alive) return;
      if (!m.found) return gone("NOT_FOUND");
      if (m.revoked) return gone("REVOKED");
      if (m.burned) return gone("BURNED");
      if (m.expired) return gone("EXPIRED");
      setMeta(m);
      setPhase("gate");
    })();
    function gone(reason) {
      setGoneReason(reason);
      setPhase("gone");
    }
    return () => {
      alive = false;
    };
  }, [id]);

  // Auto-Vorschau: wenn das Secret im Link steckt UND es kein One-Time ist,
  // direkt entschlüsseln — ohne Klick. One-Time bleibt bewusst manuell.
  useEffect(() => {
    if (phase !== "gate" || autoTried.current) return;
    if (meta && !meta.oneTime && haveSecret) {
      autoTried.current = true;
      doOpen();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, meta]);

  useEffect(
    () => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)),
    []
  );

  // override: { password?, keyFrag? } erlaubt es, das Secret direkt zu übergeben
  // (z.B. aus der Recovery), ohne den Umweg über den State.
  async function doOpen(override = {}) {
    setError("");
    const pw =
      "password" in override
        ? override.password
        : meta.passwordProtected
        ? frag.type === "password"
          ? frag.value
          : password
        : null;
    const keyFrag =
      "keyFrag" in override
        ? override.keyFrag
        : frag.type === "key"
        ? frag.value
        : manualKey.trim()
        ? parseKeyInput(manualKey)
        : null;

    if (meta.passwordProtected && !pw) return setError(t("view.err.needPw"));

    let key;
    try {
      key = await resolveKey({ salt: meta.salt, fragment: keyFrag, password: pw });
    } catch (e) {
      if (e.message === "KEY_MISSING") return setError(t("view.err.keyMissing"));
      return setError(t("view.err.keyBuild"));
    }

    // Key prüfen BEVOR geöffnet wird (One-Time würde sonst verbrennen)
    if (!(await checkVerifier(key, meta.verifier))) {
      return setError(meta.passwordProtected ? t("view.err.wrongPw") : t("view.err.keyMismatch"));
    }

    try {
      setPhase("opening");
      setDownloadPct(0);
      setDecProgress({ done: 0, total: 0 });
      const res = await openLink(id, (loaded, total) =>
        setDownloadPct(total ? loaded / total : 0)
      );
      if (!res.ok) {
        setGoneReason(res.reason);
        setPhase("gone");
        return;
      }
      setDecProgress({ done: 0, total: res.files.length });
      const decrypted = [];
      for (const f of res.files) {
        const blob = await decryptToBlob(key, f);
        const url = URL.createObjectURL(blob);
        urlsRef.current.push(url);
        decrypted.push({
          filename: f.filename,
          mimetype: f.mimetype,
          size: f.size,
          url,
          blob,
          isImage: (f.mimetype || "").startsWith("image/"),
        });
        setDecProgress((p) => ({ ...p, done: p.done + 1 }));
      }
      setFiles(decrypted);
      setViewCount(res.meta.viewCount);
      setPhase("opened");
    } catch (e) {
      console.error(e);
      setError(t("view.err.decrypt"));
      setPhase("gate");
    }
  }

  // Owner-Recovery: den verschlüsselten Vault des Links per Account-Passwort
  // entsperren und das daraus gewonnene Secret direkt zum Öffnen verwenden.
  async function recoverAsOwner(pwArg) {
    setError("");
    let rkey = getRecoveryKey();
    let derivedFresh = false;
    if (!rkey) {
      if (!pwArg) {
        setNeedAccountPw(true);
        return;
      }
      const salt = getRecoverySalt();
      if (!salt) return setError(t("view.err.loginFirst"));
      // Bewusst NICHT cachen, bevor verifiziert ist (sonst klebt ein falsches PW).
      rkey = await deriveRecoveryKey(pwArg, salt);
      derivedFresh = true;
    }

    setRecovering(true);
    try {
      const r = await getLinkRecovery(id);
      const secret = await unwrapSecret(rkey, r.recovery); // wirft bei falschem PW
      if (derivedFresh) setRecoveryKey(rkey); // jetzt verifiziert -> cachen
      if (secret.t === "p") {
        setPassword(secret.v);
        await doOpen({ password: secret.v });
      } else {
        await doOpen({ keyFrag: secret.v });
      }
    } catch (e) {
      if (e.status === 403) setError(t("view.err.ownerOnly"));
      else if (e.status === 404) setError(t("view.err.noVault"));
      else setError(t("view.err.recoverFail"));
    } finally {
      setRecovering(false);
    }
  }

  if (phase === "loading" || (phase === "gate" && !meta.oneTime && haveSecret))
    return (
      <Centered>
        <div className="flex items-center gap-3 text-muted">
          <Spinner size={18} /> {t("view.decrypting")}
        </div>
      </Centered>
    );
  if (phase === "opening") {
    const downloading = decProgress.total === 0; // erst laden, dann entschlüsseln
    const pct = downloading ? downloadPct * 100 : (decProgress.done / decProgress.total) * 100;
    return (
      <Centered>
        <div className="w-full max-w-xs">
          <div className="mb-3 flex items-center gap-3 text-muted">
            <Spinner size={18} />{" "}
            {downloading ? t("view.downloading", { pct: Math.round(downloadPct * 100) }) : t("view.decrypting")}
          </div>
          {(downloading ? downloadPct > 0 : decProgress.total > 1) && (
            <>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-2">
                <div
                  className="h-full rounded-full bg-brand transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {!downloading && (
                <p className="mt-1 text-center text-xs text-muted">
                  {t("opened.decryptProgress", {
                    done: decProgress.done,
                    total: decProgress.total,
                  })}
                </p>
              )}
            </>
          )}
        </div>
      </Centered>
    );
  }
  if (phase === "gone") return <GoneView reason={goneReason} />;
  if (phase === "opened")
    return <OpenedView files={files} meta={meta} viewCount={viewCount} toast={toast} />;

  return (
    <GateView
      meta={meta}
      frag={frag}
      user={user}
      password={password}
      setPassword={setPassword}
      manualKey={manualKey}
      setManualKey={setManualKey}
      needAccountPw={needAccountPw}
      accountPw={accountPw}
      setAccountPw={setAccountPw}
      recovering={recovering}
      error={error}
      onOpen={doOpen}
      onRecover={recoverAsOwner}
      busy={phase === "opening"}
    />
  );
}

// ---------------------------------------------------------------------------
function GateView({
  meta,
  frag,
  user,
  password,
  setPassword,
  manualKey,
  setManualKey,
  needAccountPw,
  accountPw,
  setAccountPw,
  recovering,
  error,
  onOpen,
  onRecover,
  busy,
}) {
  const { t } = useI18n();
  const needsKey = !meta.passwordProtected && frag.type !== "key";
  const needsPasswordInput = meta.passwordProtected && frag.type !== "password";
  const canRecover = meta.recoverable && !!user;
  const openDisabled = busy || recovering || (needsKey && !manualKey.trim());
  const fileWord = t(meta.fileCount === 1 ? "common.file.one" : "common.file.other");

  return (
    <div className="mx-auto max-w-md">
      <Card className="animate-in p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-panel-2 text-brand">
            {meta.oneTime ? <Icon.fire size={20} /> : <Icon.lock size={20} />}
          </span>
          <div>
            <h1 className="text-base font-semibold">
              {meta.fileCount} {fileWord} · {formatBytes(meta.totalSize)}
            </h1>
            <p className="text-xs text-muted">{t("view.waiting")}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {meta.passwordProtected && (
            <Badge tone="brand">
              <Icon.lock /> {t("badge.password")}
            </Badge>
          )}
          {meta.oneTime && (
            <Badge tone="danger">
              <Icon.fire /> {t("badge.oneTime")}
            </Badge>
          )}
          {meta.maxViews && (
            <Badge>
              <Icon.eye /> {meta.viewCount}/{meta.maxViews}
            </Badge>
          )}
          {meta.expiresAt && <Countdown to={meta.expiresAt} />}
        </div>

        {meta.oneTime && (
          <div className="mt-4 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2.5 text-sm text-danger">
            {t("view.oneTimeWarn.pre")}
            <b>{t("view.oneTimeWarn.bold")}</b>
            {t("view.oneTimeWarn.post")}
          </div>
        )}

        {needsKey && (
          <div className="mt-4">
            <div className="rounded-lg border border-line bg-panel-2/40 px-3 py-2.5 text-sm text-muted">
              {t("view.needKey")}
            </div>
            <div className="mt-3">
              <Input
                value={manualKey}
                onChange={(e) => setManualKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !openDisabled && onOpen()}
                placeholder={t("view.keyPlaceholder")}
                className="font-mono text-xs"
                autoFocus
              />
            </div>
          </div>
        )}

        {needsPasswordInput && (
          <div className="mt-4">
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !openDisabled && onOpen()}
              placeholder={t("view.pwPlaceholder")}
              autoFocus
            />
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}

        <Button onClick={() => onOpen()} disabled={openDisabled} className="mt-4 w-full">
          {busy ? (
            <>
              <Spinner /> {t("view.open.busy")}
            </>
          ) : meta.oneTime ? (
            <>
              <Icon.fire /> {t("view.open.oneTime")}
            </>
          ) : (
            <>
              <Icon.unlock /> {t("view.open.normal")}
            </>
          )}
        </Button>

        {/* Owner-Recovery: nur sinnvoll, wenn ein Vault existiert und man eingeloggt ist */}
        {canRecover && (
          <div className="mt-4 border-t border-line pt-4">
            {needAccountPw ? (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted">
                  {t("view.recover.label")}
                </label>
                <PasswordInput
                  value={accountPw}
                  onChange={(e) => setAccountPw(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !recovering && onRecover(accountPw)}
                  placeholder={t("upload.recover.accountPwPlaceholder")}
                  autoComplete="current-password"
                  autoFocus
                />
                <Button
                  variant="outline"
                  onClick={() => onRecover(accountPw)}
                  disabled={recovering || !accountPw}
                  className="mt-3 w-full"
                >
                  {recovering ? <Spinner /> : <Icon.key />}
                  {t("view.recover.button")}
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                onClick={() => onRecover()}
                disabled={recovering}
                className="w-full"
              >
                {recovering ? <Spinner /> : <Icon.key />}
                {t("view.recover.cta")}
              </Button>
            )}
          </div>
        )}

        <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-faint">
          <Icon.shield className="text-brand" /> {t("view.browserNote")}
        </p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
function downloadBlob(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}

// Welche MIME-Typen / Endungen zeigen wir als Text-Vorschau?
function isTextual(mime = "", name = "") {
  if (mime.startsWith("text/")) return true;
  if (/(json|javascript|ecmascript|xml|x-sh|yaml|csv|markdown)/.test(mime)) return true;
  return /\.(txt|md|markdown|json|jsonc|js|jsx|mjs|cjs|ts|tsx|css|scss|html|csv|tsv|log|ya?ml|xml|svg|sh|bash|py|rb|java|c|h|cpp|cc|rs|go|php|sql|ini|toml|env)$/i.test(
    name
  );
}

function TextPreview({ file }) {
  const { t } = useI18n();
  const toast = useToast();
  const [text, setText] = useState(null);
  useEffect(() => {
    let alive = true;
    file.blob.text().then((tx) => {
      if (alive) setText(tx.length > 20000 ? tx.slice(0, 20000) + "\n…" : tx);
    });
    return () => {
      alive = false;
    };
  }, [file]);
  if (text == null)
    return <div className="bg-panel-2 p-4 text-xs text-muted">{t("preview.loading")}</div>;
  return (
    <div className="relative">
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          toast(t("preview.copied"));
        }}
        className="absolute right-2 top-2 z-10 inline-flex items-center gap-1 rounded-md border border-line bg-panel/80 px-2 py-1 text-[11px] text-muted backdrop-blur transition-colors hover:text-text"
      >
        <Icon.copy size={12} /> {t("preview.copyText")}
      </button>
      <pre className="max-h-[440px] overflow-auto whitespace-pre-wrap break-words bg-panel-2 p-4 text-xs leading-relaxed text-text">
        {text}
      </pre>
    </div>
  );
}

// Gekacheltes, diagonales Wasserzeichen über dem Bild (Abschreckung gegen
// Screenshots/Weitergabe — kein echter Schutz).
function Watermark({ text }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex flex-wrap content-center justify-center gap-x-10 gap-y-8 overflow-hidden -rotate-[24deg] select-none"
    >
      {Array.from({ length: 80 }).map((_, i) => (
        <span key={i} className="whitespace-nowrap text-xs font-semibold text-white/40">
          {text}
        </span>
      ))}
    </div>
  );
}

function FilePreview({ file, onZoom, protect, watermark }) {
  const { t } = useI18n();
  const m = file.mimetype || "";
  const noSave = protect
    ? { onContextMenu: (e) => e.preventDefault(), draggable: false }
    : {};
  if (m.startsWith("image/"))
    return (
      <button
        onClick={onZoom}
        onContextMenu={protect ? (e) => e.preventDefault() : undefined}
        className="group relative block w-full cursor-zoom-in"
        title={t("preview.zoom")}
      >
        <img
          src={file.url}
          alt={file.filename}
          {...noSave}
          className="max-h-[440px] w-full bg-panel-2 object-contain"
        />
        {protect && <Watermark text={watermark} />}
        <span className="absolute right-2 top-2 rounded-md bg-black/50 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Icon.expand size={14} />
        </span>
      </button>
    );
  if (m === "application/pdf")
    return (
      <iframe src={file.url} title={file.filename} className="h-[480px] w-full bg-panel-2" />
    );
  if (m.startsWith("video/"))
    return <video src={file.url} controls className="max-h-[440px] w-full bg-black" />;
  if (m.startsWith("audio/"))
    return (
      <div className="bg-panel-2 p-4">
        <audio src={file.url} controls className="w-full" />
      </div>
    );
  if (isTextual(m, file.filename)) return <TextPreview file={file} />;
  return null;
}

function OpenedView({ files, meta, viewCount, toast }) {
  const { t, lang } = useI18n();
  const [lightIdx, setLightIdx] = useState(null);
  const [zipping, setZipping] = useState(false);
  const [obscured, setObscured] = useState(false);
  const lightboxRef = useRef(null);
  const images = files.filter((f) => f.isImage);
  const lightOpen = lightIdx != null;
  const protect = !!meta.protected;
  const watermark = t("protect.watermark", { date: formatDate(Date.now(), lang) });

  // Ansichtsschutz: Inhalt verbergen, wenn das Fenster den Fokus verliert
  // (erschwert Hintergrund-/Alt-Tab-Aufnahmen). Kein echter Schutz.
  useEffect(() => {
    if (!protect) return;
    const update = () => setObscured(document.hidden);
    const hide = () => setObscured(true);
    const show = () => setObscured(false);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("blur", hide);
    window.addEventListener("focus", show);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("blur", hide);
      window.removeEventListener("focus", show);
    };
  }, [protect]);

  // Lightbox-Galerie: Fokus rein, Esc schließt, ◀ ▶ blättern, Tab gefangen.
  useEffect(() => {
    if (!lightOpen) return;
    const prev = document.activeElement;
    lightboxRef.current?.focus();
    function onKey(e) {
      if (e.key === "Escape") setLightIdx(null);
      else if (e.key === "Tab") e.preventDefault();
      else if (e.key === "ArrowLeft") setLightIdx((i) => (i + images.length - 1) % images.length);
      else if (e.key === "ArrowRight") setLightIdx((i) => (i + 1) % images.length);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightOpen]);

  async function copyImage(file) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ [file.blob.type || "image/png"]: file.blob }),
      ]);
      toast?.(t("opened.imgCopied"));
    } catch {
      toast?.(t("opened.imgCopyFail"), "error");
    }
  }

  async function downloadZip() {
    setZipping(true);
    try {
      const entries = await Promise.all(
        files.map(async (f) => ({
          name: f.filename,
          bytes: new Uint8Array(await f.blob.arrayBuffer()),
        }))
      );
      downloadBlob(makeZipBlob(entries), `encryo-${meta.id}.zip`);
      toast?.(t("opened.zipDone"));
    } finally {
      setZipping(false);
    }
  }

  const fileWord = t(files.length === 1 ? "common.file.one" : "common.file.other");

  return (
    <div
      className={"mx-auto max-w-2xl " + (protect ? "select-none" : "")}
      onContextMenu={protect ? (e) => e.preventDefault() : undefined}
    >
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel-2 text-brand">
            <Icon.unlock size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold">{t("opened.title")}</h1>
            <p className="text-xs text-muted">
              {t("opened.subtitle", { count: files.length, fileWord, n: viewCount })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {files.length > 1 && !protect && (
            <Button variant="outline" onClick={downloadZip} disabled={zipping}>
              {zipping ? <Spinner /> : <Icon.download />} {t("opened.zip")}
            </Button>
          )}
          {protect && (
            <Badge tone="brand">
              <Icon.shield /> {t("badge.protected")}
            </Badge>
          )}
          {meta.oneTime && (
            <Badge tone="danger">
              <Icon.fire /> {t("opened.burned")}
            </Badge>
          )}
        </div>
      </div>

      {protect && (
        <div className="mb-4 rounded-lg border border-yellow-500/25 bg-yellow-500/10 px-3 py-2.5 text-sm text-yellow-200/90">
          {t("opened.protectNote")}
        </div>
      )}

      {meta.oneTime && (
        <div className="mb-4 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2.5 text-sm text-danger">
          {t("opened.oneTimeNote")}
        </div>
      )}

      <div className="space-y-3">
        {files.map((f, i) => (
          <Card key={i} className="overflow-hidden">
            <FilePreview
              file={f}
              onZoom={() => setLightIdx(images.indexOf(f))}
              protect={protect}
              watermark={watermark}
            />
            <div className="flex items-center gap-3 p-3.5">
              <span className="text-faint">
                {f.isImage ? <Icon.image /> : <Icon.file />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-text" title={f.filename}>
                  {f.filename}
                </p>
                <p className="text-xs text-muted">
                  {formatBytes(f.size)} · {f.mimetype}
                </p>
              </div>
              {!protect && (
                <Button variant="outline" onClick={() => downloadBlob(f.blob, f.filename)}>
                  <Icon.download /> {t("opened.download")}
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-6 text-center">
        <Link to="/" className="text-sm text-brand hover:underline">
          {t("opened.shareOwn")}
        </Link>
      </div>

      {lightOpen && (
        <div
          ref={lightboxRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={t("preview.zoom")}
          onClick={() => setLightIdx(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 outline-none backdrop-blur-sm"
        >
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <img
              src={images[lightIdx].url}
              alt={images[lightIdx].filename}
              draggable={protect ? false : undefined}
              onContextMenu={protect ? (e) => e.preventDefault() : undefined}
              className="max-h-[85vh] max-w-full rounded-lg object-contain"
            />
            {protect && <Watermark text={watermark} />}
          </div>

          {/* Steuerleiste oben rechts */}
          <div
            className="absolute right-3 top-3 flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {images.length > 1 && (
              <span className="rounded-md bg-black/50 px-2 py-1 text-xs text-white">
                {lightIdx + 1}/{images.length}
              </span>
            )}
            {!protect && (
              <button
                onClick={() => copyImage(images[lightIdx])}
                title={t("opened.copyImage")}
                aria-label={t("opened.copyImage")}
                className="rounded-md bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
              >
                <Icon.copy size={16} />
              </button>
            )}
            <button
              onClick={() => setLightIdx(null)}
              aria-label={t("common.close")}
              className="rounded-md bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
            >
              <Icon.x size={16} />
            </button>
          </div>

          {/* Blättern */}
          {images.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightIdx((i) => (i + images.length - 1) % images.length);
                }}
                aria-label={t("opened.prevImage")}
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
              >
                <Icon.chevronLeft size={20} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setLightIdx((i) => (i + 1) % images.length);
                }}
                aria-label={t("opened.nextImage")}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
              >
                <Icon.chevronRight size={20} />
              </button>
            </>
          )}
        </div>
      )}

      {/* Ansichtsschutz: Inhalt verbergen, solange das Fenster nicht im Fokus ist */}
      {protect && obscured && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/95 p-6 text-center backdrop-blur-xl">
          <div className="flex flex-col items-center gap-2 text-muted">
            <Icon.shield className="text-brand" size={28} />
            <p className="text-sm">{t("opened.obscured")}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function GoneView({ reason }) {
  const { t } = useI18n();
  const icons = {
    NOT_FOUND: <Icon.x size={22} />,
    EXPIRED: <Icon.clock size={22} />,
    BURNED: <Icon.fire size={22} />,
    REVOKED: <Icon.ban size={22} />,
  };
  const key = icons[reason] ? reason : "NOT_FOUND";
  return (
    <Centered>
      <Card className="w-full max-w-md p-8 text-center animate-in">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-panel-2 text-xl text-muted">
          {icons[key]}
        </div>
        <h1 className="text-lg font-semibold">{t(`gone.${key}.t`)}</h1>
        <p className="mt-1 text-sm text-muted">{t(`gone.${key}.d`)}</p>
        <Link to="/" className="mt-6 inline-block">
          <Button variant="outline">
            <Icon.upload /> {t("gone.createOwn")}
          </Button>
        </Link>
      </Card>
    </Centered>
  );
}

function Countdown({ to }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = Math.max(0, to - now);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const label =
    h >= 24
      ? `${Math.floor(h / 24)}d ${h % 24}h`
      : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return (
    <Badge tone={diff < 3600000 ? "danger" : "default"}>
      <Icon.clock /> {label}
    </Badge>
  );
}

function Centered({ children }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">{children}</div>
  );
}
