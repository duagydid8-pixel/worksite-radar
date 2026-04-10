import { useState } from "react";

const ADMIN_ID = "duagydid";
const ADMIN_PW = "1234";
const STORAGE_KEY = "admin_logged_in";

export function useAdminAuth() {
  const [isAdmin, setIsAdmin] = useState(() => sessionStorage.getItem(STORAGE_KEY) === "true");

  const login = (id: string, pw: string): boolean => {
    if (id === ADMIN_ID && pw === ADMIN_PW) {
      sessionStorage.setItem(STORAGE_KEY, "true");
      setIsAdmin(true);
      return true;
    }
    return false;
  };

  const logout = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setIsAdmin(false);
  };

  return { isAdmin, login, logout };
}
