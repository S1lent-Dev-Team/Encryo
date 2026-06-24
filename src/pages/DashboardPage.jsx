import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, Button, Input, PasswordInput, Badge, Icon, Spinner } from "../components/ui.jsx";
import QrCode from "../components/QrCode.jsx";
import { listMyLinks, deleteLink, revokeLink } from "../lib/store.js";
import { changeAccountPassword } from "../lib/auth.js";
import { unwrapSecret, wrapSecret, deriveRecoveryKey } from "../lib/crypto.js";
import { getRecoveryKey, setRecoveryKey, getRecoverySalt } from "../lib/recovery.js";
import { buildShareUrl } from "../lib/link.js";
import { formatBytes, formatDate, formatRelative } from "../lib/format.js";
import { useCurrentUser } from "../lib/useAuth.js";

export default function DashboardPage() {
  const { user, loading } = useCurrentUser();
  const [links, setLinks] = useState(null);

  async function refresh() {
    try {
      setLinks(await listMyLinks());
    } catch {
      setLinks([]);
    }
  }
  useEffect(() => {
    if (loading) return;
    if (!user) {
      setLinks(null);
      return;
    }
    setLinks(null);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading]);

  async function handleDelete(id) {
    await deleteLink(id);
    refresh();
  }

  async function handleRevoke(id) {
    if (!window.confirm("Diesen Link sofort & unwiderruflich sperren?")) return;
    await revokeLink(id);
    refresh();
  }

  if (loading)
    return <div className="py-16 text-center text-sm text-muted">Lade…</div>;

  // Dashboard erfordert Login (Server bündelt Links pro Account).
  if (!user) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-panel-2 text-brand">
          <Icon.user size={22} />
        </div>
        <h1 className="text-lg font-semibold">Melde dich an</h1>
        <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted">
          Mit einem Account bündelst du alle deine Links inkl. View-Counter und
          Zugriffs-History – geräteübergreifend.
        </p>
        <Link to="/login" className="mt-6 inline-block">
          <Button>
            <Icon.user /> Anmelden oder registrieren
          </Button>
        </Link>
      </div>
    );
  }

  if (links === null)
    return <div className="py-16 text-center text-sm text-muted">Lade Links…</div>;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Meine Links</h1>
          <p className="mt-1 text-sm text-muted">
            <span className="text-text">{user}</span> · {links.length}{" "}
            {links.length === 1 ? "Link" : "Links"}
          </p>
        </div>
        <Link to="/">
          <Button>
            <Icon.plus /> Neu
          </Button>
        </Link>
      </div>

      <AccountPanel links={links} onChanged={refresh} />

      {links.length === 0 ? (
        <div className="py-16 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-panel-2 text-muted">
            <Icon.link size={20} />
          </div>
          <h2 className="text-base font-semibold">Noch keine Links</h2>
          <p className="mt-1 text-sm text-muted">
            Hier erscheinen deine Links inkl. View-Counter und Zugriffs-History.
          </p>
          <Link to="/" className="mt-5 inline-block">
            <Button>
              <Icon.upload /> Ersten Link erstellen
            </Button>
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {links.map((l) => (
              <LinkRow
                key={l.id}
                link={l}
                onDelete={() => handleDelete(l.id)}
                onRevoke={() => handleRevoke(l.id)}
              />
            ))}
          </div>
          <p className="mt-6 text-center text-[11px] text-faint">
            Der Server speichert den Schlüssel nie im Klartext. Ohne aktivierte
            Wiederherstellung ist der vollständige Share-Link nur direkt nach dem
            Erstellen verfügbar.
          </p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account-Passwort ändern. Re-wrappt clientseitig alle Recovery-Vaults der
// eigenen Links mit dem neuen Passwort, bevor der Server das Passwort umstellt.
function AccountPanel({ links, onChanged }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  const recoverables = links.filter((l) => l.recoverable && l.recovery);

  async function submit() {
    setMsg(null);
    if (next.length < 6)
      return setMsg({ ok: false, text: "Neues Passwort braucht mind. 6 Zeichen." });
    setBusy(true);
    try {
      const salt = getRecoverySalt();
      const items = [];
      if (recoverables.length && salt) {
        const oldKey = await deriveRecoveryKey(current, salt);
        const newKey = await deriveRecoveryKey(next, salt);
        for (const l of recoverables) {
          let secret;
          try {
            secret = await unwrapSecret(oldKey, l.recovery); // wirft bei falschem PW
          } catch {
            setBusy(false);
            return setMsg({ ok: false, text: "Aktuelles Passwort ist falsch." });
          }
          const blob = await wrapSecret(newKey, secret);
          items.push({ id: l.id, iv: blob.iv, ciphertext: blob.ciphertext });
        }
      }
      await changeAccountPassword(current, next, items);
      setMsg({
        ok: true,
        text:
          "Passwort geändert." +
          (items.length ? ` ${items.length} Vault(s) neu verschlüsselt.` : ""),
      });
      setCurrent("");
      setNext("");
      onChanged?.();
    } catch (e) {
      setMsg({ ok: false, text: e.message || "Änderung fehlgeschlagen." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-5 p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-sm font-medium text-text"
      >
        <span className="flex items-center gap-2">
          <Icon.lock className="text-brand" /> Kontoeinstellungen
        </span>
        <Icon.history className={"text-faint transition-transform " + (open ? "rotate-180" : "")} />
      </button>

      {open && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <p className="text-xs text-muted">
            Account-Passwort ändern.{" "}
            {recoverables.length > 0 && (
              <>
                {recoverables.length} wiederherstellbare(r) Link(s) werden dabei
                automatisch neu verschlüsselt — der Server sieht dabei keinen
                Klartext.
              </>
            )}
          </p>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">
              Aktuelles Passwort
            </label>
            <PasswordInput
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">
              Neues Passwort
            </label>
            <PasswordInput
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          {msg && (
            <div
              className={
                "rounded-lg border px-3 py-2 text-sm " +
                (msg.ok
                  ? "border-brand/25 bg-brand/10 text-brand"
                  : "border-danger/25 bg-danger/10 text-danger")
              }
            >
              {msg.text}
            </div>
          )}
          <Button onClick={submit} disabled={busy || !current || !next} className="w-full">
            {busy ? <Spinner /> : <Icon.key />} Passwort ändern
          </Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
function LinkRow({ link, onDelete, onRevoke }) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [showLog, setShowLog] = useState(false);

  // Voll-Link-Recovery (nur bei link.recoverable)
  const [fullUrl, setFullUrl] = useState(null);
  const [fullCopied, setFullCopied] = useState(false);
  const [showFullQr, setShowFullQr] = useState(false);
  const [needPw, setNeedPw] = useState(false);
  const [pw, setPw] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [recErr, setRecErr] = useState("");

  const dead = link.burned || link.expired || link.revoked;
  const baseUrl = `${window.location.origin}/v/${link.id}`;

  async function copy() {
    await navigator.clipboard.writeText(baseUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }
  async function copyFull() {
    await navigator.clipboard.writeText(fullUrl);
    setFullCopied(true);
    setTimeout(() => setFullCopied(false), 1600);
  }

  // Rekonstruiert den vollständigen Share-Link (inkl. #-Secret) aus dem Vault.
  async function revealFullLink(pwArg) {
    setRecErr("");
    let rkey = getRecoveryKey();
    let fresh = false;
    if (!rkey) {
      if (!pwArg) {
        setNeedPw(true);
        return;
      }
      const salt = getRecoverySalt();
      if (!salt) return setRecErr("Bitte neu einloggen.");
      rkey = await deriveRecoveryKey(pwArg, salt); // erst nach Erfolg cachen
      fresh = true;
    }
    setRecovering(true);
    try {
      const secret = await unwrapSecret(rkey, link.recovery); // wirft bei falschem PW
      if (fresh) setRecoveryKey(rkey);
      const url = buildShareUrl(
        link.id,
        secret.t === "p" ? { password: secret.v } : { key: secret.v }
      );
      setFullUrl(url);
      setNeedPw(false);
      setPw("");
    } catch {
      setRecErr("Falsches Account-Passwort.");
    } finally {
      setRecovering(false);
    }
  }

  let statusBadge;
  if (link.revoked)
    statusBadge = (
      <Badge tone="danger">
        <Icon.ban /> gesperrt
      </Badge>
    );
  else if (link.burned)
    statusBadge = (
      <Badge tone="danger">
        <Icon.fire /> verbrannt
      </Badge>
    );
  else if (link.expired)
    statusBadge = (
      <Badge>
        <Icon.clock /> abgelaufen
      </Badge>
    );
  else
    statusBadge = (
      <Badge tone="accent">
        <Icon.shield /> aktiv
      </Badge>
    );

  return (
    <Card className={"p-4 transition-colors hover:border-line-2 " + (dead ? "opacity-60" : "")}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-text">/v/{link.id}</span>
            {statusBadge}
            {link.passwordProtected && (
              <Badge tone="brand">
                <Icon.lock /> PW
              </Badge>
            )}
            {link.oneTime && (
              <Badge tone="danger">
                <Icon.fire /> 1×
              </Badge>
            )}
            {link.recoverable && (
              <Badge tone="brand">
                <Icon.key /> Recovery
              </Badge>
            )}
          </div>
          <p className="mt-1.5 truncate text-sm text-muted">
            {link.filenames.join(", ")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <button
              onClick={() => setShowLog((v) => !v)}
              className="flex items-center gap-1 text-text transition-colors hover:text-brand"
            >
              <Icon.eye />{" "}
              <b>
                {link.viewCount}
                {link.maxViews ? `/${link.maxViews}` : ""}
              </b>
              &nbsp;Aufrufe
              {link.accessLog?.length > 0 && <Icon.history className="opacity-60" />}
            </button>
            <span>erstellt {formatDate(link.createdAt)}</span>
            {link.expiresAt && <span>Ablauf {formatRelative(link.expiresAt)}</span>}
          </div>

          {showLog && (
            <div className="mt-3 rounded-lg border border-line bg-panel-2/40 p-3">
              <p className="mb-1.5 text-xs font-medium text-muted">Zugriffs-History</p>
              {link.accessLog?.length ? (
                <ul className="space-y-1">
                  {link.accessLog
                    .slice()
                    .reverse()
                    .map((ts, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs text-muted">
                        <Icon.eye className="text-faint" />
                        {formatDate(ts)}{" "}
                        <span className="text-faint">({formatRelative(ts)})</span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-xs text-faint">Noch nicht geöffnet.</p>
              )}
            </div>
          )}

          {/* Voll-Link-Recovery */}
          {needPw && !fullUrl && (
            <div className="mt-3 rounded-lg border border-line bg-panel-2/40 p-3">
              <label className="mb-1.5 block text-xs font-medium text-muted">
                Account-Passwort, um den Voll-Link zu rekonstruieren
              </label>
              <div className="flex items-stretch gap-2">
                <PasswordInput
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !recovering && pw && revealFullLink(pw)}
                  placeholder="Account-Passwort…"
                  autoComplete="current-password"
                  autoFocus
                />
                <Button
                  onClick={() => revealFullLink(pw)}
                  disabled={recovering || !pw}
                  className="shrink-0"
                >
                  {recovering ? <Spinner /> : <Icon.key />}
                </Button>
              </div>
              {recErr && <p className="mt-1.5 text-xs text-danger">{recErr}</p>}
            </div>
          )}

          {fullUrl && (
            <div className="mt-3 rounded-lg border border-brand/25 bg-brand/5 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-brand">
                <Icon.key /> Vollständiger Share-Link (inkl. Schlüssel)
              </p>
              <div className="flex items-stretch gap-2">
                <Input readOnly value={fullUrl} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
                <Button onClick={copyFull} className="shrink-0">
                  {fullCopied ? <Icon.check /> : <Icon.copy />}
                  {fullCopied ? "ok" : "Kopieren"}
                </Button>
                <Button variant="ghost" onClick={() => setShowFullQr((v) => !v)} className="shrink-0">
                  <Icon.qr />
                </Button>
              </div>
              {showFullQr && (
                <div className="mt-3 flex justify-center rounded-lg border border-line bg-panel-2/40 py-4">
                  <QrCode value={fullUrl} size={148} />
                </div>
              )}
            </div>
          )}

          {showQr && (
            <div className="mt-3 flex justify-center rounded-lg border border-line bg-panel-2/40 py-4">
              <QrCode value={baseUrl} size={148} />
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-1.5">
          <Button
            variant="outline"
            onClick={copy}
            className="px-2.5 py-1.5 text-xs"
            title="Basis-Link kopieren (ohne Schlüssel)"
          >
            {copied ? <Icon.check /> : <Icon.copy />}
            {copied ? "ok" : "Link"}
          </Button>
          {link.recoverable && !link.revoked && (
            <Button
              variant="outline"
              onClick={() => revealFullLink()}
              disabled={recovering}
              className="px-2.5 py-1.5 text-xs"
              title="Vollständigen Link per Account-Passwort wiederherstellen"
            >
              <Icon.key /> Voll
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => setShowQr((v) => !v)}
            className="px-2.5 py-1.5 text-xs"
          >
            <Icon.qr /> QR
          </Button>
          {!dead && (
            <Button
              variant="ghost"
              onClick={onRevoke}
              className="px-2.5 py-1.5 text-xs text-danger hover:bg-danger/10"
              title="Link sofort sperren (Kill-Switch)"
            >
              <Icon.ban /> Sperren
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={onDelete}
            className="px-2.5 py-1.5 text-xs text-danger hover:bg-danger/10"
            title="Link löschen"
          >
            <Icon.trash />
          </Button>
        </div>
      </div>
    </Card>
  );
}
