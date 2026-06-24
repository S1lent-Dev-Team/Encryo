import { useEffect, useState } from "react";
import { fetchMe } from "./auth.js";

// Reaktiver Auth-Status. Lädt /api/auth/me und aktualisiert sich bei Login/Logout
// (eigenes Event) sowie bei Änderungen in anderen Tabs (storage-Event als Hint).
// Rückgabe: { user: string|null, loading: boolean }
export function useCurrentUser() {
  const [state, setState] = useState({ user: null, loading: true });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const u = await fetchMe();
      if (alive) setState({ user: u, loading: false });
    };
    load();
    window.addEventListener("encryo:auth", load);
    return () => {
      alive = false;
      window.removeEventListener("encryo:auth", load);
    };
  }, []);

  return state;
}
