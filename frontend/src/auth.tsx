import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, tokenStore } from "./api";
import type { Role, TokenResponse, User } from "./types";

interface AuthValue {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, role: Role) => Promise<User>;
  adopt: (session: TokenResponse) => User;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the session from the stored token on first paint.
  useEffect(() => {
    const token = tokenStore.get();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => {
        tokenStore.clear();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const adopt = useCallback((session: TokenResponse) => {
    tokenStore.set(session.access_token);
    setUser(session.user);
    return session.user;
  }, []);

  const login = useCallback(
    async (username: string, password: string, role: Role) => {
      const session = await api.login(username, password, role);
      return adopt(session);
    },
    [adopt],
  );

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!tokenStore.get()) return;
    try {
      setUser(await api.me());
    } catch {
      tokenStore.clear();
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, adopt, logout, refresh }),
    [user, loading, login, adopt, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
