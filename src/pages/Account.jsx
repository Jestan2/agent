// src/pages/Account.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Elements, useStripe, useElements, CardElement } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { observeAuthState, signOutUser } from "../lib/firebase";
import {
  getAccountStatus,
  getCustomerProfile,
  customersProfilePatch,
  listPaymentMethods,
  setDefaultPM,
  deletePM,
  createSetupIntent,
  billingRefresh as refreshStripeStatus,
  fetchJobHistory,
  membershipsInvite,
  membershipsMembers,
  membershipsSetRole,
} from "../lib/api";

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

/* ---------------------------- Shared bits ---------------------------- */
const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const whenFromISO = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} @ ${time}`;
};

const BUSINESS_CONTACT = {
  name: "Clarkson Boerner",
  email: "clarkson@greatamericanlabor.com",
};

const SectionDivider = ({ className = "" }) => (
  <div className={`relative my-5 sm:my-8 ${className}`}>
    <div className="h-px w-full bg-gradient-to-r from-transparent via-gray-200/80 to-transparent" />
  </div>
);

// Buttons (larger touch targets on mobile, same visuals on desktop)
const BTN = {
  primary:
    "min-h-[44px] h-11 md:h-10 px-4 rounded-xl border border-gray-200 bg-white text-gray-900 hover:bg-gray-50 transition",
  secondary:
    "min-h-[44px] h-11 md:h-10 px-4 rounded-xl border border-gray-200 bg-white text-gray-900 hover:bg-gray-50 transition",
  subtle:
    "min-h-[40px] h-10 px-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm transition",
  chip:
    "px-2.5 py-1 text-xs rounded-lg bg-gray-900 text-white",
};

/* =========================== Skeletons =========================== */
const Pulse = ({ className = "" }) => (
  <div className={`animate-pulse rounded bg-gray-200 ${className}`} />
);
function FieldSkeleton({ w = "w-full" }) { return <Pulse className={`h-11 ${w}`} />; }
function ButtonSkeleton({ w = "w-24", h = "h-10" }) { return <Pulse className={`${h} ${w}`} />; }
function LineSkeleton() { return <Pulse className="h-[18px] w-2/3" />; }
function SectionCard({ children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-7 shadow-sm">
      {children}
    </div>
  );
}

/* Tiny spinner for soft refreshes (no skeleton) */
function Spinner({ className = "w-4 h-4 text-gray-400" }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/* Account (admin) skeleton */
function AccountAdminSkeleton() {
  return (
    <SectionCard>
      <div className="flex items-start justify-between gap-3">
        <Pulse className="h-6 w-28" />
        <ButtonSkeleton />
      </div>

      <div className="mt-6 sm:mt-8">
        <Pulse className="h-5 w-40 mb-3 sm:mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
          <FieldSkeleton />
          <FieldSkeleton />
          <FieldSkeleton w="sm:col-span-2 w-full" />
          <FieldSkeleton w="sm:col-span-2 w-full" />
          <FieldSkeleton w="sm:col-span-2 w-full" />
          <FieldSkeleton w="sm:col-span-2 w-full" />
        </div>

        <div className="mt-3 sm:mt-4 flex items-center justify-end gap-2.5 sm:gap-3">
          <Pulse className="h-5 w-20" />
          <ButtonSkeleton w="w-32" />
        </div>
      </div>

      <div className="my-6 sm:my-8 h-px bg-gray-200/80" />

      <div>
        <div className="flex items-center justify-between gap-3">
          <Pulse className="h-5 w-36" />
          <ButtonSkeleton w="w-28" />
        </div>
        <div className="mt-3 sm:mt-4 space-y-2">
          <PaymentSkeletonRow />
          <PaymentSkeletonRow />
        </div>
      </div>
    </SectionCard>
  );
}

function PaymentSkeletonRow() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr,auto] gap-3 items-center p-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="min-w-0">
        <LineSkeleton />
        <Pulse className="h-[14px] w-24 mt-1" />
      </div>
      <div className="flex items-center justify-start sm:justify-end gap-2">
        <ButtonSkeleton w="w-24" h="h-9" />
        <ButtonSkeleton w="w-20" h="h-9" />
      </div>
    </div>
  );
}

function HistorySkeleton() {
  return (
    <SectionCard>
      <Pulse className="h-6 w-24" />
      <div className="mt-5 sm:mt-6 space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-3 p-4 rounded-2xl border border-gray-200 bg-white shadow-sm"
          >
            <div className="min-w-0 flex-1">
              <LineSkeleton />
              <Pulse className="h-[18px] w-40 mt-1" />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ButtonSkeleton w="w-28" h="h-9" />
              <ButtonSkeleton w="w-28" h="h-9" />
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function RolePillToggle({ value = "member", onChange, disabled = false, uid }) {
  const active = (r) => (value === r ? "text-white" : "text-gray-700");
  const common =
    "relative h-7 px-3 text-xs font-medium transition-colors focus:outline-none";

  return (
    <div
      className={[
        "relative inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden",
        disabled ? "opacity-60 pointer-events-none" : ""
      ].join(" ")}
      role="tablist"
      aria-label="Change role"
    >
      <button
        role="tab"
        aria-selected={value !== "admin"}
        className={`${common} ${active("member")}`}
        onClick={() => onChange?.("member")}
      >
        {value === "member" && (
          <motion.div
            layoutId={`rolePill_${uid}`}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 bg-gray-900 rounded-lg"
          />
        )}
        <span className="relative z-10">Member</span>
      </button>
      <button
        role="tab"
        aria-selected={value === "admin"}
        className={`${common} ${active("admin")}`}
        onClick={() => onChange?.("admin")}
      >
        {value === "admin" && (
          <motion.div
            layoutId={`rolePill_${uid}`}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 bg-gray-900 rounded-lg"
          />
        )}
        <span className="relative z-10">Admin</span>
      </button>
    </div>
  );
}

function UsersSkeleton() {
  return (
    <SectionCard>
      <div className="flex items-center justify-between">
        <Pulse className="h-6 w-16" />
        <ButtonSkeleton w="w-28" />
      </div>
      <div className="mt-5 sm:mt-6 space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="grid grid-cols-1 sm:grid-cols-[1fr_auto] items-center gap-2 p-4 rounded-2xl border border-gray-200 bg-white shadow-sm"
          >
            <div className="min-w-0">
              <LineSkeleton />
              <Pulse className="h-[14px] w-40 mt-1" />
            </div>
            <Pulse className="h-7 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

/* ----------------------- Stripe: add card form ----------------------- */
function AddCardForm({ user, onDone }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const handleAdd = useCallback(async () => {
    if (!stripe || !elements || !user) return;
    try {
      setBusy(true);
      setErr("");
      const { client_secret } = await createSetupIntent(() => user.getIdToken());
      const card = elements.getElement(CardElement);
      const { error } = await stripe.confirmCardSetup(client_secret, { payment_method: { card } });
      if (error) throw error;
      await refreshStripeStatus(() => user.getIdToken());
      onDone?.({ ok: true });
    } catch (e) {
      setErr(e?.message || "Could not save card.");
    } finally {
      setBusy(false);
    }
  }, [stripe, elements, user, onDone]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="border border-gray-200 rounded-2xl p-3 sm:p-4 bg-gray-50">
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
      {err && <div className="text-sm text-red-600">{err}</div>}
      <button onClick={handleAdd} disabled={busy} className={BTN.primary + " w-full"}>
        {busy ? "Saving..." : "Save Card"}
      </button>
    </div>
  );
}

/* ---------------------- Payment row (consistent) ---------------------- */
function PaymentRow({ pm, onMakeDefault, onDelete }) {
  const brand = pm.brand ? titleCase(pm.brand) : "Card";
  const exp = pm.exp_month && pm.exp_year ? `Expires ${String(pm.exp_month).padStart(2, "0")}/${pm.exp_year}` : "";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr,auto] gap-3 items-center p-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="min-w-0">
        <div className="text-sm sm:text-base font-medium text-gray-900 truncate">
          {brand} •••• {pm.last4}
        </div>
        <div className="text-xs sm:text-sm text-gray-500">{exp}</div>
      </div>
      <div className="flex items-center justify-start sm:justify-end gap-2">
        {pm.is_default ? (
          <button
            className="min-h-[44px] h-10 px-4 rounded-xl border bg-gray-900 text-white text-sm border-transparent cursor-default"
            disabled
            aria-disabled="true"
            tabIndex={-1}
          >
            Default
          </button>
        ) : (
          <button onClick={() => onMakeDefault(pm.id)} className={BTN.secondary + " text-sm"}>
            Make default
          </button>
        )}
        <button onClick={() => onDelete(pm.id)} className={BTN.secondary + " text-sm"}>
          Delete
        </button>
      </div>
    </div>
  );
}

/* -------------------------- Data / actions -------------------------- */
function useAccountData() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  // Loading flags for smooth UI
  const [statusLoading, setStatusLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [cardsLoading, setCardsLoading] = useState(false);

  const [status, setStatus] = useState({ logged_in: false, role: "member" });

  // profile/company (admin area)
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [bizAddr, setBizAddr] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");

  // billing
  const [cards, setCards] = useState([]);
  const [addingCard, setAddingCard] = useState(false);
  const [billingMsg, setBillingMsg] = useState("");

  // jobs
  const [jobs, setJobs] = useState([]);
  const [jobsNext, setJobsNext] = useState(null);
  const [jobsBusy, setJobsBusy] = useState(false);


// Hard refresh first page of history
 const refreshJobs = useCallback(async () => {
   if (!user) return;
   setJobsBusy(true);
   try {
     const page = await fetchJobHistory(() => user.getIdToken(), { limit: 10 });
     setJobs(page?.items || []);
     setJobsNext(page?.next_page_token || null);
   } finally {
     setJobsBusy(false);
   }
 }, [user]);

  // members
  const [members, setMembers] = useState([]);
  const [membersBusy, setMembersBusy] = useState(false);
  const [membersLoaded, setMembersLoaded] = useState(false); // <-- NEW
  const [roleBusyByUid, setRoleBusyByUid] = useState({});

  const isAdmin = useMemo(() => (status?.role || "").toLowerCase() === "admin", [status?.role]);

  // Observe auth + load everything
  useEffect(() => {
    const un = observeAuthState(async (u) => {
      setUser(u || null);
      setAuthReady(true);

      if (!u) return;

      // 1) Status
      setStatusLoading(true);
      try {
        const s = await getAccountStatus(() => u.getIdToken());
        setStatus(s || {});
      } catch {
        setStatus((s) => s || { role: "member" });
      } finally {
        setStatusLoading(false);
      }

      // 2) Profile
      setProfileLoading(true);
      try {
        const r = await getCustomerProfile(() => u.getIdToken());
        const p = r?.profile || {};
        setFirstName(p.first_name || "");
        setLastName(p.last_name || "");
        setEmail(p.email || u.email || "");
        setPhone(p.phone || u.phoneNumber || "");
        setCompany(p.company_name || "");
        setBizAddr(p.business_address || "");
      } catch {
        const provider = u.providerData?.[0];
        const name = provider?.displayName || "";
        if (name) {
          const [fn, ...rest] = name.split(" ");
          setFirstName((v) => v || fn || "");
          setLastName((v) => v || (rest?.join(" ") || ""));
        }
        setEmail((v) => v || u.email || provider?.email || "");
        setPhone((v) => v || u.phoneNumber || provider?.phoneNumber || "");
      } finally {
        setProfileLoading(false);
      }

      // 3) Jobs
      try {
        setJobsBusy(true);
        const page = await fetchJobHistory(() => u.getIdToken(), { limit: 10 });
        setJobs(page?.items || []);
        setJobsNext(page?.next_page_token || null);
      } finally {
        setJobsBusy(false);
      }

      // 4) Members list (cold load)
      try {
        setMembersBusy(true);
        const m = await membershipsMembers(() => u.getIdToken());
        setMembers(m?.data || []);
        setMembersLoaded(true); // <-- mark loaded once
      } catch {
        setMembers([]);
        setMembersLoaded(true);
      } finally {
        setMembersBusy(false);
      }
    });
    return () => un && un();
  }, []);

  // Patch payload
  const patchPayload = useMemo(() => {
    const p = {};
    if (firstName.trim()) p.first_name = firstName.trim();
    if (lastName.trim()) p.last_name = lastName.trim();
    if (company.trim()) p.company_name = company.trim();
    if (bizAddr.trim()) p.business_address = bizAddr.trim();
    return p;
  }, [firstName, lastName, company, bizAddr]);

  const hasSomethingToSave = useMemo(() => Object.keys(patchPayload).length > 0, [patchPayload]);

  const handleSaveProfile = useCallback(async () => {
    if (!user || !isAdmin || !hasSomethingToSave) return;
    setSavingProfile(true);
    setProfileMsg("");
    try {
      await customersProfilePatch(() => user.getIdToken(), patchPayload);
      const s = await getAccountStatus(() => user.getIdToken());
      setStatus(s);
      setProfileMsg("Saved.");
    } catch (e) {
      setProfileMsg(e?.message || "Could not save profile.");
    } finally {
      setSavingProfile(false);
      setTimeout(() => setProfileMsg(""), 2500);
    }
  }, [user, isAdmin, hasSomethingToSave, patchPayload]);

  const refreshCards = useCallback(async () => {
    if (!user || !isAdmin) return;
    setCardsLoading(true);
    try {
      const list = await listPaymentMethods(() => user.getIdToken(), { limit: 10 });
      const data = list?.data || [];
      if (data.length === 1 && !data[0].is_default) {
        try {
          await setDefaultPM(() => user.getIdToken(), data[0].id);
          await refreshStripeStatus(() => user.getIdToken());
          const after = await listPaymentMethods(() => user.getIdToken(), { limit: 10 });
          setCards(after?.data || []);
          return;
        } catch {}
      }
      setCards(data);
    } finally {
      setCardsLoading(false);
    }
  }, [user, isAdmin]);

  const onMakeDefault = useCallback(
    async (pmid) => {
      if (!user || !isAdmin) return;
      try {
        await setDefaultPM(() => user.getIdToken(), pmid);
        await refreshStripeStatus(() => user.getIdToken());
        await refreshCards();
        setBillingMsg("Default updated.");
      } catch {
        setBillingMsg("Could not update default card.");
      } finally {
        setTimeout(() => setBillingMsg(""), 2500);
      }
    },
    [user, isAdmin, refreshCards]
  );

  const onDelete = useCallback(
    async (pmid) => {
      if (!user || !isAdmin) return;
      try {
        await deletePM(() => user.getIdToken(), pmid);
        await refreshCards();
        setBillingMsg("Card removed.");
      } catch {
        setBillingMsg("Could not remove card.");
      } finally {
        setTimeout(() => setBillingMsg(""), 2500);
      }
    },
    [user, isAdmin, refreshCards]
  );

  const loadMoreJobs = useCallback(async () => {
    if (!user || !jobsNext || jobsBusy) return;
    setJobsBusy(true);
    try {
      const page = await fetchJobHistory(() => user.getIdToken(), { page_token: jobsNext, limit: 10 });
      setJobs((prev) => [...prev, ...(page?.items || [])]);
      setJobsNext(page?.next_page_token || null);
    } finally {
      setJobsBusy(false);
    }
  }, [user, jobsNext, jobsBusy]);

  useEffect(() => { if (user && isAdmin) refreshCards(); }, [user, isAdmin, refreshCards]);

  // Canonical "ME" for member info
  const me = useMemo(() => {
    const self = members.find((m) => m.uid === (user?.uid || ""));
    const role = (status?.role || self?.role || "member").toLowerCase();
    const emailSelf = user?.email || self?.email || "";
    const display =
      (self?.display_name || "").trim() || (user?.displayName || "") || (emailSelf ? emailSelf.split("@")[0] : "");
    return { role, email: emailSelf, displayName: display };
  }, [members, user, status?.role]);

    // Optimistic role change for admins
  const setMemberRole = useCallback(
    async (uidTarget, role) => {
      if (!user || !isAdmin || !uidTarget || !role) return;
      // don't allow demoting yourself (easy foot-gun); can be changed later
      if (uidTarget === user.uid) return;

      setRoleBusyByUid((m) => ({ ...m, [uidTarget]: true }));
      const before = members;
      // optimistic UI
      setMembers((arr) => arr.map((m) => (m.uid === uidTarget ? { ...m, role } : m)));
      try {
        await membershipsSetRole(() => user.getIdToken(), { uid: uidTarget, role });
        // Optionally re-pull from server later:
        // const fresh = await membershipsMembers(() => user.getIdToken());
        // setMembers(fresh?.data || []);
      } catch (e) {
        // revert on error
        setMembers(before);
      } finally {
        setRoleBusyByUid((m) => {
          const n = { ...m };
          delete n[uidTarget];
          return n;
        });
      }
    },
    [user, isAdmin, members]
  );

  // Fetch members (cold only unless forced). Do NOT trigger skeleton if we already have data.
  const fetchMembersList = useCallback(
    async ({ force = false } = {}) => {
      if (!user) return;
      if (membersLoaded && !force) return; // already have data; skip
      setMembersBusy(true);
      try {
        const m = await membershipsMembers(() => user.getIdToken());
        setMembers(m?.data || []);
        setMembersLoaded(true);
      } finally {
        setMembersBusy(false);
      }
    },
    [user, membersLoaded]
  );

  return {
    user,
    authReady,
    status,
    isAdmin,
    statusLoading,
    profileLoading,
    cardsLoading,
    // Company profile (admin)
    firstName,
    lastName,
    email,
    company,
    bizAddr,
    setFirstName,
    setLastName,
    setEmail,
    setCompany,
    setBizAddr,
    savingProfile,
    profileMsg,
    handleSaveProfile,
    hasSomethingToSave,
    // Me (member view)
    phone,
    me,
    // Billing
    cards,
    addingCard,
    setAddingCard,
    billingMsg,
    onMakeDefault,
    onDelete,
    refreshCards,
    // Jobs
    jobs,
    jobsNext,
    jobsBusy,
    loadMoreJobs,
    refreshJobs,
    // Members
    members,
    membersBusy,
    membersLoaded, // <-- expose
    fetchMembersList,
    roleBusyByUid,
    setMemberRole,
  };
}

/* ====================== Top Tab Bar ====================== */
function TopTabBar({ current, onChange }) {
  const items = ["Account", "History", "Users"];
  return (
    <div className="md:sticky md:top-0 z-10 bg-white/80 md:backdrop-blur supports-[backdrop-filter]:md:bg-white/60">
      <div className="max-w-[1120px] mx-auto">
        <div className="mt-4 sm:mt-6 mb-4 sm:mb-6">
          <div className="relative w-full overflow-x-auto">
            <div className="inline-flex min-w-full justify-start px-4">
              <div className="relative inline-flex rounded-xl bg-gray-50 border border-gray-200 overflow-hidden shadow-inner">
                {items.map((t) => {
                  const active = t === current;
                  return (
                    <button
                      key={t}
                      onClick={() => onChange(t)}
                      className={[
                        "relative px-3 sm:px-4 h-10 text-sm font-medium transition-colors",
                        "focus:outline-none",
                        active ? "text-white" : "text-gray-700 hover:text-gray-900",
                      ].join(" ")}
                    >
                      {active && (
                        <motion.div
                          layoutId="acctTabIndicator"
                          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                          className="absolute inset-0 bg-gray-900"
                        />
                      )}
                      <span className="relative z-10">{t}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================= Panels ============================= */
function PanelAccount({ d }) {
  const navigate = useNavigate();
  const role = (d?.me?.role || d?.status?.role || "member").toLowerCase();

  const onSignOut = useCallback(async () => {
    await signOutUser();
    try { window.sessionStorage.removeItem("auth.intent"); } catch {}
    navigate("/", { replace: true, state: { from: "signout", ts: Date.now() } });
  }, [navigate]);

  // While role/profile not ready, show steady skeleton
  if (d.statusLoading || d.profileLoading) {
    return (
      <motion.section
        key="account-skeleton"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
      >
        <AccountAdminSkeleton />
      </motion.section>
    );
  }

  // MEMBER view
  if (!d.isAdmin) {
    return (
      <motion.section
        key="account-member"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-7 space-y-6 sm:space-y-8 shadow-sm"
      >
        <div className="flex items-start justify-between gap-3 sm:gap-4">
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">Account</h2>
          <button onClick={onSignOut} className={BTN.secondary}>Sign out</button>
        </div>

        <div>
          <h3 className="text-base sm:text-lg font-semibold text-gray-900">My info</h3>
          <div className="mt-3 sm:mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
            <input className="h-11 rounded-xl border border-gray-200 px-3 sm:col-span-2 bg-gray-50 text-gray-700" value={d.me?.displayName || ""} readOnly />
            <input className="h-11 rounded-xl border border-gray-200 px-3 sm:col-span-2 bg-gray-50 text-gray-700" value={d.me?.email || ""} readOnly />
            <input className="h-11 rounded-xl border border-gray-200 px-3 sm:col-span-2 bg-gray-50 text-gray-700" value={`Role: ${titleCase(role)}`} readOnly />
          </div>
        </div>

        <SectionDivider />

        <div>
          <h3 className="text-base sm:text-lg font-semibold text-gray-900">
            Business contact
          </h3>

          <div className="mt-3 sm:mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
            <input
              className="h-11 rounded-xl border border-gray-200 px-3 bg-gray-50 text-gray-700"
              value={BUSINESS_CONTACT.name}
              readOnly
            />
            <input
              className="h-11 rounded-xl border border-gray-200 px-3 bg-gray-50 text-gray-700"
              value={BUSINESS_CONTACT.email}
              readOnly
            />
          </div>
        </div>

        <div className="rounded-2xl border border-dashed border-gray-300 p-4 sm:p-5 text-sm text-gray-600">
          Billing is managed by an admin on your team.
        </div>
      </motion.section>
    );
  }

  // ADMIN view
  return (
    <motion.section
      key="account-admin"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-7 space-y-8 sm:space-y-10 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3 sm:gap-4">
        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">Account</h2>
        <button onClick={onSignOut} className={BTN.secondary}>Sign out</button>
      </div>

      {/* Company profile (admin) */}
      <div>
        <h3 className="text-base sm:text-lg font-semibold text-gray-900">Company profile</h3>
        <div className="mt-3 sm:mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
          <input className="h-11 rounded-xl border border-gray-200 px-3" placeholder="First name" value={d.firstName} onChange={(e) => d.setFirstName(e.target.value)} />
          <input className="h-11 rounded-xl border border-gray-200 px-3" placeholder="Last name" value={d.lastName} onChange={(e) => d.setLastName(e.target.value)} />
          <input className="h-11 rounded-xl border border-gray-200 px-3 sm:col-span-2" placeholder="Company" value={d.company} onChange={(e) => d.setCompany(e.target.value)} />
          <input className="h-11 rounded-xl border border-gray-200 px-3 sm:col-span-2" placeholder="Business address" value={d.bizAddr} onChange={(e) => d.setBizAddr(e.target.value)} />
          {/* Contact (read-only) */}
          <input className="h-11 rounded-xl border border-gray-200 px-3 sm:col-span-2 bg-gray-50 text-gray-700" placeholder="Email" inputMode="email" value={d.email} readOnly disabled />
          <input className="h-11 rounded-xl border border-gray-200 px-3 sm:col-span-2 bg-gray-50 text-gray-700" placeholder="Phone" value={d.phone || ""} readOnly disabled />
        </div>
        <div className="mt-3 sm:mt-4 flex items-center justify-end gap-2.5 sm:gap-3">
          {d.profileMsg && <span className="text-sm text-gray-500">{d.profileMsg}</span>}
          <button onClick={d.handleSaveProfile} disabled={!d.hasSomethingToSave || d.savingProfile} className={BTN.primary}>
            {d.savingProfile ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
      <SectionDivider />
      {/* Dedicated business point of contact */}
      <div>
        <h3 className="text-base sm:text-lg font-semibold text-gray-900">
          Business contact
        </h3>

        <div className="mt-3 sm:mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
          <input
            className="h-11 rounded-xl border border-gray-200 px-3 bg-gray-50 text-gray-700"
            value={BUSINESS_CONTACT.name}
            readOnly
          />
          <input
            className="h-11 rounded-xl border border-gray-200 px-3 bg-gray-50 text-gray-700"
            value={BUSINESS_CONTACT.email}
            readOnly
          />
        </div>
      </div>

      <SectionDivider />

      {/* Payments */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900">Payment method</h3>
          <button onClick={() => d.setAddingCard(true)} className={BTN.secondary}>+ Add card</button>
        </div>

        <div className="mt-3 sm:mt-4 space-y-2">
          {d.cardsLoading ? (
            <>
              <PaymentSkeletonRow />
            </>
          ) : d.cards.length === 0 ? (
            <div className="p-4 sm:p-5 rounded-2xl border border-dashed border-gray-300 text-sm text-gray-600">
              No card on file yet — add one to finish setup.
            </div>
          ) : (
            d.cards.map((pm) => (
              <PaymentRow key={pm.id} pm={pm} onMakeDefault={d.onMakeDefault} onDelete={d.onDelete} />
            ))
          )}
        </div>

        {d.billingMsg && <div className="mt-2 text-sm text-gray-500">{d.billingMsg}</div>}

        <AnimatePresence>
          {d.addingCard && (
            <>
              <motion.div
                className="fixed inset-0 z-[90] bg-black/40"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => d.setAddingCard(false)}
              />
              <motion.div
                className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-0 sm:px-4"
                initial={{ opacity: 0, scale: 0.985 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.985 }}
              >
                {/* Mobile sheet / desktop modal */}
                <div className="w-full sm:max-w-[520px] bg-white rounded-t-2xl sm:rounded-2xl shadow-xl border border-gray-200 p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
                  <div className="flex items-center justify-between mb-3 sm:mb-4">
                    <div className="text-[15px] sm:text-[16px] font-semibold">Add a card</div>
                    <button className={BTN.subtle} onClick={() => d.setAddingCard(false)}>Close</button>
                  </div>
                  <Elements stripe={stripePromise}>
                    <AddCardForm
                      user={d.user}
                      onDone={async () => {
                        await d.refreshCards();
                        d.setAddingCard(false);
                      }}
                    />
                  </Elements>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}

/* ---------------------- History row + formatters ---------------------- */
function _ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function _plural(n, one, many) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return `${x} ${x === 1 ? one : many}`;
}

function _safeNum(n, fallback = null) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

/**
 * Prefer start_at_utc formatted in item.timezone_id.
 * Fallback to job_date (YYYY-MM-DD) with a neutral display.
 */
function formatHistoryDate(item) {
  try {
    if (item?.start_at_utc) {
      const tz = item?.timezone_id || "UTC";
      const d = new Date(item.start_at_utc);
      const parts = new Intl.DateTimeFormat(undefined, {
        timeZone: tz,
        weekday: "short",
        month: "long",
        day: "numeric",
      }).formatToParts(d);

      const get = (t) => (parts.find(p => p.type === t) || {}).value || "";
      const wd = get("weekday");        // Sat
      const month = get("month");       // June
      const day = Number(get("day") || ""); // 2
      const dayOrd = Number.isFinite(day) ? _ordinal(day) : get("day");
      return `${wd}, ${month} ${dayOrd}`;
    }
  } catch (_) {}

  if (item?.job_date) {
    // job_date is YYYY-MM-DD; render as "Sat, June 2nd" (best-effort local)
    const d = new Date(`${item.job_date}T12:00:00Z`); // noon UTC to avoid TZ off-by-one
    const parts = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "long",
      day: "numeric",
    }).formatToParts(d);
    const get = (t) => (parts.find(p => p.type === t) || {}).value || "";
    const wd = get("weekday");
    const month = get("month");
    const day = Number(get("day") || "");
    const dayOrd = Number.isFinite(day) ? _ordinal(day) : get("day");
    return `${wd}, ${month} ${dayOrd}`;
  }

  return "—";
}

function formatHistoryDateTimeShort(item) {
  try {
    if (item?.start_at_utc) {
      const tz = item?.timezone_id || "UTC";
      const d = new Date(item.start_at_utc);

      const parts = new Intl.DateTimeFormat(undefined, {
        timeZone: tz,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).formatToParts(d);

      const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
      const wd = get("weekday");      // Fri
      const month = get("month");     // Nov
      const day = get("day");         // 29
      const hour = get("hour");       // 1
      const minute = get("minute");   // 00
      const dayPeriod = get("dayPeriod"); // AM / PM

      if (wd && month && day && hour && minute && dayPeriod) {
        // Example: "Fri, Nov 29 · 1:00 PM"
        return `${wd}, ${month} ${day} · ${hour}:${minute} ${dayPeriod}`;
      }
    }
  } catch (_) {}

  // Fallback to job_date + optional label if no start_at_utc
  if (item?.job_date) {
    const d = new Date(`${item.job_date}T12:00:00Z`);
    const parts = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).formatToParts(d);
    const get = (t) => (parts.find((p) => p.type === t) || {}).value || "";
    const wd = get("weekday");
    const month = get("month");
    const day = get("day");
    const base = wd && month && day ? `${wd}, ${month} ${day}` : "—";
    const timeLabel = (item?.job_time_label || "").trim();
    return timeLabel ? `${base} · ${timeLabel}` : base;
  }

  return "—";
}
/* Bullet separator */
const Dot = () => <span className="mx-2 text-gray-300" aria-hidden>•</span>;

function JobRow({ item }) {
  const display = item?.display_id || item?.job_id || "—";
  const dateLabel = formatHistoryDate(item);                // desktop (unchanged)
  const dateTimeShort = formatHistoryDateTimeShort(item);   // mobile

  const _safeNum = (n, fb = null) => {
    const x = Number(n);
    return Number.isFinite(x) ? x : fb;
  };
  const _plural = (n, one, many) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return "—";
    return `${x} ${x === 1 ? one : many}`;
  };
  const workers = _safeNum(item?.workers);
  const duration = _safeNum(item?.duration_hours);
  const workersLabel = workers != null ? _plural(workers, "Worker", "Workers") : null;
  const durationLabel = duration != null ? _plural(duration, "Hour", "Hours") : null;

  // Credit note (optional)
  const creditPdf = (item?.credit_note_pdf || "").trim() || null;
  const creditAmt = (item?.credit_note_amount || "").trim();
  const creditAmtLabel = creditAmt ? `$${Number(creditAmt).toFixed(2)}` : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      className="group flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-2xl border border-gray-200 bg-white shadow-sm hover:shadow transition-shadow"
    >
      {/* LEFT / TOP: text */}
      <div className="min-w-0 flex-1">
        {/* Mobile: stacked, only ID + short date/time */}
        <div className="sm:hidden">
          <div className="text-sm font-semibold text-gray-900 truncate">
            {display}
          </div>
          <div className="mt-0.5 text-xs text-gray-600 truncate">
            {dateTimeShort}
          </div>
        </div>

        {/* Desktop: original single-line layout (unchanged) */}
        <div className="hidden sm:flex min-w-0 items-center text-[15px] sm:text-[16px] leading-6 text-gray-900">
          <span className="truncate font-semibold">{display}</span>
          <Dot />
          <span className="truncate">{dateLabel}</span>

          {(workersLabel || durationLabel) && <Dot />}

          <span className="truncate">
            {workersLabel ? workersLabel : "—"}
            {durationLabel ? ` for ${durationLabel}` : ""}
          </span>
        </div>
      </div>

      {/* RIGHT / BOTTOM: action chips */}
      <div className="flex flex-wrap gap-2 pt-1 sm:pt-0 justify-start sm:justify-end">
        <motion.a
          href={item?.invoice_url || "#"}
          target="_blank"
          rel="noopener noreferrer"
          whileTap={{ scale: 0.98 }}
          className="inline-flex items-center h-9 px-4 rounded-full bg-gray-900 text-white text-xs sm:text-sm font-medium hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-gray-900/40 transition w-auto"
          aria-label={`View invoice for ${display}`}
        >
          View Invoice
        </motion.a>

        {creditPdf && (
          <motion.a
            href={creditPdf}
            target="_blank"
            rel="noopener noreferrer"
            whileTap={{ scale: 0.98 }}
            className="inline-flex items-center h-9 px-4 rounded-full border border-gray-200 bg-white text-gray-900 text-xs sm:text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-900/10 transition w-auto"
            aria-label={`View credit note for ${display}${creditAmtLabel ? ` (${creditAmtLabel})` : ""}`}
            title={creditAmtLabel ? `Credit Note — ${creditAmtLabel}` : "Credit Note"}
          >
            Credit Note{creditAmtLabel ? ` · ${creditAmtLabel}` : ""}
          </motion.a>
        )}
      </div>
    </motion.div>
  );
}

function PanelHistory({ d }) {
  return (
    <motion.section
      key="history"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-7 shadow-sm"
    >
            <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">History</h2>
        <div className="flex items-center gap-2">
          {d.jobsBusy && <Spinner />}
          <button onClick={d.refreshJobs} className={BTN.secondary + " text-sm"}>
            Refresh
          </button>
        </div>
      </div>

      {d.jobsBusy ? (
        <div className="mt-5 sm:mt-6">
          <HistorySkeleton />
        </div>
      ) : (
        <>
          <div className="mt-5 sm:mt-6 space-y-3">
            {d.jobs.length === 0 ? (
              <div className="p-4 sm:p-5 rounded-2xl border border-dashed border-gray-300 text-sm text-gray-600">
                No past jobs yet.
              </div>
            ) : (
              d.jobs.map((j) => <JobRow key={`${j.job_id}:${j.completed_at || j.start_at_utc}`} item={j} />)
            )}
          </div>
          {d.jobsNext && (
            <div className="mt-5 sm:mt-6">
              <button onClick={d.loadMoreJobs} className={BTN.secondary + " text-sm"}>Load more</button>
            </div>
          )}
        </>
      )}
    </motion.section>
  );
}

/* ---------------------- Add User Modal (admin only) ---------------------- */
function AddUserModal({ user, open, onClose }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const sendInvite = useCallback(async () => {
    if (!user || !email.trim()) return;
    try {
      setBusy(true);
      setMsg("");
      const res = await membershipsInvite(() => user.getIdToken(), { email: email.trim().toLowerCase(), role });
      setMsg(`Invite sent to ${res?.email || email.trim().toLowerCase()}.`);
      setEmail("");
      setRole("member");
    } catch (e) {
      setMsg(e?.message || "Could not send invite.");
    } finally {
      setBusy(false);
    }
  }, [user, email, role]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-[90] bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center px-0 sm:px-4"
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
          >
            <div className="w-full sm:max-w-[520px] bg-white rounded-t-2xl sm:rounded-2xl shadow-xl border border-gray-200 p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-3 sm:mb-4">
                <div className="text-[15px] sm:text-[16px] font-semibold">Invite teammate</div>
                <button className={BTN.subtle} onClick={onClose}>Close</button>
              </div>

              <div className="space-y-3">
                <input
                  type="email"
                  className="h-11 w-full rounded-xl border border-gray-200 px-3"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <select
                  className="h-11 w-full rounded-xl border border-gray-200 px-3 bg-white"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>

                {msg && (
                  <div className={`text-sm ${msg.toLowerCase().includes("could not") ? "text-red-600" : "text-green-600"}`}>
                    {msg}
                  </div>
                )}

                <button onClick={sendInvite} disabled={busy || !email.trim()} className={BTN.primary + " w-full"}>
                  {busy ? "Sending..." : "Send invite"}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function PanelUsers({ d }) {
  const [addingUser, setAddingUser] = useState(false);

  return (
    <motion.section
      key="users"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-7 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">Users</h2>
        <div className="flex items-center gap-2">
          {/* soft refresh indicator; no skeleton flash */}
          {d.membersBusy && d.membersLoaded && <Spinner />}
          {d.isAdmin && (
            <button className={BTN.secondary + " text-sm"} onClick={() => setAddingUser(true)}>
              + Add user
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 sm:mt-6 space-y-2">
        {!d.membersLoaded ? (
          <UsersSkeleton />
        ) : d.members.length === 0 ? (
          <div className="p-4 sm:p-5 rounded-2xl border border-dashed border-gray-300 text-sm text-gray-600">
            No users yet.
          </div>
        ) : (
          d.members.map((m) => {
            const name = (m.display_name || "").trim() || (m.email ? m.email.split("@")[0] : "") || "User";
            const subtitle = m.email || "—";
            const joined = m.joined_at ? `Joined ${whenFromISO(m.joined_at)}` : null;

            return (
              <div
                key={m.uid}
                className="grid grid-cols-1 sm:grid-cols-[1fr_auto] items-center gap-2 p-4 rounded-2xl border border-gray-200 bg-white shadow-sm"
              >
                <div className="min-w-0">
                  <div className="text-sm sm:text-base font-medium text-gray-900 truncate">{name}</div>
                  <div className="text-xs sm:text-sm text-gray-600 truncate">
                    {subtitle}
                    {joined ? <span className="text-gray-400"> · {joined}</span> : null}
                  </div>
                </div>
                <div className="flex justify-start sm:justify-end items-center relative">
                  {d.isAdmin && m.uid && m.uid !== d.user?.uid ? (
                    <div className="relative">
                      <RolePillToggle
                        uid={m.uid}
                        value={(m.role || "member").toLowerCase()}
                        disabled={!!d.roleBusyByUid[m.uid]}
                        onChange={(nextRole) => d.setMemberRole(m.uid, nextRole)}
                      />
                      {d.roleBusyByUid[m.uid] && (
                        <div className="absolute inset-0 grid place-items-center">
                          <Spinner className="w-4 h-4 text-gray-400" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="inline-flex items-center h-7 px-3 rounded-full bg-gray-100 text-gray-800 text-xs font-medium">
                      {titleCase(m.role || "member")}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <button onClick={() => d.fetchMembersList({ force: true })} className={BTN.secondary + " text-sm"}>
          Refresh
        </button>
      </div>

      {d.isAdmin && <AddUserModal user={d.user} open={addingUser} onClose={() => setAddingUser(false)} />}
    </motion.section>
  );
}

/* =========================== Page (Top bar only) =========================== */
function AccountTabsLeft() {
  const d = useAccountData();
  const [tab, setTab] = useState("Account");

  // Only cold-fetch users the first time you land on the Users tab
  useEffect(() => {
    if (tab === "Users" && !d.membersLoaded && !d.membersBusy) {
      d.fetchMembersList?.();
    }
  }, [tab, d.membersLoaded, d.membersBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  // While auth observer hasn’t resolved, keep page stable
  if (!d.authReady || !d.user) {
    return (
      <div className="h-full min-h-0 overflow-y-auto">
        <div className="max-w-[1120px] mx-auto px-3 sm:px-4 pb-20 sm:pb-10">
          <div className="mt-4 sm:mt-6">
            <AccountAdminSkeleton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="max-w-[1120px] mx-auto px-3 sm:px-4 pb-[calc(env(safe-area-inset-bottom)+72px)] sm:pb-10">
        <TopTabBar current={tab} onChange={setTab} />

        <AnimatePresence mode="wait">
          {tab === "Account" && <PanelAccount d={d} />}
          {tab === "History" && <PanelHistory d={d} />}
          {tab === "Users" && <PanelUsers d={d} />}
        </AnimatePresence>
      </div>
    </div>
  );
}
/* ------------------------------ Export ------------------------------ */
export default function Account() {
  return <AccountTabsLeft />;
}
