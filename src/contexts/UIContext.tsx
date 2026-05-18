import { createContext, useState } from "react";
import type { ReactNode } from "react";

// ── Admin auth (mirrors useAdminAuth in AdminLoginDialog.tsx) ─────────────────

const ADMIN_ID = "duagydid";
const ADMIN_PW = "1234";
const STORAGE_KEY = "admin_logged_in";
const EXPIRE_KEY = "admin_expire";

// ── Context value type ────────────────────────────────────────────────────────

export interface UIContextValue {
  isAdmin: boolean;
  loginDialogOpen: boolean;
  setLoginDialogOpen: (open: boolean) => void;
  login: (id: string, pw: string) => boolean;
  logout: () => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

export const UIContext = createContext<UIContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function UIProvider({ children }: { children: ReactNode }) {
  const [isAdmin, setIsAdmin] = useState(() => {
    const expire = localStorage.getItem(EXPIRE_KEY);
    return (
      localStorage.getItem(STORAGE_KEY) === "true" &&
      expire !== null &&
      Date.now() < Number(expire)
    );
  });
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);

  const login = (id: string, pw: string): boolean => {
    if (id === ADMIN_ID && pw === ADMIN_PW) {
      localStorage.setItem(STORAGE_KEY, "true");
      localStorage.setItem(
        EXPIRE_KEY,
        String(Date.now() + 7 * 24 * 60 * 60 * 1000)
      );
      setIsAdmin(true);
      return true;
    }
    return false;
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(EXPIRE_KEY);
    setIsAdmin(false);
  };

  const value: UIContextValue = {
    isAdmin,
    loginDialogOpen,
    setLoginDialogOpen,
    login,
    logout,
  };

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}
