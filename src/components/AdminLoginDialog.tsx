import { useState } from "react";

const ADMIN_ID = "duagydid";
const ADMIN_PW = "1234";
const STORAGE_KEY = "admin_logged_in";
const EXPIRE_KEY = "admin_expire";

export function useAdminAuth() {
  const [isAdmin, setIsAdmin] = useState(() => {
    const expire = localStorage.getItem(EXPIRE_KEY);
    return localStorage.getItem(STORAGE_KEY) === "true" && expire !== null && Date.now() < Number(expire);
  });

  const login = (id: string, pw: string): boolean => {
    if (id === ADMIN_ID && pw === ADMIN_PW) {
      localStorage.setItem(STORAGE_KEY, "true");
      localStorage.setItem(EXPIRE_KEY, String(Date.now() + 7 * 24 * 60 * 60 * 1000));
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

  return { isAdmin, login, logout };
}
