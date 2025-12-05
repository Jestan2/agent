// src/components/AuthSheet.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  signInWithGooglePopup,
  observeAuthState,
  resetRecaptcha,
  signOutUser,
} from "../lib/firebase";
import {
  getAccountStatus,
  customersProfile,
  createSetupIntent,
  billingRefresh as refreshStripeStatus, // alias to match API
  membershipsInit,
} from "../lib/api";
import { Elements, useStripe, useElements, CardElement } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

import { authSmsSendCode, authSmsVerifyCode } from "../lib/api";
import { signInWithCustomToken as signInWithCustomTokenFB } from "../lib/firebase";
import { updateProfile } from "firebase/auth";
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

// ---- Jobs feed gate (prevents early subscribe) ----
const JOBS_GATE_KEY = "jobs.gate.v1";
const setJobsGate = (enabled, reason) => {
  try {
    sessionStorage.setItem(
      JOBS_GATE_KEY,
      JSON.stringify({ enabled, ts: Date.now(), reason })
    );
  } catch {}
  try {
    window.dispatchEvent(
      new CustomEvent("company:jobs-gate", { detail: { enabled, reason } })
    );
  } catch {}
};

/* -------------------- US-only phone helpers (inline) -------------------- */
const onlyDigits = (s) => String(s || "").replace(/\D/g, "");
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || "").trim().toLowerCase());

function formatUS(d) {
  const x = onlyDigits(d).slice(0, 10);
  if (x.length <= 3) return x;
  if (x.length <= 6) return `(${x.slice(0, 3)}) ${x.slice(3)}`;
  return `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}`;
}
function toE164US(localDigits) {
  return `+1${onlyDigits(localDigits)}`;
}
function validateUS(localDigits) {
  const d = onlyDigits(localDigits);
  if (!d) return "Enter your phone number.";
  if (d.length !== 10) return `Phone must have exactly 10 digits (you entered ${d.length}).`;
  return "";
}

/* ------------------------ Small Google icon button ----------------------- */
function ProviderIconGoogle() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" className="mr-2">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.4 32.9 29.1 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C33.6 6.1 28.9 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 19-8.9 19-20c0-1.2-.1-2.3-.4-3.5z"
      />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.9C14.5 16.4 18.9 14 24 14c3 0 5.8 1.1 7.9 3l5.7-5.7C33.6 6.1 28.9 4 24 4c-7.7 0-14.3 4.3-17.7 10.7z" />
      <path fill="#4CAF50" d="M24 44c5 0 9.6-1.9 13.1-5l-6.1-5c-2 1.4-4.6 2.2-7 2.2-5 0-9.3-3.2-10.9-7.7l-6.6 5.1C7 39.4 15 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.3 3.7-4.9 6.1-9.3 6.1-5 0-9.3-3.2-10.9-7.7l-6.6 5.1C11 38.4 17.1 42 24 42c9.1 0 17-6.6 19-15.5 0-.1.6-3 .6-6z" />
    </svg>
  );
}

/* ------------------ Reusable US Phone verify (Auth step) ----------------- */
function PhoneVerifyUS({ value, setValue, onSend, onVerify, note, recaptchaId }) {
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState(null);
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [timer, setTimer] = useState(0);
  const timerRef = useRef(null);

  const onChange = (e) => {
    const raw = onlyDigits(e.target.value).slice(0, 10);
    setValue(raw);
    setError(validateUS(raw));
  };

  const send = async () => {
    const msg = validateUS(value);
    setError(msg);
    if (msg) return;
    try {
      const e164 = toE164US(value);
      const conf = await onSend(e164, recaptchaId);
      setConfirmation(conf);
      setSent(true);
      setTimer(conf?.retry_after_seconds ?? 60);
      clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setTimer((t) => (t <= 1 ? (clearInterval(timerRef.current), 0) : t - 1));
      }, 1000);
    } catch {
      setError("Couldn't send the code. Please try again.");
    }
  };

  const verify = async () => {
    if (!confirmation || code.trim().length < 6) return setError("Enter the 6-digit code.");
    try {
      await onVerify(confirmation, code.trim());
      setCode("");
    } catch {
      setError("Invalid code. Please try again.");
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 p-4 sm:p-5 overflow-hidden">
      <div className="text-sm font-medium mb-3">Continue with phone</div>

      {/* Responsive grid — no overflow on mobile */}
      <div className="grid grid-cols-1 sm:grid-cols-[64px,1fr,auto] gap-3 items-center">
        <div className="h-11 rounded-xl border border-gray-200 bg-gray-50 px-3 flex items-center text-sm text-gray-700">
          +1
        </div>

        <input
          placeholder="(555) 555-5555"
          className={`h-11 rounded-xl border px-3 w-full ${error ? "border-red-300" : "border-gray-200"}`}
          value={formatUS(value)}
          onChange={onChange}
          inputMode="tel"
        />

        <button
          type="button"
          onClick={send}
          disabled={timer > 0}
          className="h-11 rounded-xl bg-gray-900 text-white font-semibold disabled:opacity-50 w-full sm:w-auto sm:min-w-[128px]"
        >
          {sent && timer > 0 ? `Resend in ${timer}s` : sent ? "Resend code" : "Send code"}
        </button>
      </div>

      {/* Code row — stacks on mobile */}
      {sent && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr,auto] gap-3 items-center">
          <input
            placeholder="6-digit code"
            className="h-11 rounded-xl border border-gray-200 px-3 w-full"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
          />
          <button
            type="button"
            onClick={verify}
            className="h-11 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 w-full sm:w-auto sm:min-w-[112px]"
          >
            Verify
          </button>
        </div>
      )}

      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
      {!!note && <div className="mt-2 text-xs text-gray-500">{note}</div>}

      {/* Invisible reCAPTCHA anchor for this panel */}
      <div id={recaptchaId} style={{ display: "none" }} />
    </div>
  );
}

