import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Card, Button, Input, PasswordInput, Badge, Icon, Spinner } from "../components/ui.jsx";
import { getLinkMeta, openLink, getLinkRecovery } from "../lib/store.js";
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
import { formatBytes } from "../lib/format.js";

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

    if (meta.passwordProtected && !pw) return setError("Bitte Passwort eingeben.");

    let key;
    try {
      key = await resolveKey({ salt: meta.salt, fragment: keyFrag, password: pw });
    } catch (e) {
      if (e.message === "KEY_MISSING")
        return setError(
          "Diesem Link fehlt der Schlüssel (#…). Füge ihn unten ein – oder stelle ihn als Eigentümer wieder her."
        );
      return setError("Schlüssel konnte nicht aufgebaut werden.");
    }

    // Key prüfen BEVOR geöffnet wird (One-Time würde sonst verbrennen)
    if (!(await checkVerifier(key, meta.verifier))) {
      return setError(
        meta.passwordProtected
          ? "Falsches Passwort."
          : "Schlüssel passt nicht — Link beschädigt oder Schlüssel falsch eingefügt."
      );
    }

    try {
      setPhase("opening");
      const res = await openLink(id);
      if (!res.ok) {
        setGoneReason(res.reason);
        setPhase("gone");
        return;
      }
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
          isImage: (f.mimetype || "").startsWith("image/"),
        });
      }
      setFiles(decrypted);
      setViewCount(res.meta.viewCount);
      setPhase("opened");
    } catch (e) {
      console.error(e);
      setError("Entschlüsselung fehlgeschlagen.");
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
      if (!salt) return setError("Bitte zuerst einloggen, um wiederherzustellen.");
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
      if (e.status === 403)
        setError("Nur der Eigentümer dieses Links kann ihn wiederherstellen.");
      else if (e.status === 404)
        setError("Für diesen Link gibt es keinen Recovery-Vault.");
      else
        setError("Falsches Account-Passwort oder Wiederherstellung fehlgeschlagen.");
    } finally {
      setRecovering(false);
    }
  }

  if (phase === "loading" || (phase === "gate" && !meta.oneTime && haveSecret))
    return (
      <Centered>
        <div className="flex items-center gap-3 text-muted">
          <Spinner size={18} /> Entschlüssele…
        </div>
      </Centered>
    );
  if (phase === "gone") return <GoneView reason={goneReason} />;
  if (phase === "opened")
    return <OpenedView files={files} meta={meta} viewCount={viewCount} />;

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
  const needsKey = !meta.passwordProtected && frag.type !== "key";
  const needsPasswordInput = meta.passwordProtected && frag.type !== "password";
  const canRecover = meta.recoverable && !!user;
  const openDisabled = busy || recovering || (needsKey && !manualKey.trim());

  return (
    <div className="mx-auto max-w-md">
      <Card className="animate-in p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-panel-2 text-brand">
            {meta.oneTime ? <Icon.fire size={20} /> : <Icon.lock size={20} />}
          </span>
          <div>
            <h1 className="text-base font-semibold">
              {meta.fileCount === 1 ? "1 Datei" : `${meta.fileCount} Dateien`} ·{" "}
              {formatBytes(meta.totalSize)}
            </h1>
            <p className="text-xs text-muted">verschlüsselt · wartet auf dich</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {meta.passwordProtected && (
            <Badge tone="brand">
              <Icon.lock /> Passwort
            </Badge>
          )}
          {meta.oneTime && (
            <Badge tone="danger">
              <Icon.fire /> One-Time
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
            Dieser Link kann <b>nur einmal</b> geöffnet werden. Danach ist der
            Inhalt unwiderruflich gesperrt — auch für dich.
          </div>
        )}

        {needsKey && (
          <div className="mt-4">
            <div className="rounded-lg border border-line bg-panel-2/40 px-3 py-2.5 text-sm text-muted">
              Diesem Link fehlt der Schlüssel hinter <code>#</code> — er wurde
              vermutlich unvollständig kopiert. Füge ihn hier ein:
            </div>
            <div className="mt-3">
              <Input
                value={manualKey}
                onChange={(e) => setManualKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !openDisabled && onOpen()}
                placeholder="Schlüssel oder ganzen Link einfügen…"
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
              placeholder="Passwort eingeben…"
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
              <Spinner /> Entschlüsseln…
            </>
          ) : meta.oneTime ? (
            <>
              <Icon.fire /> Einmalig öffnen
            </>
          ) : (
            <>
              <Icon.unlock /> Entschlüsseln & anzeigen
            </>
          )}
        </Button>

        {/* Owner-Recovery: nur sinnvoll, wenn ein Vault existiert und man eingeloggt ist */}
        {canRecover && (
          <div className="mt-4 border-t border-line pt-4">
            {needAccountPw ? (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted">
                  Account-Passwort zum Wiederherstellen
                </label>
                <PasswordInput
                  value={accountPw}
                  onChange={(e) => setAccountPw(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !recovering && onRecover(accountPw)}
                  placeholder="Dein Account-Passwort…"
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
                  Wiederherstellen
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
                Mit Account-Passwort wiederherstellen
              </Button>
            )}
          </div>
        )}

        <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-faint">
          <Icon.shield className="text-brand" /> Entschlüsselung passiert in deinem
          Browser
        </p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
function OpenedView({ files, meta, viewCount }) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel-2 text-brand">
            <Icon.unlock size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold">Entschlüsselt</h1>
            <p className="text-xs text-muted">
              {files.length} {files.length === 1 ? "Datei" : "Dateien"} · {viewCount}.
              Öffnung
            </p>
          </div>
        </div>
        {meta.oneTime && (
          <Badge tone="danger">
            <Icon.fire /> jetzt verbrannt
          </Badge>
        )}
      </div>

      {meta.oneTime && (
        <div className="mb-4 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2.5 text-sm text-danger">
          Das war die einzige Öffnung — lade dir jetzt, was du brauchst. Beim
          Neuladen ist der Link weg.
        </div>
      )}

      <div className="space-y-3">
        {files.map((f, i) => (
          <Card key={i} className="overflow-hidden">
            {f.isImage && (
              <img
                src={f.url}
                alt={f.filename}
                className="max-h-[440px] w-full bg-panel-2 object-contain"
              />
            )}
            <div className="flex items-center gap-3 p-3.5">
              <span className="text-faint">
                {f.isImage ? <Icon.image /> : <Icon.file />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-text">{f.filename}</p>
                <p className="text-xs text-muted">
                  {formatBytes(f.size)} · {f.mimetype}
                </p>
              </div>
              <a href={f.url} download={f.filename}>
                <Button variant="outline">
                  <Icon.download /> Download
                </Button>
              </a>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-6 text-center">
        <Link to="/" className="text-sm text-brand hover:underline">
          Eigene Datei verschlüsselt teilen →
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function GoneView({ reason }) {
  const map = {
    NOT_FOUND: { icon: <Icon.x size={22} />, t: "Link nicht gefunden", d: "Dieser Link existiert nicht (mehr)." },
    EXPIRED: { icon: <Icon.clock size={22} />, t: "Link abgelaufen", d: "Die Gültigkeitsdauer ist überschritten." },
    BURNED: { icon: <Icon.fire size={22} />, t: "Bereits geöffnet", d: "Dieser Link wurde schon (oft genug) abgerufen und ist gesperrt." },
    REVOKED: { icon: <Icon.ban size={22} />, t: "Vom Eigentümer gesperrt", d: "Der Eigentümer hat diesen Link manuell gesperrt." },
  };
  const info = map[reason] || map.NOT_FOUND;
  return (
    <Centered>
      <Card className="w-full max-w-md p-8 text-center animate-in">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-panel-2 text-xl text-muted">
          {info.icon}
        </div>
        <h1 className="text-lg font-semibold">{info.t}</h1>
        <p className="mt-1 text-sm text-muted">{info.d}</p>
        <Link to="/" className="mt-6 inline-block">
          <Button variant="outline">
            <Icon.upload /> Eigenen Link erstellen
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
