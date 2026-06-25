import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Card, Button, Input, PasswordInput, PasswordStrength, Badge, Icon, Spinner, useToast } from "../components/ui.jsx";
import QrCode from "../components/QrCode.jsx";
import { listMyLinks, deleteLink, revokeLink } from "../lib/store.js";
import { changeAccountPassword, listTokens, createToken, deleteToken } from "../lib/auth.js";
import { unwrapSecret, wrapSecret, deriveRecoveryKey } from "../lib/crypto.js";
import { getRecoveryKey, setRecoveryKey, getRecoverySalt } from "../lib/recovery.js";
import { buildShareUrl } from "../lib/link.js";
import { formatBytes, formatDate, formatRelative } from "../lib/format.js";
import { useCurrentUser } from "../lib/useAuth.js";
import { useI18n } from "../lib/i18n.js";

export default function DashboardPage() {
  const { user, loading } = useCurrentUser();
  const { t } = useI18n();
  const toast = useToast();
  const [links, setLinks] = useState(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | active | inactive
  const [sort, setSort] = useState("new"); // new | old | views
  const [selected, setSelected] = useState(() => new Set());

  async function refresh() {
    try {
      setLinks(await listMyLinks());
    } catch {
      setLinks([]);
    }
    setSelected(new Set());
  }

  const toggleSelect = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
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

  // "/" fokussiert die Suche (außer man tippt gerade in einem Feld).
  useEffect(() => {
    function onKey(e) {
      if (e.key !== "/") return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable)
        return;
      const el = document.getElementById("dash-search");
      if (el) {
        e.preventDefault();
        el.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function handleDelete(id) {
    if (!window.confirm(t("dash.confirmDelete"))) return;
    await deleteLink(id);
    toast(t("dash.toast.deleted"));
    refresh();
  }

  async function handleRevoke(id) {
    if (!window.confirm(t("dash.confirmRevoke"))) return;
    await revokeLink(id);
    toast(t("dash.toast.revoked"), "error");
    refresh();
  }

  async function bulkRevoke() {
    const ids = [...selected];
    if (!ids.length || !window.confirm(t("dash.confirmBulkRevoke", { n: ids.length }))) return;
    for (const id of ids) {
      try {
        await revokeLink(id);
      } catch {
        /* überspringen */
      }
    }
    toast(t("dash.toast.bulkRevoked", { n: ids.length }), "error");
    refresh();
  }

  async function bulkDelete() {
    const ids = [...selected];
    if (!ids.length || !window.confirm(t("dash.confirmBulkDelete", { n: ids.length }))) return;
    for (const id of ids) {
      try {
        await deleteLink(id);
      } catch {
        /* überspringen */
      }
    }
    toast(t("dash.toast.bulkDeleted", { n: ids.length }));
    refresh();
  }

  const filtered = useMemo(() => {
    if (!links) return [];
    const q = query.trim().toLowerCase();
    let arr = links.filter((l) => {
      if (
        q &&
        !l.id.toLowerCase().includes(q) &&
        !l.filenames.join(" ").toLowerCase().includes(q)
      )
        return false;
      const dead = l.burned || l.expired || l.revoked;
      if (statusFilter === "active") return !dead;
      if (statusFilter === "inactive") return dead;
      return true;
    });
    arr = [...arr];
    if (sort === "old") arr.sort((a, b) => a.createdAt - b.createdAt);
    else if (sort === "views") arr.sort((a, b) => b.viewCount - a.viewCount);
    else arr.sort((a, b) => b.createdAt - a.createdAt);
    return arr;
  }, [links, query, statusFilter, sort]);

  if (loading)
    return <div className="py-16 text-center text-sm text-muted">{t("dash.loading")}</div>;

  // Dashboard erfordert Login (Server bündelt Links pro Account).
  if (!user) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-panel-2 text-brand">
          <Icon.user size={22} />
        </div>
        <h1 className="text-lg font-semibold">{t("dash.signInTitle")}</h1>
        <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted">{t("dash.signInBody")}</p>
        <Link to="/login" className="mt-6 inline-block">
          <Button>
            <Icon.user /> {t("common.signInOrRegister")}
          </Button>
        </Link>
      </div>
    );
  }

  if (links === null)
    return <div className="py-16 text-center text-sm text-muted">{t("dash.loadingLinks")}</div>;

  const linkWord = t(links.length === 1 ? "common.link.one" : "common.link.other");
  const totalStored = links.reduce((s, l) => s + (l.totalSize || 0), 0);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("dash.myLinks")}</h1>
          <p className="mt-1 text-sm text-muted">
            <span className="text-text">{user}</span> · {links.length} {linkWord}
            {totalStored > 0 && <> · {t("dash.storage", { used: formatBytes(totalStored) })}</>}
          </p>
        </div>
        <Link to="/">
          <Button>
            <Icon.plus /> {t("dash.new")}
          </Button>
        </Link>
      </div>

      <AccountPanel links={links} onChanged={refresh} />
      <TokenPanel toast={toast} />

      {links.length === 0 ? (
        <div className="py-16 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-panel-2 text-muted">
            <Icon.link size={20} />
          </div>
          <h2 className="text-base font-semibold">{t("dash.empty.title")}</h2>
          <p className="mt-1 text-sm text-muted">{t("dash.empty.body")}</p>
          <Link to="/" className="mt-5 inline-block">
            <Button>
              <Icon.upload /> {t("dash.empty.cta")}
            </Button>
          </Link>
        </div>
      ) : (
        <>
          {/* Suche / Filter / Sortierung */}
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-faint">
                <Icon.search />
              </span>
              <Input
                id="dash-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("dash.search")}
                className="pl-9"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm text-text outline-none transition-colors focus:border-line-2"
            >
              <option value="all">{t("dash.filter.all")}</option>
              <option value="active">{t("dash.filter.active")}</option>
              <option value="inactive">{t("dash.filter.inactive")}</option>
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm text-text outline-none transition-colors focus:border-line-2"
            >
              <option value="new">{t("dash.sort.new")}</option>
              <option value="old">{t("dash.sort.old")}</option>
              <option value="views">{t("dash.sort.views")}</option>
            </select>
          </div>

          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">{t("dash.noMatches")}</p>
          ) : (
            <>
              {/* Auswahl-/Bulk-Leiste */}
              <div className="mb-3 flex min-h-8 items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    className="accent-brand"
                    checked={filtered.every((l) => selected.has(l.id))}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? new Set(filtered.map((l) => l.id)) : new Set()
                      )
                    }
                  />
                  {t("dash.bulk.selectAll")}
                </label>
                {selected.size > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted">
                      {t("dash.bulk.selected", { n: selected.size })}
                    </span>
                    <Button
                      variant="outline"
                      onClick={bulkRevoke}
                      className="px-2.5 py-1.5 text-xs text-danger"
                    >
                      <Icon.ban /> {t("dash.bulk.revoke")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={bulkDelete}
                      className="px-2.5 py-1.5 text-xs text-danger"
                    >
                      <Icon.trash /> {t("dash.bulk.delete")}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setSelected(new Set())}
                      className="px-2.5 py-1.5 text-xs"
                    >
                      {t("dash.bulk.clear")}
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                {filtered.map((l) => (
                  <LinkRow
                    key={l.id}
                    link={l}
                    toast={toast}
                    selected={selected.has(l.id)}
                    onToggleSelect={() => toggleSelect(l.id)}
                    onDelete={() => handleDelete(l.id)}
                    onRevoke={() => handleRevoke(l.id)}
                  />
                ))}
              </div>
            </>
          )}
          <p className="mt-6 text-center text-[11px] text-faint">{t("dash.footer")}</p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account-Passwort ändern. Re-wrappt clientseitig alle Recovery-Vaults der
// eigenen Links mit dem neuen Passwort, bevor der Server das Passwort umstellt.
function AccountPanel({ links, onChanged }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  const recoverables = links.filter((l) => l.recoverable && l.recovery);

  async function submit() {
    setMsg(null);
    if (next.length < 6) return setMsg({ ok: false, text: t("acct.err.newShort") });
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
            return setMsg({ ok: false, text: t("acct.err.currentWrong") });
          }
          const blob = await wrapSecret(newKey, secret);
          items.push({ id: l.id, iv: blob.iv, ciphertext: blob.ciphertext });
        }
      }
      await changeAccountPassword(current, next, items);
      setMsg({
        ok: true,
        text: t("acct.changed") + (items.length ? t("acct.changedVaults", { n: items.length }) : ""),
      });
      setCurrent("");
      setNext("");
      onChanged?.();
    } catch (e) {
      setMsg({ ok: false, text: e.message || t("acct.err.changeFail") });
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
          <Icon.lock className="text-brand" /> {t("acct.title")}
        </span>
        <Icon.history className={"text-faint transition-transform " + (open ? "rotate-180" : "")} />
      </button>

      {open && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <p className="text-xs text-muted">
            {t("acct.intro")}
            {recoverables.length > 0 && t("acct.introRecover", { n: recoverables.length })}
          </p>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">
              {t("acct.current")}
            </label>
            <PasswordInput
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">
              {t("acct.new")}
            </label>
            <PasswordInput
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
            />
            <PasswordStrength password={next} />
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
            {busy ? <Spinner /> : <Icon.key />} {t("acct.submit")}
          </Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// API-Tokens für CLI/Skripte: erstellen (Rohwert einmalig sichtbar) & widerrufen.
function TokenPanel({ toast }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(null); // einmalig angezeigter Roh-Token

  async function load() {
    try {
      setTokens(await listTokens());
    } catch {
      setTokens([]);
    }
  }
  useEffect(() => {
    if (open && tokens === null) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function create() {
    setBusy(true);
    try {
      const r = await createToken(label.trim());
      setFresh(r.token);
      setLabel("");
      load();
    } catch {
      /* ignorieren */
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id) {
    if (!window.confirm(t("tokens.confirmRevoke"))) return;
    await deleteToken(id);
    toast(t("tokens.toast.revoked"), "error");
    load();
  }

  return (
    <Card className="mb-5 p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-sm font-medium text-text"
      >
        <span className="flex items-center gap-2">
          <Icon.terminal className="text-brand" /> {t("tokens.title")}
        </span>
        <Icon.history className={"text-faint transition-transform " + (open ? "rotate-180" : "")} />
      </button>

      {open && (
        <div className="mt-4 space-y-3 border-t border-line pt-4">
          <p className="text-xs text-muted">{t("tokens.intro")}</p>

          {fresh && (
            <div className="rounded-lg border border-brand/25 bg-brand/5 p-3">
              <p className="mb-1.5 text-xs font-medium text-brand">{t("tokens.createdOnce")}</p>
              <div className="flex items-stretch gap-2">
                <Input
                  readOnly
                  value={fresh}
                  onFocus={(e) => e.target.select()}
                  className="font-mono text-xs"
                />
                <Button
                  onClick={async () => {
                    await navigator.clipboard.writeText(fresh);
                    toast(t("tokens.copied"));
                  }}
                  className="shrink-0"
                >
                  <Icon.copy /> {t("row.copy")}
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-stretch gap-2">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("tokens.labelPlaceholder")}
            />
            <Button onClick={create} disabled={busy} className="shrink-0">
              {busy ? <Spinner /> : <Icon.plus />} {t("tokens.create")}
            </Button>
          </div>

          {tokens === null ? null : tokens.length === 0 ? (
            <p className="text-xs text-faint">{t("tokens.none")}</p>
          ) : (
            <ul className="space-y-2">
              {tokens.map((tk) => (
                <li
                  key={tk.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line bg-panel-2/40 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-text">{tk.label || tk.id.slice(0, 8)}</p>
                    <p className="text-xs text-muted">
                      {t("row.created", { date: formatDate(tk.createdAt, lang) })} ·{" "}
                      {tk.lastUsed
                        ? t("tokens.lastUsed", { rel: formatRelative(tk.lastUsed, lang) })
                        : t("tokens.neverUsed")}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => revoke(tk.id)}
                    className="shrink-0 px-2.5 py-1.5 text-xs text-danger hover:bg-danger/10"
                  >
                    <Icon.trash /> {t("tokens.revoke")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Kebab-Menü für die Zeilen-Aktionen (mobil). actions: [{ key, icon, label,
// onClick?|href?, danger? }]. Schließt bei Außenklick/Escape.
function RowMenu({ actions }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemCls = (danger) =>
    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-panel-2 " +
    (danger ? "text-danger" : "text-text");

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("row.actions")}
        className="rounded-md p-1.5 text-muted transition-colors hover:bg-panel-2 hover:text-text"
      >
        <Icon.dots />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-panel shadow-lg"
        >
          {actions.map((a) =>
            a.href ? (
              <a
                key={a.key}
                href={a.href}
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                onClick={() => setOpen(false)}
                className={itemCls(a.danger)}
              >
                {a.icon} {a.label}
              </a>
            ) : (
              <button
                key={a.key}
                role="menuitem"
                disabled={a.disabled}
                onClick={() => {
                  setOpen(false);
                  a.onClick?.();
                }}
                className={itemCls(a.danger) + " disabled:opacity-40"}
              >
                {a.icon} {a.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function LinkRow({ link, toast, selected, onToggleSelect, onDelete, onRevoke }) {
  const { t, lang } = useI18n();
  const [showQr, setShowQr] = useState(false);
  const [showLog, setShowLog] = useState(false);

  // Voll-Link-Recovery (nur bei link.recoverable)
  const [fullUrl, setFullUrl] = useState(null);
  const [showFullQr, setShowFullQr] = useState(false);
  const [needPw, setNeedPw] = useState(false);
  const [pw, setPw] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [recErr, setRecErr] = useState("");

  const dead = link.burned || link.expired || link.revoked;
  const baseUrl = `${window.location.origin}/v/${link.id}`;
  const shareUrl = fullUrl || baseUrl;
  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  async function copy() {
    await navigator.clipboard.writeText(baseUrl);
    toast?.(t("row.toast.copyBase"));
  }
  async function copyFull() {
    await navigator.clipboard.writeText(fullUrl);
    toast?.(t("row.toast.copyFull"));
  }
  async function share() {
    try {
      await navigator.share({ title: "Encryo", url: shareUrl });
    } catch {
      /* abgebrochen */
    }
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
      if (!salt) return setRecErr(t("row.recover.loginAgain"));
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
      setRecErr(t("row.recover.wrongPw"));
    } finally {
      setRecovering(false);
    }
  }

  let statusBadge;
  if (link.revoked)
    statusBadge = (
      <Badge tone="danger">
        <Icon.ban /> {t("row.status.revoked")}
      </Badge>
    );
  else if (link.burned)
    statusBadge = (
      <Badge tone="danger">
        <Icon.fire /> {t("row.status.burned")}
      </Badge>
    );
  else if (link.expired)
    statusBadge = (
      <Badge>
        <Icon.clock /> {t("row.status.expired")}
      </Badge>
    );
  else
    statusBadge = (
      <Badge tone="accent">
        <Icon.shield /> {t("row.status.active")}
      </Badge>
    );

  // Aktionen einmal definieren -> Desktop-Spalte UND mobiles Kebab-Menü.
  const actions = [
    {
      key: "copy",
      icon: <Icon.copy />,
      label: t("row.btn.link"),
      title: t("row.title.copyBase"),
      onClick: copy,
      variant: "outline",
    },
    link.recoverable &&
      !link.revoked && {
        key: "full",
        icon: <Icon.key />,
        label: t("row.btn.full"),
        title: t("row.title.full"),
        onClick: () => revealFullLink(),
        variant: "outline",
        disabled: recovering,
      },
    !dead && {
      key: "open",
      icon: <Icon.external />,
      label: t("row.btn.open"),
      title: t("row.title.open"),
      href: shareUrl,
      variant: "ghost",
    },
    canShare && {
      key: "share",
      icon: <Icon.share />,
      label: t("row.btn.share"),
      title: t("row.title.share"),
      onClick: share,
      variant: "ghost",
    },
    {
      key: "qr",
      icon: <Icon.qr />,
      label: "QR",
      onClick: () => setShowQr((v) => !v),
      variant: "ghost",
    },
    !dead && {
      key: "revoke",
      icon: <Icon.ban />,
      label: t("row.btn.revoke"),
      title: t("row.title.revoke"),
      onClick: onRevoke,
      variant: "ghost",
      danger: true,
    },
    {
      key: "delete",
      icon: <Icon.trash />,
      label: t("row.btn.delete"),
      title: t("row.title.delete"),
      onClick: onDelete,
      variant: "ghost",
      danger: true,
    },
  ].filter(Boolean);

  return (
    <Card
      className={
        "p-4 transition-colors hover:border-line-2 " +
        (dead ? "opacity-60 " : "") +
        (selected ? "border-brand/40" : "")
      }
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 accent-brand"
          checked={!!selected}
          onChange={onToggleSelect}
          aria-label={t("dash.select")}
        />
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
          <p className="mt-1.5 truncate text-sm text-muted" title={link.filenames.join(", ")}>
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
              &nbsp;{t("row.views")}
              {link.accessLog?.length > 0 && <Icon.history className="opacity-60" />}
            </button>
            {link.totalSize > 0 && <span>{formatBytes(link.totalSize)}</span>}
            <span>{t("row.created", { date: formatDate(link.createdAt, lang) })}</span>
            {link.expiresAt && (
              <span>{t("row.expires", { rel: formatRelative(link.expiresAt, lang) })}</span>
            )}
          </div>

          {showLog && (
            <div className="mt-3 rounded-lg border border-line bg-panel-2/40 p-3">
              <p className="mb-1.5 text-xs font-medium text-muted">{t("row.accessHistory")}</p>
              {link.accessLog?.length ? (
                <ul className="space-y-1">
                  {link.accessLog
                    .slice()
                    .reverse()
                    .map((ts, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs text-muted">
                        <Icon.eye className="text-faint" />
                        {formatDate(ts, lang)}{" "}
                        <span className="text-faint">({formatRelative(ts, lang)})</span>
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="text-xs text-faint">{t("row.notOpened")}</p>
              )}
            </div>
          )}

          {/* Voll-Link-Recovery */}
          {needPw && !fullUrl && (
            <div className="mt-3 rounded-lg border border-line bg-panel-2/40 p-3">
              <label className="mb-1.5 block text-xs font-medium text-muted">
                {t("row.recover.label")}
              </label>
              <div className="flex items-stretch gap-2">
                <PasswordInput
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !recovering && pw && revealFullLink(pw)}
                  placeholder={t("row.recover.placeholder")}
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
                <Icon.key /> {t("row.fullLink")}
              </p>
              <div className="flex items-stretch gap-2">
                <Input readOnly value={fullUrl} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
                <Button onClick={copyFull} className="shrink-0">
                  <Icon.copy /> {t("row.copy")}
                </Button>
                <Button variant="ghost" onClick={() => setShowFullQr((v) => !v)} className="shrink-0">
                  <Icon.qr />
                </Button>
              </div>
              {showFullQr && (
                <div className="mt-3 flex justify-center rounded-lg border border-line bg-panel-2/40 py-4">
                  <QrCode value={fullUrl} size={148} downloadName={`encryo-${link.id}.png`} />
                </div>
              )}
            </div>
          )}

          {showQr && (
            <div className="mt-3 flex justify-center rounded-lg border border-line bg-panel-2/40 py-4">
              <QrCode value={baseUrl} size={148} downloadName={`encryo-${link.id}.png`} />
            </div>
          )}
        </div>

        {/* Desktop: Spalte mit allen Aktionen */}
        <div className="hidden shrink-0 flex-col gap-1.5 sm:flex">
          {actions.map((a) =>
            a.href ? (
              <a key={a.key} href={a.href} target="_blank" rel="noreferrer">
                <Button
                  variant="ghost"
                  className="w-full px-2.5 py-1.5 text-xs"
                  title={a.title}
                >
                  {a.icon} {a.label}
                </Button>
              </a>
            ) : (
              <Button
                key={a.key}
                variant={a.variant}
                onClick={a.onClick}
                disabled={a.disabled}
                title={a.title}
                className={
                  "px-2.5 py-1.5 text-xs " + (a.danger ? "text-danger hover:bg-danger/10" : "")
                }
              >
                {a.icon} {a.label}
              </Button>
            )
          )}
        </div>

        {/* Mobil: kompaktes Kebab-Menü */}
        <div className="shrink-0 sm:hidden">
          <RowMenu actions={actions} />
        </div>
      </div>
    </Card>
  );
}
