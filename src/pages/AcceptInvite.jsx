// src/pages/AcceptInvite.jsx
import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

// Ensure the Firebase app is initialized
import "../lib/firebase";

import {
  getAuth,
  isSignInWithEmailLink,
  signInWithEmailLink,
  onAuthStateChanged,
  signOut,
} from "firebase/auth";

/** You already use this pattern in lib/api.js; mirror it here */
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8080";

/** POST /v1/memberships/accept (now requires display_name) */
async function acceptInvite(invite_id, display_name, user) {
  const token = await user.getIdToken();
  const res = await fetch(`${API_BASE}/v1/memberships/accept`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ invite_id, display_name }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json(); // { customer_id, role, email }
}

export default function AcceptInvite() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const inviteId = params.get("invite") || "";
  const emailFromUrl = params.get("email") || "";

  // checking | needEmail | signingIn | needName | accepting | done | error
  const [phase, setPhase] = useState("checking");
  const [email, setEmail] = useState(emailFromUrl || "");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [consumingLink, setConsumingLink] = useState(false);

  const auth = getAuth();

  const cleanUrl = useCallback(() => {
    // Keep only /accept?invite=... ; drop &email= and all Firebase params
    const url = new URL(window.location.href);
    const base = `${url.origin}/accept?invite=${encodeURIComponent(inviteId)}`;
    window.history.replaceState({}, "", base);
  }, [inviteId]);

  useEffect(() => {
    if (!inviteId) {
      setPhase("error");
      setError("Invalid or missing invite id.");
      return;
    }

    const unsub = onAuthStateChanged(auth, async (u) => {
      // Avoid jumping to needName while we're actively consuming a link
      if (!u || consumingLink) return;

      setUserEmail(u.email || "");
      const suggested =
        (u.displayName || "").trim() ||
        (window.localStorage.getItem("galc.invite.display_name") || "").trim();
      setDisplayName(suggested);
      setPhase("needName");
    });

    const url = window.location.href;
    if (isSignInWithEmailLink(auth, url)) {
      (async () => {
        const stored = window.localStorage.getItem("galc.invite.email") || "";
        const candidate = (emailFromUrl || stored || "").trim();

        if (!candidate) {
          setPhase("needEmail");
          return;
        }

        setPhase("signingIn");
        setConsumingLink(true);

        // If a different user is signed in, sign out before consuming the link.
        const cu = auth.currentUser;
        if (cu && (cu.email || "").toLowerCase() !== candidate.toLowerCase()) {
          await signOut(auth).catch(() => {});
        }

        try {
          await signInWithEmailLink(auth, candidate, url);
          window.localStorage.removeItem("galc.invite.email");
          cleanUrl(); // remove &email= and firebase params so it can't loop
        } catch (e) {
          setError(e.message || "Sign-in with email link failed.");
          setPhase("error");
        } finally {
          setConsumingLink(false);
        }
      })();
    } else {
      // Not an email link; if no current user, ask for the invite email
      if (!auth.currentUser) setPhase("needEmail");
    }

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteId]);

  const handleSubmitEmail = async (e) => {
    e.preventDefault();
    try {
      window.localStorage.setItem("galc.invite.email", email);
      setPhase("signingIn");
      setConsumingLink(true);

      // If a different user is signed in, sign out before consuming the link.
      const cu = auth.currentUser;
      if (cu && (cu.email || "").toLowerCase() !== email.toLowerCase()) {
        await signOut(auth).catch(() => {});
      }

      await signInWithEmailLink(auth, email, window.location.href);
      cleanUrl();
    } catch (e2) {
      setError(e2.message || "Sign-in with email link failed.");
      setPhase("error");
    } finally {
      setConsumingLink(false);
    }
  };

  const handleSubmitName = async (e) => {
    e.preventDefault();
    const dn = (displayName || "").trim();
    if (!dn) {
      setError("Please enter a display name.");
      return;
    }
    if (!auth.currentUser) {
      setError("You’re not signed in.");
      setPhase("error");
      return;
    }
    try {
      window.localStorage.setItem("galc.invite.display_name", dn);
      setPhase("accepting");
      await acceptInvite(inviteId, dn.slice(0, 60), auth.currentUser);
      setPhase("done");
      navigate("/account", { replace: true });
    } catch (e2) {
      setError(e2.message || "Could not accept invite.");
      setPhase("error");
    }
  };

  const doSignOut = async () => {
    try {
      await signOut(auth);
      setPhase("needEmail");
      setUserEmail("");
    } catch {}
  };

  return (
    <div
      className={`
        bg-white
        flex items-center justify-center
        min-h-screen
        px-4 sm:px-6
        py-2 sm:py-10 lg:py-14
        pb-[env(safe-area-inset-bottom)]
      `}
    >
      {/* Card */}
      <div
        className={`
          w-full max-w-md sm:max-w-xl md:max-w-2xl
          rounded-3xl border border-gray-200 bg-white
          p-5 sm:p-8 md:p-10
          shadow-lg md:shadow-md
          sm:-translate-y-1 md:-translate-y-6 lg:-translate-y-12
        `}
      >
        {/* Header */}
        <div className="mb-5 md:mb-7">
          <h1 className="text-[20px] sm:text-2xl md:text-3xl font-semibold leading-tight text-gray-900">
            Join your team
          </h1>

          {/* ID + signed-in pill: stack on mobile, inline on >=sm */}
          <div className="mt-3 grid grid-cols-1 sm:flex sm:flex-wrap sm:items-center gap-2 text-[13px] sm:text-sm">
            <span className="inline-flex items-center rounded-xl bg-gray-100 px-3 py-1 font-medium text-gray-700 w-full sm:w-auto">
              <span className="mr-1">Invite&nbsp;ID:</span>
              <span className="font-mono break-all">{inviteId || "—"}</span>
            </span>

            {userEmail ? (
              <span className="inline-flex items-center gap-1 rounded-xl bg-gray-50 px-3 py-1 text-gray-700 w-full sm:w-auto max-w-full min-w-0 whitespace-nowrap">
                <span className="shrink-0 whitespace-nowrap">Signed in as</span>
                <strong className="text-gray-900 truncate min-w-0 max-w-[60vw] sm:max-w-[320px]">
                  {userEmail}
                </strong>
              </span>
            ) : null}
          </div>
        </div>

        {/* PHASES */}
        {phase === "checking" && (
          <div role="status" aria-live="polite" className="text-base text-gray-700">
            Checking your link…
          </div>
        )}

        {phase === "needEmail" && (
          <form onSubmit={handleSubmitEmail} className="space-y-5">
            <p className="text-[15px] sm:text-base text-gray-700">
              Enter the email address where you received this invite to continue.
            </p>

            <div>
              <label htmlFor="invite-email" className="block text-sm font-medium text-gray-800">
                Email
              </label>
              <input
                id="invite-email"
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 h-12 w-full rounded-2xl border border-gray-300 px-3 text-[16px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
                placeholder="you@example.com"
                inputMode="email"
                autoComplete="email"
              />
            </div>

            <button
              type="submit"
              className="h-12 w-full rounded-2xl bg-gray-900 text-white text-[16px] font-semibold hover:bg-black active:translate-y-[1px]"
            >
              Continue
            </button>
          </form>
        )}

        {phase === "signingIn" && (
          <div role="status" aria-live="polite" className="text-base text-gray-700">
            Signing you in…
          </div>
        )}

        {phase === "needName" && (
          <form onSubmit={handleSubmitName} className="space-y-5">
            <p className="text-[15px] sm:text-base text-gray-700">
              How should your teammates see your name?
            </p>

            <div>
              <label htmlFor="display-name" className="block text-sm font-medium text-gray-800">
                Display name
              </label>
              <input
                id="display-name"
                type="text"
                required
                maxLength={60}
                autoFocus
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1 h-12 w-full rounded-2xl border border-gray-300 px-3 text-[16px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
                placeholder="e.g., Chris M."
                autoComplete="name"
              />
            </div>

            <button
              type="submit"
              className="h-12 w-full rounded-2xl bg-gray-900 text-white text-[16px] font-semibold hover:bg-black active:translate-y-[1px]"
            >
              Join team
            </button>

            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3">
              <p className="text-xs sm:text-[13px] text-gray-500">
                You can update this later from your account.
              </p>
              <button
                type="button"
                onClick={doSignOut}
                className="text-sm text-gray-700 underline underline-offset-2"
              >
                Not you? Sign out
              </button>
            </div>
          </form>
        )}

        {phase === "accepting" && (
          <div role="status" aria-live="polite" className="text-base text-gray-700">
            Accepting your invite…
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-4">
            <div className="rounded-xl bg-red-50 text-red-800 border border-red-200 p-4 text-sm">
              {error || "Something went wrong."}
            </div>
            {userEmail ? (
              <div className="text-sm text-gray-700">
                You’re signed in as <strong>{userEmail}</strong>. If this invite was sent to a
                different email, sign out and try again.
              </div>
            ) : null}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              {userEmail ? (
                <button
                  onClick={doSignOut}
                  className="h-10 rounded-xl border border-gray-300 px-4 text-sm"
                >
                  Sign out
                </button>
              ) : null}
              <button
                onClick={() => navigate("/")}
                className="h-10 rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white"
              >
                Go home
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