/* ---------------- Add Card (Stripe) — minimal, matches style ------------- */
function AddCardForm({ user, onComplete, onClose }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const handleAddCard = useCallback(async () => {
    if (!stripe || !elements || !user) return;
    try {
      setBusy(true);
      setErr("");
      // 1) Create SetupIntent
      const { client_secret } = await createSetupIntent(() => user.getIdToken());
      // 2) Confirm with CardElement
      const card = elements.getElement(CardElement);
      const { error } = await stripe.confirmCardSetup(client_secret, { payment_method: { card } });
      if (error) throw error;
      // 3) Refresh backend flags
      await refreshStripeStatus(() => user.getIdToken());
      // 4) Notify parent + close
      try {
        onComplete?.({ type: "card_added" });
      } catch {}
      onClose?.();
    } catch (e) {
      setErr(e?.message || "Could not save card. Try again.");
    } finally {
      setBusy(false);
    }
  }, [stripe, elements, user, onComplete, onClose]);

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-600">
        Add a payment method to your account. You won’t be charged now — this securely stores your card for future bookings.
      </p>

      <div className="border border-gray-200 rounded-xl p-4 bg-gray-50">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: "16px",
                color: "#111827",
                fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
                "::placeholder": { color: "#9CA3AF" },
              },
              invalid: { color: "#DC2626" },
            },
          }}
        />
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <button
        type="button"
        onClick={handleAddCard}
        disabled={busy}
        className="w-full h-11 rounded-xl bg-gray-900 text-white font-semibold disabled:opacity-50"
      >
        {busy ? "Saving..." : "Save Card"}
      </button>
    </div>
  );
}

/* ======================================================================= */

