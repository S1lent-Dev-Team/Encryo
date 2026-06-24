import { useEffect, useState } from "react";
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
} from "../components/ui.jsx";
import { prepareSecret, encryptFileWith, makeVerifier, wrapSecret } from "../lib/crypto.js";
import { createLink } from "../lib/store.js";
import { buildShareUrl } from "../lib/link.js";
import { formatBytes } from "../lib/format.js";
import { useCurrentUser } from "../lib/useAuth.js";
import { getRecoveryKey } from "../lib/recovery.js";
import { login } from "../lib/auth.js";

// Muss zum Server-Limit passen (siehe server/index.js).
const MAX_TOTAL = 25 * 1024 * 1024;

const EXPIRY_OPTIONS = [
  { key: "never", label: "Nie", hours: null },
  { key: "1", label: "1 Std", hours: 1 },
  { key: "24", label: "24 Std", hours: 24 },
  { key: "168", label: "7 Tage", hours: 168 },
];

export default function UploadPage() {
  const { user } = useCurrentUser();
  const [files, setFiles] = useState([]);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [embedSecret, setEmbedSecret] = useState(true); // Secret in den Link packen
  const [oneTime, setOneTime] = useState(false);
  const [expiry, setExpiry] = useState("never");
  const [recover, setRecover] = useState(false); // Recovery-Vault im Account
  const [accountPw, setAccountPw] = useState(""); // nur falls Key nicht im Speicher
  const [maxViews, setMaxViews] = useState(""); // "" = unbegrenzt

  const [status, setStatus] = useState("idle"); // idle | working | done
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  // Nach Reload (Cookie-Session) liegt der Recovery-Key nicht im Speicher -> dann
  // brauchen wir zur Aktivierung einmal das Account-Passwort zur Bestätigung.
  const needAccountPw = recover && !!user && !getRecoveryKey();

  const totalSize = files.reduce((s, f) => s + f.size, 0);
  const tooBig = totalSize > MAX_TOTAL;
  const firstImage = files.find((f) => f.type.startsWith("image/"));

  function addFiles(incoming) {
    setError("");
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name + f.size));
      const merged = [...prev];
      for (const f of incoming) if (!seen.has(f.name + f.size)) merged.push(f);
      return merged;
    });
  }
  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  async function handleUpload() {
    setError("");
    if (!files.length) return setError("Bitte zuerst eine Datei auswählen.");
    if (usePassword && password.length < 4)
      return setError("Passwort muss mindestens 4 Zeichen haben.");
    if (tooBig)
      return setError(`Maximal ${formatBytes(MAX_TOTAL)} pro Link.`);
    const mv = maxViews.trim() ? parseInt(maxViews, 10) : null;
    if (mv !== null && (!Number.isInteger(mv) || mv < 1))
      return setError("Max. Aufrufe muss eine positive Zahl sein.");

    try {
      setStatus("working");

      // 0) Recovery-Key besorgen, falls Recovery aktiviert ist. Liegt er nach
      //    einem Reload nicht mehr im Speicher, verifiziert ein erneuter Login
      //    das Account-Passwort UND leitet den Key korrekt ab (kein Footgun mit
      //    falschem Passwort beim Wrappen).
      let recoveryKey = null;
      if (recover && user) {
        recoveryKey = getRecoveryKey();
        if (!recoveryKey) {
          if (!accountPw) {
            setStatus("idle");
            return setError("Bitte Account-Passwort bestätigen, um Recovery zu aktivieren.");
          }
          try {
            await login(user, accountPw);
            recoveryKey = getRecoveryKey();
          } catch {
            setStatus("idle");
            return setError("Account-Passwort falsch — Recovery nicht aktiviert.");
          }
        }
      }

      // 1) Link-Secret (Key bleibt im Browser)
      const { key, salt, fragment } = await prepareSecret(usePassword ? password : null);
      // 2) Dateien lokal verschlüsseln
      const payloads = [];
      for (const f of files) payloads.push(await encryptFileWith(key, f));
      // 3) Verifier für die Key-Prüfung beim Empfänger
      const verifier = await makeVerifier(key);

      // 3b) Recovery-Vault: das Secret, aus dem sich der volle Link wieder bauen
      //     lässt, mit dem Account-Recovery-Key verschlüsseln.
      let recovery = null;
      if (recoveryKey) {
        const secretObj = usePassword ? { t: "p", v: password } : { t: "k", v: fragment };
        recovery = await wrapSecret(recoveryKey, secretObj);
      }

      // 4) nur Ciphertext + Metadaten an den Server -> Server vergibt die ID
      const hours = EXPIRY_OPTIONS.find((o) => o.key === expiry)?.hours ?? null;
      const { id } = await createLink({
        files: payloads,
        salt,
        verifier,
        oneTime,
        expiresInHours: hours,
        passwordProtected: usePassword,
        maxViews: mv,
        recovery,
      });

      // 5) Share-Link bauen (Key/Passwort steckt im #-Fragment, nie am Server)
      const linkOpts = usePassword
        ? embedSecret
          ? { password }
          : {} // Empfänger gibt das Passwort selbst ein
        : { key: fragment }; // ohne Passwort steckt der Key immer im Link
      const url = buildShareUrl(id, linkOpts);

      setResult({
        id,
        url,
        usePassword,
        embedSecret: usePassword ? embedSecret : true,
        oneTime,
        expiry,
        maxViews: mv,
        recoverable: !!recovery,
        fileCount: files.length,
        totalSize,
        imageFile: firstImage || null,
      });
      setStatus("done");
    } catch (e) {
      console.error(e);
      setError("Verschlüsselung fehlgeschlagen: " + (e?.message || e));
      setStatus("idle");
    }
  }

  function reset() {
    setFiles([]);
    setUsePassword(false);
    setPassword("");
    setEmbedSecret(true);
    setOneTime(false);
    setExpiry("never");
    setRecover(false);
    setAccountPw("");
    setMaxViews("");
    setResult(null);
    setError("");
    setStatus("idle");
  }

  if (status === "done" && result)
    return <SuccessView result={result} onReset={reset} />;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-7 animate-in">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel-2/60 px-2.5 py-1 text-[11px] font-medium text-muted">
          <Icon.shield className="text-brand" size={13} /> Zero-Knowledge · Ende-zu-Ende
        </span>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Teile Dateien, die <span className="text-gradient">niemand</span>{" "}
          mitliest
        </h1>
        <p className="mt-2 max-w-md text-sm text-muted">
          Verschlüsselung passiert in deinem Browser. Der Link trägt den
          Schlüssel — der Server speichert nur Ciphertext.
        </p>
      </div>

      <Card className="animate-in p-5">
        <Dropzone onFiles={addFiles} disabled={status === "working"} />

        {files.length > 0 && (
          <div className="mt-4 space-y-2">
            {files.map((f, i) => (
              <div
                key={f.name + i}
                className="flex items-center gap-3 rounded-lg border border-line bg-panel-2/50 px-3 py-2"
              >
                <span className="text-faint">
                  {f.type.startsWith("image/") ? <Icon.image /> : <Icon.file />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text">{f.name}</p>
                  <p className="text-xs text-muted">{formatBytes(f.size)}</p>
                </div>
                <button
                  onClick={() => removeFile(i)}
                  className="rounded-md p-1.5 text-faint transition-colors hover:bg-panel hover:text-danger"
                  aria-label="Entfernen"
                >
                  <Icon.x />
                </button>
              </div>
            ))}
            <div className="flex items-center justify-between px-1 pt-0.5 text-xs text-muted">
              <span>
                {files.length} {files.length === 1 ? "Datei" : "Dateien"} ·{" "}
                {formatBytes(totalSize)}
              </span>
              {tooBig && <span className="text-danger">über Prototyp-Limit</span>}
            </div>
          </div>
        )}

        {/* Optionen */}
        <div className="mt-5 space-y-5 border-t border-line pt-5">
          <div>
            <Toggle
              checked={usePassword}
              onChange={setUsePassword}
              icon={<Icon.lock />}
              label="Passwortschutz"
              hint="Schlüssel wird aus dem Passwort abgeleitet (PBKDF2)"
            />
            {usePassword && (
              <div className="mt-3 space-y-3 rounded-lg border border-line bg-panel-2/40 p-3">
                <div>
                  <div className="flex items-stretch gap-2">
                    <PasswordInput
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Passwort festlegen…"
                      autoComplete="new-password"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setPassword(generatePassword())}
                      className="shrink-0 px-2.5"
                      title="Starkes Passwort generieren"
                    >
                      <Icon.refresh /> Generieren
                    </Button>
                  </div>
                  <PasswordStrength password={password} />
                </div>
                <Toggle
                  checked={embedSecret}
                  onChange={setEmbedSecret}
                  icon={<Icon.link />}
                  label="Passwort in den Link einbetten"
                  hint="Empfänger sieht die Vorschau sofort (kein separater Kanal nötig)"
                />
              </div>
            )}
          </div>

          <Toggle
            checked={oneTime}
            onChange={setOneTime}
            icon={<Icon.fire />}
            label="One-Time-View"
            hint="Link wird nach dem ersten Öffnen unbrauchbar"
          />

          <div>
            <label className="text-sm font-medium text-text">Max. Aufrufe</label>
            <p className="mb-2.5 text-xs text-muted">
              Optional: Link wird nach so vielen Öffnungen automatisch gesperrt
            </p>
            <Input
              type="number"
              min="1"
              inputMode="numeric"
              value={maxViews}
              onChange={(e) => setMaxViews(e.target.value)}
              placeholder="unbegrenzt"
              className="max-w-40"
            />
          </div>

          {user && (
            <div>
              <Toggle
                checked={recover}
                onChange={setRecover}
                icon={<Icon.key />}
                label="Wiederherstellung aktivieren"
                hint="Verschlüsselte Kopie des Schlüssels in deinem Account – wiederherstellbar mit deinem Account-Passwort"
              />
              {recover && needAccountPw && (
                <div className="mt-3 rounded-lg border border-line bg-panel-2/40 p-3">
                  <label className="mb-1.5 block text-xs font-medium text-muted">
                    Account-Passwort bestätigen
                  </label>
                  <PasswordInput
                    value={accountPw}
                    onChange={(e) => setAccountPw(e.target.value)}
                    placeholder="Dein Account-Passwort…"
                    autoComplete="current-password"
                  />
                  <p className="mt-1.5 text-[11px] text-faint">
                    Nach einem Reload liegt der Recovery-Schlüssel nicht mehr im
                    Speicher – einmal bestätigen genügt.
                  </p>
                </div>
              )}
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-text">Ablauf</p>
            <p className="mb-2.5 text-xs text-muted">
              Link wird nach Ablauf automatisch ungültig
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {EXPIRY_OPTIONS.map((o) => (
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
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <Button
          onClick={handleUpload}
          disabled={status === "working" || files.length === 0}
          className="mt-5 w-full"
        >
          {status === "working" ? (
            <>
              <Spinner /> Verschlüsseln…
            </>
          ) : (
            <>
              <Icon.lock /> Verschlüsseln & Link erstellen
            </>
          )}
        </Button>
      </Card>
    </div>
  );
}

function SuccessView({ result, onReset }) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [imgUrl, setImgUrl] = useState(null);

  // Thumbnail der ersten Bild-Datei (lokal) für die Unfurl-Vorschau
  useEffect(() => {
    if (!result.imageFile) return;
    const u = URL.createObjectURL(result.imageFile);
    setImgUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [result.imageFile]);

  async function copy() {
    await navigator.clipboard.writeText(result.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const expiryLabel =
    EXPIRY_OPTIONS.find((o) => o.key === result.expiry)?.label ?? "Nie";
  const secretInLink = !result.usePassword || result.embedSecret;
  const expiresAt =
    result.expiry === "never"
      ? null
      : Date.now() + EXPIRY_OPTIONS.find((o) => o.key === result.expiry).hours * 3600_000;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-5 flex items-center gap-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand/15 text-brand">
          <Icon.check />
        </span>
        <h1 className="text-lg font-semibold">Link erstellt</h1>
      </div>

      <Card className="animate-in p-5">
        <label className="mb-1.5 block text-xs font-medium text-muted">
          Share-Link
        </label>
        <div className="flex items-stretch gap-2">
          <Input
            readOnly
            value={result.url}
            onFocus={(e) => e.target.select()}
            className="font-mono text-xs"
          />
          <Button onClick={copy} className="shrink-0">
            {copied ? <Icon.check /> : <Icon.copy />}
            {copied ? "Kopiert" : "Kopieren"}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {result.usePassword && (
            <Badge tone="brand">
              <Icon.lock /> Passwort
            </Badge>
          )}
          {secretInLink ? (
            <Badge tone="default">
              <Icon.link /> Schlüssel im Link
            </Badge>
          ) : (
            <Badge tone="default">
              <Icon.lock /> Passwort separat
            </Badge>
          )}
          {result.oneTime && (
            <Badge tone="danger">
              <Icon.fire /> One-Time
            </Badge>
          )}
          {result.maxViews && (
            <Badge>
              <Icon.eye /> max. {result.maxViews}×
            </Badge>
          )}
          {result.recoverable && (
            <Badge tone="brand">
              <Icon.key /> wiederherstellbar
            </Badge>
          )}
          <Badge>
            <Icon.clock /> {expiryLabel}
          </Badge>
        </div>

        <p className="mt-3 text-xs text-muted">
          {result.usePassword && !result.embedSecret
            ? "Der Schlüssel steckt nicht im Link — teile das Passwort über einen separaten Kanal."
            : "Der Schlüssel steckt hinter # im Link und wird nie an den Server gesendet. Wer den Link hat, kann entschlüsseln."}
        </p>

        {/* Unfurl-Vorschau */}
        <div className="mt-5 border-t border-line pt-5">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
            <Icon.eye /> So erscheint der Link beim Teilen
          </p>
          <SharePreview
            url={result.url}
            fileCount={result.fileCount}
            totalSize={result.totalSize}
            oneTime={result.oneTime}
            passwordProtected={result.usePassword}
            expiresAt={expiresAt}
            imageUrl={secretInLink ? imgUrl : null}
          />
          {!secretInLink && (
            <p className="mt-2 text-xs text-faint">
              Ohne eingebetteten Schlüssel kann keine Inhalts-Vorschau gerendert
              werden.
            </p>
          )}
        </div>

        {/* QR */}
        <div className="mt-4">
          <button
            onClick={() => setShowQr((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-text"
          >
            <Icon.qr /> {showQr ? "QR-Code ausblenden" : "QR-Code anzeigen"}
          </button>
          {showQr && (
            <div className="mt-3 flex justify-center rounded-lg border border-line bg-panel-2/40 py-4">
              <QrCode value={result.url} />
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={onReset} className="flex-1">
            <Icon.plus /> Neuer Link
          </Button>
          <a href={result.url} target="_blank" rel="noreferrer" className="flex-1">
            <Button variant="ghost" className="w-full">
              <Icon.external /> Empfänger-Ansicht
            </Button>
          </a>
          <Link to="/dashboard" className="flex-1">
            <Button variant="ghost" className="w-full">
              <Icon.eye /> Meine Links
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}
