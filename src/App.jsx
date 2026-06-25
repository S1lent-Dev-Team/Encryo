import { useEffect, useState } from "react";
import { Routes, Route, Link, NavLink, useNavigate } from "react-router-dom";
import UploadPage from "./pages/UploadPage.jsx";
import ViewPage from "./pages/ViewPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import { Icon } from "./components/ui.jsx";
import { useCurrentUser } from "./lib/useAuth.js";
import { logout } from "./lib/auth.js";
import { useI18n } from "./lib/i18n.js";

function ThemeToggle() {
  const { t } = useI18n();
  // Quelle der Wahrheit ist das data-theme am <html> (früh per Inline-Script gesetzt).
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme || "dark"
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f6f7f9" : "#0a0b0d");
    try {
      localStorage.setItem("encryo:theme", theme);
    } catch {
      /* ignorieren */
    }
  }, [theme]);
  const dark = theme !== "light";
  return (
    <button
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="rounded-md p-1.5 text-muted transition-colors hover:bg-panel-2 hover:text-text"
      title={t("theme.toggle")}
      aria-label={t("theme.toggle")}
    >
      {dark ? <Icon.sun /> : <Icon.moon />}
    </button>
  );
}

function LangToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <div
      className="flex items-center rounded-md border border-line bg-panel-2/60 p-0.5 text-[11px] font-semibold"
      role="group"
      aria-label={t("lang.label")}
    >
      {["de", "en"].map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={
            "rounded px-1.5 py-0.5 uppercase transition-colors " +
            (lang === l ? "bg-brand/15 text-brand" : "text-faint hover:text-text")
          }
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Header() {
  const { user, loading } = useCurrentUser();
  const { t } = useI18n();
  const navigate = useNavigate();
  const navCls = ({ isActive }) =>
    "rounded-md px-2.5 py-1.5 text-sm transition-colors " +
    (isActive ? "text-text" : "text-muted hover:text-text");

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-brand to-brand-2 text-ink shadow-sm shadow-brand/20">
            <Icon.shield size={16} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Encryo</span>
        </Link>

        <nav className="flex items-center gap-1">
          <NavLink to="/" className={navCls} end>
            {t("nav.upload")}
          </NavLink>
          <NavLink to="/dashboard" className={navCls}>
            {t("nav.myLinks")}
          </NavLink>
          <span className="mx-1 h-4 w-px bg-line" />
          <LangToggle />
          <ThemeToggle />
          <span className="mx-1 h-4 w-px bg-line" />
          {loading ? (
            <span className="h-6 w-16 animate-pulse rounded-md bg-panel-2" />
          ) : user ? (
            <div className="flex items-center gap-1">
              <span className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted">
                <Icon.user className="text-brand" />
                {user}
              </span>
              <button
                onClick={async () => {
                  await logout();
                  navigate("/");
                }}
                className="rounded-md p-1.5 text-muted transition-colors hover:bg-panel-2 hover:text-text"
                title={t("header.signOut")}
                aria-label={t("header.signOut")}
              >
                <Icon.logout />
              </button>
            </div>
          ) : (
            <NavLink to="/login" className={navCls}>
              {t("nav.signIn")}
            </NavLink>
          )}
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  const { t } = useI18n();
  return (
    <footer className="relative z-10 mx-auto max-w-5xl px-5 pb-6 pt-2">
      <p className="text-center text-[11px] text-faint">{t("footer.tagline")}</p>
      <p className="mt-1 text-center text-[11px] text-faint">
        {t("footer.credit")}{" "}
        <a
          href="https://s1lent.dev"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-muted transition-colors hover:text-brand"
        >
          S1lent
        </a>
      </p>
    </footer>
  );
}

export default function App() {
  return (
    <div className="app-glow relative flex min-h-full flex-col">
      <Header />
      <main className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-5 py-10">
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/v/:id" element={<ViewPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<UploadPage />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