export default function AuthSheet({ open, onClose, resumeAction = null, onComplete }) {
  const [step, setStep] = useState("auth"); // "auth" | "profile" | "card"
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [user, setUser] = useState(null);
  const [status, setStatus] = useState({ logged_in: false, profile_ok: false, payment_on_file: false });

  // phone (auth step)
  const [authLocal, setAuthLocal] = useState("");

  // profile fields
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [address, setAddress] = useState("");
  const [consent, setConsent] = useState(true);

  // locked identity from provider
  const [lockedEmail, setLockedEmail] = useState("");
  const [lockedPhoneE164, setLockedPhoneE164] = useState("");

  // “opposite” fields required depending on provider
  const [extraPhone, setExtraPhone] = useState(""); // raw digits for formatting
  const [extraEmail, setExtraEmail] = useState("");

  const [extraPhoneErr, setExtraPhoneErr] = useState("");
  const [extraEmailErr, setExtraEmailErr] = useState("");

  /* ------------------------- Reset on sheet open ------------------------- */
  useEffect(() => {
    if (!open) return;
    resetRecaptcha("recaptcha-auth");

    // Gate OFF while the sheet is open
    setJobsGate(false, "authsheet_open");

    setErr("");
    setBusy(false);
    setStep("auth");
    setAuthLocal("");
    setFirstName("");
    setLastName("");
    setCompany("");
    setAddress("");
    setConsent(true);
    setLockedEmail("");
    setLockedPhoneE164("");
    setExtraPhone("");
    setExtraEmail("");
    setExtraPhoneErr("");
    setExtraEmailErr("");
  }, [open]);

  /* ------------------------- ESC → cancel & sign out --------------------- */
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") handleCancel();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* ---------------------- Watch Firebase auth state ---------------------- */
  useEffect(() => {
    if (!open) return;
    const un = observeAuthState(async (u) => {
      // Ignore the transient “empty user” edge-case
      if (u && !u.email && !u.phoneNumber) return;

      setUser(u || null);
      if (!u) {
        setStep("auth");
        return;
      }

      try {
        setBusy(true);
        const s = await getAccountStatus(() => u.getIdToken());
        setStatus(s);

        const p = u.providerData?.[0];
        const display = p?.displayName || "";
        if (display) {
          const [fn, ...rest] = display.split(" ");
          setFirstName((v) => v || fn || "");
          setLastName((v) => v || (rest?.join(" ") || ""));
        }
        setLockedEmail(u.email || p?.email || "");
        setLockedPhoneE164(u.phoneNumber || p?.phoneNumber || "");

        if (!s.profile_ok) {
          setStep("profile");
        } else if (!s.payment_on_file) {
          // Profile exists → allow jobs to load while adding a card
          setJobsGate(true, "profile_ok");
          setStep("card");
        } else {
          // Fully ready → enable jobs and close
          setJobsGate(true, "status_ok");
          try {
            onComplete?.({ type: "profile_complete" });
          } catch {}
          onClose?.();
        }
      } finally {
        setBusy(false);
      }
    });
    return () => un && un();
  }, [open, onClose, onComplete]);

  /* --------------------------- Auth actions ---------------------------- */
  const signInGoogle = useCallback(async () => {
    try {
      setErr("");
      setBusy(true);
      await signInWithGooglePopup();
    } catch {
      setErr("Could not sign in with Google.");
    } finally {
      setBusy(false);
    }
  }, []);

  const authSend = useCallback(async (e164 /*, recaptchaId */) => {
    const meta = await authSmsSendCode({ phone: e164 });     // { retry_after_seconds, expires_in_seconds, ... }
    return { phone: e164, ...meta };                         // becomes the "confirmation" ctx
  }, []);

  const authVerify = useCallback(async (ctx, code) => {
    const { phone } = ctx || {};
    const { custom_token } = await authSmsVerifyCode({ phone, code });
    await signInWithCustomTokenFB(custom_token);             // triggers observeAuthState → rest of flow unchanged
  }, []);

  /* ---------------------- Cancel = full sign out ------------------------ */
  const handleCancel = useCallback(async () => {
    // Mark a short-lived "cancelled" stamp so /account gate doesn't re-open immediately
    try {
      window.sessionStorage.setItem("auth.cancelled.at", String(Date.now()));
    } catch {}
    await signOutUser();
    // also clear any in-flight intent the caller may have set
    try {
      window.sessionStorage.removeItem("auth.intent");
    } catch {}
    // Keep jobs gate OFF on cancel
    setJobsGate(false, "auth_cancelled");
    onClose?.();
  }, [onClose]);

  /* -------------------------- Validation logic ------------------------- */
  useEffect(() => {
    if (lockedPhoneE164) {
      setExtraPhoneErr("");
      return;
    }
    const msg = validateUS(extraPhone);
    setExtraPhoneErr(msg);
  }, [extraPhone, lockedPhoneE164]);

  useEffect(() => {
    if (lockedEmail) {
      setExtraEmailErr("");
      return;
    }
    const ok = extraEmail ? isEmail(extraEmail) : false;
    setExtraEmailErr(ok ? "" : extraEmail ? "Enter a valid email." : "Email is required.");
  }, [extraEmail, lockedEmail]);

  const canSubmitProfile = useMemo(() => {
    const namesOk = !!firstName.trim() && !!lastName.trim();
    const companyOk = !!company.trim();
    const addressOk = !!address.trim();

    const emailOk = lockedEmail ? true : extraEmail && !extraEmailErr;
    const phoneOk = lockedPhoneE164 ? true : !extraPhoneErr && !validateUS(extraPhone);

    return namesOk && companyOk && addressOk && consent && emailOk && phoneOk;
  }, [
    firstName,
    lastName,
    company,
    address,
    consent,
    lockedEmail,
    lockedPhoneE164,
    extraEmail,
    extraEmailErr,
    extraPhone,
    extraPhoneErr,
  ]);

  /* ------------------------------ Submit ------------------------------- */
  const submitProfile = useCallback(
    async (e) => {
      e?.preventDefault?.();
      if (!user) return;
      if (!canSubmitProfile) return setErr("Complete all required fields.");

      try {
        setBusy(true);
        const payload = {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: lockedEmail || extraEmail.trim(),
          phone: lockedPhoneE164 || toE164US(extraPhone.trim()),
          company_name: company.trim(),
          business_address: address.trim(),
          tos_accepted: true,
        };

        // ⚡ Step 1: Save profile to backend
        await customersProfile(() => user.getIdToken(), payload);

        // ⚡ Step 2: Initialize membership/company link (new endpoint)
        try {
          await membershipsInit(() => user.getIdToken(), payload);
          // Company membership is now ready → lift the gate
          setJobsGate(true, "membership_init_ok");
        } catch (err) {
          console.warn("Membership init failed (non-fatal):", err);
        }

        // ⚡ Step 2.5: Ensure Firebase user.displayName is set + refresh local snapshot
        try {
          const fullName = `${firstName.trim()} ${lastName.trim()}`.replace(/\s+/g, " ").trim();
          if (user && fullName) {
            const needsUpdate = (user.displayName || "").trim() !== fullName;
            if (needsUpdate) {
              await updateProfile(user, { displayName: fullName });
            }
            // Make sure the in-memory user reflects the new profile fields
            await user.reload();

            // (optional) nudge listeners who want to re-read the user
            try { window.dispatchEvent(new CustomEvent("auth:profile-updated")); } catch {}
          }
        } catch (e) {
          console.warn("Could not set Firebase displayName:", e);
        }

        // ⚡ Step 3: Refresh status and continue flow
        const s = await getAccountStatus(() => user.getIdToken());
        setStatus(s);

        if (s.profile_ok) {
          if (!s.payment_on_file) {
            setStep("card");
          } else {
            try {
              onComplete?.({ type: "profile_complete" });
            } catch {}
            onClose?.();
          }
        }
      } catch {
        setErr("Could not save your profile. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [
      user,
      canSubmitProfile,
      firstName,
      lastName,
      company,
      address,
      lockedEmail,
      lockedPhoneE164,
      extraEmail,
      extraPhone,
      onClose,
      onComplete,
    ]
  );

  /* ------------------------------- Render ------------------------------ */
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Dim background */}
          <motion.div
            className="fixed inset-0 z-[90] bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleCancel}
          />

          {/* Centered modal with zoom-in animation */}
          <motion.div
            className="fixed inset-0 z-[100] flex items-center justify-center px-3 sm:px-4"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <div className="mx-auto w-full max-w-[520px] md:rounded-2xl bg-white shadow-xl border border-gray-200">
              <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200">
                <h2 className="text-[16px] md:text-[17px] font-semibold text-gray-900">
                  {step === "auth" ? "Log in or sign up" : step === "profile" ? "Complete your profile" : "Add a payment method"}
                </h2>
                <button onClick={handleCancel} className="p-2 rounded-md hover:bg-gray-100" aria-label="Close">
                  <svg width="20" height="20" viewBox="0 0 24 24">
                    <path d="M6 6l12 12M6 18l12-12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div className="px-6 py-6 space-y-5">
                {/* --------------------------- AUTH STEP --------------------------- */}
                {step === "auth" && (
                  <>
                    <p className="text-sm text-gray-600">Sign in to finish your booking.</p>

                    <button
                      onClick={signInGoogle}
                      disabled={busy}
                      className="w-full h-11 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 font-medium disabled:opacity-50 flex items-center justify-center"
                    >
                      <ProviderIconGoogle /> Continue with Google
                    </button>

                    <div className="flex items-center my-3">
                      <div className="h-px flex-1 bg-gray-200" />
                      <div className="px-3 text-xs text-gray-500">OR</div>
                      <div className="h-px flex-1 bg-gray-200" />
                    </div>

                    <PhoneVerifyUS
                      value={authLocal}
                      setValue={setAuthLocal}
                      onSend={authSend}
                      onVerify={authVerify}
                      recaptchaId="recaptcha-auth"
                    />
                  </>
                )}

                {/* --------------------------- PROFILE STEP ------------------------ */}
                {step === "profile" && (
                  <form onSubmit={submitProfile} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-1 gap-3">
                      {lockedEmail && (
                        <div className="h-10 rounded-lg bg-gray-100 text-gray-700 flex items-center px-3 text-sm overflow-hidden text-ellipsis">
                          {lockedEmail}
                        </div>
                      )}
                      {lockedPhoneE164 && (
                        <div className="h-10 rounded-lg bg-gray-100 text-gray-700 flex items-center px-3 text-sm overflow-hidden text-ellipsis">
                          {lockedPhoneE164}
                        </div>
                      )}
                    </div>

                    {!lockedEmail && (
                      <div>
                        <input
                          required
                          placeholder="Email address"
                          className={`w-full rounded-xl border px-3 py-2 ${extraEmailErr ? "border-red-300" : "border-gray-200"}`}
                          value={extraEmail}
                          onChange={(e) => setExtraEmail(e.target.value)}
                          inputMode="email"
                        />
                        {extraEmailErr && <p className="mt-1 text-xs text-red-600">{extraEmailErr}</p>}
                      </div>
                    )}

                    {!lockedPhoneE164 && (
                      <div>
                        <input
                          required
                          placeholder="(555) 555-5555"
                          className={`w-full rounded-xl border px-3 py-2 ${extraPhoneErr ? "border-red-300" : "border-gray-200"}`}
                          value={formatUS(extraPhone)}
                          onChange={(e) => setExtraPhone(onlyDigits(e.target.value).slice(0, 10))}
                          inputMode="tel"
                        />
                        {extraPhoneErr && <p className="mt-1 text-xs text-red-600">{extraPhoneErr}</p>}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input
                        required
                        placeholder="First name"
                        className="rounded-xl border border-gray-200 px-3 py-2"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                      />
                      <input
                        required
                        placeholder="Last name"
                        className="rounded-xl border border-gray-200 px-3 py-2"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                      />
                    </div>

                    <input
                      required
                      placeholder="Company"
                      className="w-full rounded-xl border border-gray-200 px-3 py-2"
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                    />

                    <input
                      required
                      placeholder="Business address"
                      className="w-full rounded-xl border border-gray-200 px-3 py-2"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />

                    {/* Dark, accessible checkbox */}
                    <label className="flex items-center gap-3 text-sm text-gray-800 select-none">
                      <span
                        className={[
                          "inline-flex h-5 w-5 rounded-md border transition-colors",
                          consent ? "bg-gray-900 border-gray-900" : "bg-white border-gray-300",
                        ].join(" ")}
                        role="checkbox"
                        aria-checked={consent ? "true" : "false"}
                        tabIndex={0}
                        onClick={() => setConsent((v) => !v)}
                        onKeyDown={(e) => {
                          if (e.key === " " || e.key === "Enter") {
                            e.preventDefault();
                            setConsent((v) => !v);
                          }
                        }}
                      >
                        {consent && (
                          <svg className="m-auto" width="12" height="12" viewBox="0 0 24 24" fill="none">
                            <path d="M5 12l4 4L19 6" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span>I accept the Terms and Privacy Policy.</span>
                    </label>

                    {err && <div className="text-sm text-red-600">{err}</div>}

                    <div className="flex flex-col sm:flex-row justify-end gap-2 pt-1">
                      <button type="button" onClick={handleCancel} className="px-3 py-2 rounded-lg border border-gray-200 w-full sm:w-auto">
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!canSubmitProfile || busy}
                        className={`px-4 py-2 rounded-lg font-semibold w-full sm:w-auto ${
                          canSubmitProfile ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-500"
                        }`}
                      >
                        Save & Continue
                      </button>
                    </div>

                    <p className="text-xs text-gray-500">Provide both email and phone for recovery. You can edit later in Account settings.</p>
                  </form>
                )}

                {/* --------------------------- CARD STEP --------------------------- */}
                {step === "card" && user && (
                  <Elements stripe={stripePromise}>
                    <AddCardForm
                      user={user}
                      onComplete={() => {
                        // After a successful card add, re-check flags then exit if done
                        (async () => {
                          const s = await getAccountStatus(() => user.getIdToken());
                          setStatus(s);
                          if (s?.logged_in && s?.profile_ok && s?.payment_on_file) {
                            setJobsGate(true, "card_added");
                            try {
                              onComplete?.({ type: "card_added" });
                            } catch {}
                            onClose?.();
                          }
                        })();
                      }}
                      onClose={onClose}
                    />
                  </Elements>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
