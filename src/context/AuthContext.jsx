// src/context/AuthContext.jsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  auth,
  observeAuthState,
  signInWithGooglePopup,
  startPhoneSignIn,
  confirmPhoneCode,
  signOutUser,
} from "../lib/firebase";

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = observeAuthState((u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const api = useMemo(
    () => ({
      user,
      loading,
      async signInWithGoogle() {
        await signInWithGooglePopup();
      },
      async startPhone(phone) {
        return await startPhoneSignIn(phone); // returns confirmationResult
      },
      async confirmCode(confirmationResult, code) {
        return await confirmPhoneCode(confirmationResult, code);
      },
      async signOut() {
        await signOutUser();
      },
      async getIdToken() {
        if (!auth.currentUser) return null;
        return await auth.currentUser.getIdToken(true);
      },
    }),
    [user, loading]
  );

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
