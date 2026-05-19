import { useEffect, useState } from "react";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

async function checkAdminUser(user: User | null): Promise<boolean> {
  if (!user || !db) return false;
  if (user.emailVerified === false) return false;
  const adminDoc = await getDoc(doc(db, "admin_users", user.uid));
  return adminDoc.exists();
}

export function useAdminAuth() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(!auth);

  useEffect(() => {
    if (!auth) {
      setIsAdmin(false);
      setAdminEmail(null);
      setAuthReady(true);
      return;
    }

    return onAuthStateChanged(auth, async (user) => {
      setAuthReady(false);
      const allowed = await checkAdminUser(user).catch(() => false);
      setIsAdmin(allowed);
      setAdminEmail(allowed ? user?.email ?? null : null);
      setAuthReady(true);
      if (user && !allowed) await signOut(auth).catch(() => {});
    });
  }, []);

  const login = async (email: string, password: string, remember = true): Promise<boolean> => {
    if (!auth) return false;
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    const allowed = await checkAdminUser(credential.user);
    if (!allowed) {
      await signOut(auth);
      return false;
    }
    setIsAdmin(true);
    setAdminEmail(credential.user.email ?? null);
    return true;
  };

  const logout = async () => {
    if (auth) await signOut(auth).catch(() => {});
    setIsAdmin(false);
    setAdminEmail(null);
  };

  return { isAdmin, login, logout, authReady, adminEmail };
}
