import { Routes, Route, Link, NavLink, useNavigate } from "react-router-dom";
import UploadPage from "./pages/UploadPage.jsx";
import ViewPage from "./pages/ViewPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import { Icon } from "./components/ui.jsx";
import { useCurrentUser } from "./lib/useAuth.js";
import { logout } from "./lib/auth.js";

function Header() {
  const { user, loading } = useCurrentUser();
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
            Upload
          </NavLink>
          <NavLink to="/dashboard" className={navCls}>
            Meine Links
          </NavLink>
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
                title="Abmelden"
                aria-label="Abmelden"
              >
                <Icon.logout />
              </button>
            </div>
          ) : (
            <NavLink to="/login" className={navCls}>
              Anmelden
            </NavLink>
          )}
        </nav>
      </div>
    </header>
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
      <footer className="relative z-10 mx-auto max-w-5xl px-5 pb-6 pt-2">
        <p className="text-center text-[11px] text-faint">
          Ende-zu-Ende verschlüsselt im Browser · Prototyp (Storage lokal)
        </p>
      </footer>
    </div>
  );
}
