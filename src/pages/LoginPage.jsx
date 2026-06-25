import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Button, Input, Icon, Spinner } from "../components/ui.jsx";
import { login, register } from "../lib/auth.js";
import { useI18n } from "../lib/i18n.js";

export default function LoginPage() {
  const { t } = useI18n();
  const [mode, setMode] = useState("login"); // login | register
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "register") await register(username, password);
      else await login(username, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message || t("login.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold tracking-tight">
          {mode === "login" ? t("login.signIn") : t("login.createAccount")}
        </h1>
        <p className="mt-1 text-sm text-muted">{t("login.subtitle")}</p>
      </div>

      <Card className="animate-in p-5">
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">
              {t("login.username")}
            </label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("login.usernamePlaceholder")}
              autoFocus
              autoComplete="username"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted">
              {t("login.password")}
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? (
              <Spinner />
            ) : mode === "login" ? (
              <>
                <Icon.user /> {t("login.signIn")}
              </>
            ) : (
              <>
                <Icon.plus /> {t("login.createAccount")}
              </>
            )}
          </Button>
        </form>
      </Card>

      <p className="mt-4 text-center text-sm text-muted">
        {mode === "login" ? t("login.noAccount") : t("login.haveAccount")}{" "}
        <button
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
          className="text-brand hover:underline"
        >
          {mode === "login" ? t("login.toRegister") : t("login.toLogin")}
        </button>
      </p>

      <p className="mt-6 text-center text-[11px] text-faint">{t("login.footer")}</p>
    </div>
  );
}
