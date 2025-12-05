// src/lib/firebase.js
import { initializeApp } from "firebase/app";
import { setLogLevel, getFirestore } from "firebase/firestore";
import {
  getAuth,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPopup,
  signInWithPhoneNumber,
  onAuthStateChanged,
  signOut,
  signInWithCustomToken as _signInWithCustomToken,
} from "firebase/auth";

/* Firebase init — keep your existing config */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

/* 🔒 Bind Firestore to the *named* database "galc" */
export const db = getFirestore(app, "galc");

/* Dev logging */
if (import.meta.env.DEV) setLogLevel("debug");

/* --------------------------- Google auth utils ------------------------- */
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export async function signInWithGooglePopup() {
  return await signInWithPopup(auth, googleProvider);
}

/* -------------------- reCAPTCHA (per-container, fresh) ------------------ */
/**
 * We keep a map of verifiers by containerId. Each "Send code" should
 * use a *fresh* verifier (forceNew: true) to avoid expired tokens or
 * DOM lifecycle issues.
 */
const recaptchaMap = new Map();

/**
 * Always ensures an invisible RecaptchaVerifier for a given container.
 * If forceNew = true or verifier is stale, a fresh one is created.
 * If the container doesn't exist, a hidden fallback <div> is created.
 */
export function ensureRecaptcha(
  containerId = "recaptcha-container",
  { forceNew = false } = {}
) {
  if (forceNew && recaptchaMap.has(containerId)) {
    try {
      recaptchaMap.get(containerId)?.clear?.();
    } catch {}
    recaptchaMap.delete(containerId);
  }

  let el =
    typeof document !== "undefined"
      ? document.getElementById(containerId)
      : null;
  if (!el && typeof document !== "undefined") {
    // Create hidden fallback if modal not yet rendered
    el = document.createElement("div");
    el.id = containerId;
    el.style.display = "none";
    document.body.appendChild(el);
  }

  let verifier = recaptchaMap.get(containerId);
  if (!verifier) {
    verifier = new RecaptchaVerifier(auth, containerId, { size: "invisible" });
    verifier.render?.();
    recaptchaMap.set(containerId, verifier);
  }
  return verifier;
}

/** Clear a verifier manually (for reopen/reset) */
export function resetRecaptcha(containerId) {
  const v = recaptchaMap.get(containerId);
  if (v?.clear) {
    try {
      v.clear();
    } catch {}
  }
  recaptchaMap.delete(containerId);
}

/* ----------------------------- Phone sign-in --------------------------- */
export async function startPhoneSignIn(e164Phone, containerId) {
  const verifier = ensureRecaptcha(containerId, { forceNew: true });
  return await signInWithPhoneNumber(auth, e164Phone, verifier);
}

export async function confirmPhoneCode(confirmationResult, code) {
  return await confirmationResult.confirm(code);
}

/* ------------------------------ Misc utils ----------------------------- */
export function observeAuthState(cb) {
  return onAuthStateChanged(auth, cb);
}

export function signOutUser() {
  return signOut(auth);
}

export async function signInWithCustomToken(token) {
  const a = getAuth();
  return _signInWithCustomToken(a, token);
}