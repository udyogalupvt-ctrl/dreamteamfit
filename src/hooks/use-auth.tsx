import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { initFirebase } from "@/lib/firebase/client";
import { loginWithEmail, logout as logoutService, subscribeToAuth } from "@/services/auth.service";
import type { AppUser } from "@/types";

interface AuthContextValue {
  user: AppUser | null;
  status: "loading" | "authenticated" | "unauthenticated";
  configured: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    initFirebase().then((ok) => {
      if (cancelled) return;
      setConfigured(ok);
      if (!ok) {
        setStatus("unauthenticated");
        return;
      }
      unsubscribe = subscribeToAuth((next) => {
        setUser(next);
        setStatus(next ? "authenticated" : "unauthenticated");
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const login = useCallback(async (email: string, password: string, remember: boolean) => {
    await initFirebase();
    const next = await loginWithEmail(email, password, remember);
    setUser(next);
    setStatus(next ? "authenticated" : "unauthenticated");
  }, []);

  const logout = useCallback(async () => {
    await logoutService();
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, status, configured, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
