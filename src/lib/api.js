// src/lib/api.js

// ------------------------------ base URLs ------------------------------
// Primary FastAPI backend (booking/chat flows)
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:8080").replace(/\/$/, "");

export const AUTH_API_BASE = (import.meta.env.VITE_AUTH_API_BASE || API_BASE).replace(/\/$/, "");

// Optional: separate base for legacy CRM/Bookings service
// Falls back to API_BASE if not provided.
export const CRM_API_BASE = (
  import.meta.env.VITE_CRM_API_BASE_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  API_BASE
).replace(/\/$/, "");

export const CRM_WEBHOOK_URL = (import.meta.env.VITE_CRM_WEBHOOK_URL).replace(/\/$/, "");

export const CRM_WEBHOOK_TOKEN =
  (import.meta.env.VITE_CRM_WEBHOOK_TOKEN || "").trim() || null;

/* ------------------------------ helpers ------------------------------ */
async function handle(res) {
  if (!res.ok) {
    // try to surface any JSON error; otherwise text; otherwise generic
    let body = "";
    try {
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const j = await res.json();
        body = typeof j === "string" ? j : JSON.stringify(j);
      } else {
        body = await res.text();
      }
    } catch (_) {}
    const msg = body || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
  return res.json();
}

function newIdemKey(prefix = "idem_") {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `${prefix}${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  );
}

// Resolve Authorization header. If required=true and we can't find a token → throw.
async function authHeader(getIdToken, token, { required = false } = {}) {
  const bearer = token || (getIdToken ? await getIdToken() : null);
  if (required && !bearer) {
    throw new Error("Not signed in or missing authorization");
  }
  return bearer ? { Authorization: `Bearer ${bearer}` } : {};
}

/* --------------------- time / timezone utilities --------------------- */
// "10:00 AM" (or "1:30 pm") → { h: 10, m: 0 } in 24h
function parseTime12h(label) {
  const m = String(label || "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) throw new Error(`Bad time string: ${label}`);
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return { h, m: min };
}

/**
 * Convert a local wall time (in an IANA TZ) to a precise UTC ISO instant.
 * Handles DST transitions by iterating until the formatter shows the target
 * Y-M-D h:m inside `timeZone`.
 */
export function localWallTimeToUtcISO(dateStr, timeLabel, timeZone) {
  if (!dateStr || !timeLabel || !timeZone) {
    throw new Error("localWallTimeToUtcISO: missing date/time/timeZone");
  }
  const [Y, M, D] = String(dateStr).split("-").map(Number);
  const { h, m } = parseTime12h(timeLabel);

  // initial guess
  let guess = new Date(Date.UTC(Y, M - 1, D, h, m));

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Iterate a few times to land exactly on the instant that *displays* as Y-M-D h:m in that TZ.
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(fmt.formatToParts(guess).map(p => [p.type, p.value]));
    const shownUTC = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute)
    );
    const wantUTC = Date.UTC(Y, M - 1, D, h, m);
    const diff = wantUTC - shownUTC;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }
  return guess.toISOString();
}

/* ----------------------------- CRM END JOB + CANCEL ----------------------------- */

async function postCrm(payload) {
  const res = await fetch(CRM_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CRM_WEBHOOK_TOKEN ? { "X-CRM-Token": CRM_WEBHOOK_TOKEN } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`CRM webhook failed (${res.status}): ${text || res.statusText}`);
  }
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export async function crmEndJob({ jobId }) {
  if (!jobId) throw new Error("Missing jobId");
  return postCrm({ tag: "done", job_id: jobId });
}

export async function crmCancelJob({
  jobId,
  worker_gas_fee = false,
  gas_fee_amount_cents = 1500,
}) {
  if (!jobId) throw new Error("Missing jobId");
  return postCrm({
    tag: "cancellation",
    job_id: jobId,
    ...(worker_gas_fee ? { worker_gas_fee: true, gas_fee_amount_cents } : {}),
  });
}


/* ----------------------------- brain API ----------------------------- */

// Single-turn brain call
export async function brainTurn({ sessionId, type, value, uid }) {
  const res = await fetch(`${API_BASE}/brain/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      event_type: type,
      value,
      uid,
    }),
  });
  return handle(res);
}

// Optional: clear server-side session state completely
export async function brainReset({ sessionId }) {
  const res = await fetch(`${API_BASE}/brain/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  return handle(res);
}

/* --------------------------- chat sessions --------------------------- */

export async function createChatSession({ uid = "demo-user-1", seed = null, anon_id = null } = {}) {
  const res = await fetch(`${API_BASE}/v1/chat/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seed, anon_id }),
  });
  return handle(res); // { session_id, status, slots, ... }
}

export async function getChatSession(sessionId) {
  const res = await fetch(`${API_BASE}/v1/chat/sessions/${sessionId}`);
  if (res.status === 404) return null;
  return handle(res); // SessionSnapshot
}

/* ------------------------ account / profile API ---------------------- */

// Token-based account readiness flags
export async function getAccountStatus(getIdToken) {
  const hdrs = await authHeader(getIdToken, null, { required: false });
  const res = await fetch(`${API_BASE}/v1/account/status`, {
    headers: { ...hdrs },
  });
  return handle(res);
}

// One-time customer profile write (requires Bearer token)
export async function customersProfile(getIdToken, payload) {
  const hdrs = await authHeader(getIdToken, null, { required: true });
  const res = await fetch(`${API_BASE}/v1/customers/profile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...hdrs,
    },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

// Read current customer profile + billing status
export async function getCustomerProfile(getIdToken) {
  const hdrs = await authHeader(getIdToken, null, { required: true });
  const res = await fetch(`${API_BASE}/v1/customers/profile`, {
    headers: { ...hdrs },
  });
  return handle(res); // { profile, stripe, payment_on_file, ... }
}

/* ----------------------------- billing API ----------------------------- */

// Create a Stripe SetupIntent; returns { client_secret }
export async function createSetupIntent(getIdToken) {
  const hdrs = await authHeader(getIdToken, null, { required: true });
  const res = await fetch(`${API_BASE}/v1/billing/setup-intent`, {
    method: "POST",
    headers: { ...hdrs },
  });
  return handle(res);
}

// After confirmCardSetup, refresh flags & card meta; returns { ok, status }
export async function billingRefresh(getIdToken) {
  const hdrs = await authHeader(getIdToken, null, { required: true });
  const res = await fetch(`${API_BASE}/v1/billing/refresh`, {
    method: "POST",
    headers: { ...hdrs },
  });
  return handle(res);
}

export { billingRefresh as refreshStripeStatus };

export async function listPaymentMethods(getIdToken, { limit = 10 } = {}) {
  const hdrs = await authHeader(getIdToken, null, { required: true });
  const res = await fetch(`${API_BASE}/v1/billing/payment-methods?limit=${limit}`, {
    headers: { ...hdrs },
  });
  return handle(res);
}

export async function setDefaultPM(getIdToken, payment_method_id) {
  const hdrs = await authHeader(getIdToken, null, { required: true });
  const res = await fetch(`${API_BASE}/v1/billing/default`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...hdrs,
    },
    body: JSON.stringify({ payment_method_id }),
  });
  return handle(res);
}

export async function deletePM(getIdToken, payment_method_id) {
  const hdrs = await authHeader(getIdToken, null, { required: true });
  const res = await fetch(`${API_BASE}/v1/billing/payment-methods/${payment_method_id}`, {
    method: "DELETE",
    headers: { ...hdrs },
  });
  return handle(res);
}

/* ----------------------------- drafts API ---------------------------- */

// Save an anonymous draft so the user can register without losing progress
export async function savePendingDraft({ session_id, anon_id, booking, quote }) {
  const res = await fetch(`${API_BASE}/v1/pending-drafts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id, anon_id, booking, quote }),
  });
  return handle(res);
}

// After sign-in, adopt the draft into customers/{uid}/pending_drafts/{session_id}
export async function claimPendingDraft({ session_id, getIdToken, token }) {
  const hdrs = await authHeader(getIdToken, token, { required: true });
  const res = await fetch(`${API_BASE}/v1/pending-drafts/claim`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...hdrs,
    },
    body: JSON.stringify({ session_id }),
  });
  return handle(res);
}

/* --------------------------- jobs (core) API -------------------------- */

// --- ADD/REPLACE: provisionalJob now forwards coupon_code when provided ---
export async function provisionalJob(payload, getIdToken) {
  // payload shape before: { uid, booking, quote }
  // now also accepts: { coupon_code }  (optional)

  const token = await getIdToken?.();
  if (!token) throw new Error("Not authenticated");

  // preserve your existing idempotency behavior if you already had one
  const idemKey =
    payload?.idempotency_key ||
    (crypto?.randomUUID?.() ?? `idem_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  const body = {
    booking: payload?.booking ?? {},
    quote: payload?.quote ?? {},
    source: "web-chat",
  };

  // ✅ NEW: include coupon_code only when present
  if (payload?.coupon_code) {
    body.coupon_code = String(payload.coupon_code).trim().toUpperCase();
  }

  const res = await fetch(`${API_BASE}/v1/jobs/provisional`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idemKey,
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  // keep using your existing helper if present
  if (!res.ok) {
    let msg;
    try { msg = await res.json(); } catch { msg = await res.text(); }
    throw new Error(typeof msg === "string" ? msg : (msg?.detail || "Request failed"));
  }
  return res.json();
}

// Deterministic quote preview (legacy/global)
export async function quotePreview(booking) {
  const res = await fetch(`${API_BASE}/v1/quote/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(booking),
  });
  return handle(res); // { normalized, quote }
}

// Basic address normalize → includes tz lookup when backend is configured
export async function addressNormalize(address) {
  const res = await fetch(`${API_BASE}/v1/address/normalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  return handle(res); // { formatted_address, lat, lng, timezone_id }
}

// Read past jobs (history stream/pagination)
export async function fetchJobHistory(getIdToken, { limit = 10, page_token } = {}) {
  // 🔒 history requires auth (company is derived from the token)
  const hdrs = await authHeader(getIdToken, null, { required: true });

  const params = new URLSearchParams({ limit: String(limit) });
  if (page_token) params.set("page_token", page_token); // opaque cursor, pass through verbatim

  const res = await fetch(`${API_BASE}/v1/his?${params.toString()}`, {
    headers: { ...hdrs },
  });
  return handle(res); // { items: HistoryItem[], next_page_token }
}

// Partial update of profile (PATCH). Send only fields you want to change.
export async function customersProfilePatch(getIdToken, payload) {
  const hdrs = await authHeader(getIdToken, null, { required: true });
  const res = await fetch(`${API_BASE}/v1/customers/profile`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...hdrs,
    },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

/* ----------------------------- memberships API ----------------------------- */

// Create or initialize a company + membership for the current user
export async function membershipsInit(getIdToken, payload) {
  const hdrs = await authHeader(getIdToken, null, { required: true });

  const res = await fetch(`${API_BASE}/v1/memberships/init`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...hdrs,
    },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

// Invite a teammate (admin-only)
export async function membershipsInvite(getIdToken, payload) {
  const hdrs = await authHeader(getIdToken, null, { required: true });

  const res = await fetch(`${API_BASE}/v1/memberships/invite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...hdrs,
    },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function membershipsAccept(getIdToken, payload) {
  const hdrs = await authHeader(getIdToken, null, { required: true });

  const { invite_id, display_name } = payload || {};
  if (!invite_id) throw new Error("Missing invite_id");
  if (!display_name || !display_name.trim()) throw new Error("Missing display_name");

  const res = await fetch(`${API_BASE}/v1/memberships/accept`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...hdrs,
    },
    body: JSON.stringify({ invite_id, display_name: display_name.trim() }),
  });
  return handle(res);
}

export async function membershipsMe(getIdToken) {
  const hdrs = await authHeader(getIdToken, null, { required: true });
  const res = await fetch(`${API_BASE}/v1/memberships/me`, {
    headers: { ...hdrs },
  });
  return handle(res);
}

// List all users on the caller's company
export async function membershipsMembers(getIdToken) {
  const hdrs = await authHeader(getIdToken, null, { required: true });
  const res = await fetch(`${API_BASE}/v1/memberships/members`, {
    headers: { ...hdrs },
  });
  return handle(res);
}

/* ------------------ bookings (CRM) — edit-with-changelog ------------------ */
/**
 * Update a booking's date & time.
 * Usage (either style works):
 *   await editBookingDateTime("GALC-4577", { date:"2025-01-20", time:"10:00 AM", timeZone:"America/New_York" }, getIdToken)
 *   await editBookingDateTime({ bookingId:"GALC-4577", date:"2025-01-20", time:"10:00 AM", timeZone:"America/New_York", getIdToken })
 */
export async function editBookingDateTime(arg1, arg2, maybeGetIdToken) {
  // Signature flexibility
  let bookingId, date, time, timeZone, getIdToken, token;
  if (typeof arg1 === "string") {
    bookingId = arg1;
    ({ date, time, timeZone, token } = arg2 || {});
    getIdToken = maybeGetIdToken;
  } else {
    ({ bookingId, date, time, timeZone, getIdToken, token } = arg1 || {});
  }

  if (!bookingId) throw new Error("editBookingDateTime: missing bookingId");
  if (!date || !time || !timeZone) throw new Error("editBookingDateTime: missing date/time/timeZone");

  const iso = localWallTimeToUtcISO(date, time, timeZone);
  const hdrs = await authHeader(getIdToken, token, { required: false });

  const res = await fetch(
    `${CRM_API_BASE}/api/bookings/${encodeURIComponent(bookingId)}/edit-with-changelog`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...hdrs,
      },
      body: JSON.stringify({
        mergedBooking: {
          job_details: {
            job_date: date,
            job_time: time,
            job_start_timestamp: iso,
            job_start_iso: iso,
            timezone: timeZone,
          },
        },
      }),
    }
  );
  return handle(res);
}

/**
 * Update a booking's service address.
 * Usage:
 *   await editBookingAddress("GALC-4577", {
 *     street:"456 Oak Avenue", city:"Brooklyn", state:"NY", postal_code:"11201", country:"United States",
 *     geo_coords:{ lat:40.6892, lng:-73.9442 }
 *   }, getIdToken)
 *   // or:
 *   await editBookingAddress({ bookingId:"GALC-4577", address:{...}, getIdToken })
 */
export async function editBookingAddress(arg1, arg2, maybeGetIdToken) {
  let bookingId, address, getIdToken, token;
  if (typeof arg1 === "string") {
    bookingId = arg1;
    address = arg2 || {};
    getIdToken = maybeGetIdToken;
  } else {
    ({ bookingId, address, getIdToken, token } = arg1 || {});
  }

  if (!bookingId) throw new Error("editBookingAddress: missing bookingId");
  if (!address || !address.street || !address.city || !address.state || !address.postal_code) {
    throw new Error("editBookingAddress: require street, city, state, postal_code");
  }

  const hdrs = await authHeader(getIdToken, token, { required: false });

  const res = await fetch(
    `${CRM_API_BASE}/api/bookings/${encodeURIComponent(bookingId)}/edit-with-changelog`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...hdrs,
      },
      body: JSON.stringify({
        mergedBooking: {
          job_details: {
            address: {
              street: address.street.trim(),
              city: address.city.trim(),
              state: address.state.trim(),
              postal_code: address.postal_code.trim(),
              country: (address.country || "United States").trim(),
              ...(address.geo_coords ? { geo_coords: address.geo_coords } : {}),
              ...(address.address_line ? { address_line: address.address_line } : {}),
            },
          },
        },
      }),
    }
  );
  return handle(res);
}

/**
 * Update the booking's on-site phone number.
 * NOTE: This is *stored* under client_info.phone_number, but represents the job's on-site phone.
 * Usage:
 *   await editBookingOnsitePhone("GALC-4577", { phoneNumber: "(231) 231-2313" }, getIdToken)
 *   // or:
 *   await editBookingOnsitePhone({ bookingId:"GALC-4577", phoneNumber:"231-231-2313", getIdToken })
 */
function normalizeUsPhone(input) {
  const digits = String(input || "").replace(/[^\d]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits; // already 1 + 10
  if (digits.length === 10) return "1" + digits;                      // add leading 1
  // Gracefully accept +1XXXXXXXXXX as well (already covered by stripping non-digits)
  throw new Error("Invalid US phone number");
}

export async function editBookingOnsitePhone(arg1, arg2, maybeGetIdToken) {
  let bookingId, phoneNumber, getIdToken, token;
  if (typeof arg1 === "string") {
    bookingId = arg1;
    ({ phoneNumber } = arg2 || {});
    getIdToken = maybeGetIdToken;
  } else {
    ({ bookingId, phoneNumber, getIdToken, token } = arg1 || {});
  }

  if (!bookingId) throw new Error("editBookingOnsitePhone: missing bookingId");
  if (!phoneNumber) throw new Error("editBookingOnsitePhone: missing phoneNumber");

  const normalized = normalizeUsPhone(phoneNumber);
  const hdrs = await authHeader(getIdToken, token, { required: false });

  const res = await fetch(
    `${CRM_API_BASE}/api/bookings/${encodeURIComponent(bookingId)}/edit-with-changelog`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...hdrs,
      },
      body: JSON.stringify({
        mergedBooking: {
          client_info: {
            phone_number: normalized,
          },
        },
      }),
    }
  );
  return handle(res);
}

/* ----------------------- jobs (preview/save editors) ----------------------- */
/**
 * Preview the quote impact of a partial job update.
 * Backend: POST /v1/jobs/{job_id}/preview-quote
 * Body should be the **patch itself** at the root (e.g. `{ "workers": 3 }`).
 * Returns: { booking_preview, quote_preview, current_total, delta_total, changed }
 */
export async function previewJobQuote(arg1, arg2, maybeGetIdToken) {
  let jobId, patch, getIdToken, token;
  if (typeof arg1 === "string") {
    jobId = arg1;
    patch = arg2 || {};
    getIdToken = maybeGetIdToken;
  } else {
    ({ jobId, patch, getIdToken, token } = arg1 || {});
  }

  if (!jobId) throw new Error("previewJobQuote: missing jobId");
  if (!patch || typeof patch !== "object") throw new Error("previewJobQuote: missing patch");

  // 🔒 Preview requires auth. If token is missing, fail loudly so UI doesn't display stale numbers.
  const hdrs = await authHeader(getIdToken, token, { required: true });

  const res = await fetch(`${API_BASE}/v1/jobs/${encodeURIComponent(jobId)}/preview-quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...hdrs,
    },
    // ✅ send patch at root
    body: JSON.stringify(patch),
  });
  return handle(res);
}

/**
 * Persist a partial job update (workers, duration_hours, notes, etc.)
 * Backend: PATCH /v1/jobs/{job_id}
 * Body should be the **patch itself** at the root (e.g. `{ "notes": "Gate code 1234" }`).
 * Returns: JobOut (authoritative job snapshot incl. booking + quote)
 */
export async function editJob(arg1, arg2, maybeGetIdToken) {
  let jobId, patch, getIdToken, token;
  if (typeof arg1 === "string") {
    jobId = arg1;
    patch = arg2 || {};
    getIdToken = maybeGetIdToken;
  } else {
    ({ jobId, patch, getIdToken, token } = arg1 || {});
  }

  if (!jobId) throw new Error("editJob: missing jobId");
  if (!patch || typeof patch !== "object") throw new Error("editJob: missing patch");

  // 🔒 Save requires auth + idempotency.
  const hdrs = await authHeader(getIdToken, token, { required: true });

  const res = await fetch(`${API_BASE}/v1/jobs/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...hdrs,
      "Idempotency-Key": newIdemKey(),
    },
    // ✅ send patch at root
    body: JSON.stringify(patch),
  });
  return handle(res); // JobOut
}

/* --------- thin convenience wrappers used by RightRail popups ---------- */
export async function editJobWorkers(arg1, arg2, maybeGetIdToken) {
  let jobId, workers, getIdToken, token;
  if (typeof arg1 === "string") {
    jobId = arg1;
    workers = arg2;
    getIdToken = maybeGetIdToken;
  } else {
    ({ jobId, workers, getIdToken, token } = arg1 || {});
  }
  if (!jobId) throw new Error("editJobWorkers: missing jobId");
  if (typeof workers !== "number" || workers < 1 || workers > 10) {
    throw new Error("editJobWorkers: workers must be 1–10");
  }
  return editJob({ jobId, patch: { workers }, getIdToken, token });
}

export async function editJobDuration(arg1, arg2, maybeGetIdToken) {
  let jobId, duration_hours, getIdToken, token;
  if (typeof arg1 === "string") {
    jobId = arg1;
    duration_hours = arg2;
    getIdToken = maybeGetIdToken;
  } else {
    ({ jobId, duration_hours, getIdToken, token } = arg1 || {});
  }
  if (!jobId) throw new Error("editJobDuration: missing jobId");
  if (![2, 5, 8].includes(Number(duration_hours))) {
    throw new Error("editJobDuration: duration_hours must be one of 2, 5, 8");
  }
  return editJob({ jobId, patch: { duration_hours }, getIdToken, token });
}

export async function editJobNotes(arg1, arg2, maybeGetIdToken) {
  let jobId, notes, getIdToken, token;
  if (typeof arg1 === "string") {
    jobId = arg1;
    notes = arg2;
    getIdToken = maybeGetIdToken;
  } else {
    ({ jobId, notes, getIdToken, token } = arg1 || {});
  }
  if (!jobId) throw new Error("editJobNotes: missing jobId");
  const trimmed = String(notes ?? "").slice(0, 150);
  return editJob({ jobId, patch: { notes: trimmed }, getIdToken, token });
}

export async function previewJobWorkers(arg1, arg2, maybeGetIdToken) {
  let jobId, workers, getIdToken, token;
  if (typeof arg1 === "string") {
    jobId = arg1;
    workers = arg2;
    getIdToken = maybeGetIdToken;
  } else {
    ({ jobId, workers, getIdToken, token } = arg1 || {});
  }
  if (!jobId) throw new Error("previewJobWorkers: missing jobId");
  if (typeof workers !== "number" || workers < 1 || workers > 10) {
    throw new Error("previewJobWorkers: workers must be 1–10");
  }
  return previewJobQuote({ jobId, patch: { workers }, getIdToken, token });
}

export async function previewJobDuration(arg1, arg2, maybeGetIdToken) {
  let jobId, duration_hours, getIdToken, token;
  if (typeof arg1 === "string") {
    jobId = arg1;
    duration_hours = arg2;
    getIdToken = maybeGetIdToken;
  } else {
    ({ jobId, duration_hours, getIdToken, token } = arg1 || {});
  }
  if (!jobId) throw new Error("previewJobDuration: missing jobId");
  if (![2, 5, 8].includes(Number(duration_hours))) {
    throw new Error("previewJobDuration: duration_hours must be one of 2, 5, 8");
  }
  return previewJobQuote({ jobId, patch: { duration_hours }, getIdToken, token });
}

export async function previewJobNotes(arg1, arg2, maybeGetIdToken) {
  let jobId, notes, getIdToken, token;
  if (typeof arg1 === "string") {
    jobId = arg1;
    notes = arg2;
    getIdToken = maybeGetIdToken;
  } else {
    ({ jobId, notes, getIdToken, token } = arg1 || {});
  }
  if (!jobId) throw new Error("previewJobNotes: missing jobId");
  const trimmed = String(notes ?? "").slice(0, 150);
  return previewJobQuote({ jobId, patch: { notes: trimmed }, getIdToken, token });
}

/* ----------------------------- coupons API ----------------------------- */
/**
 * Preview a coupon against the current booking.
 * Backend: POST /v1/coupons/preview
 * Body: { code, booking }
 * Returns: CouponPreviewOut { ok, reason?, code?, discount_cents, quote_preview? }
 */
export async function couponsPreview({ booking, code, getIdToken, token }) {
  if (!booking) throw new Error("couponsPreview: missing booking");
  if (!code) throw new Error("couponsPreview: missing code");

  // Send Authorization so backend can resolve customer_id
  const hdrs = await authHeader(getIdToken, token, { required: false });

  const res = await fetch(`${API_BASE}/v1/coupons/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...hdrs,
    },
    body: JSON.stringify({ code, booking }),
  });
  return handle(res);
}

export async function authSmsSendCode({ phone }) {
  const res = await fetch(`${AUTH_API_BASE}/auth/sms/send-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  return handle(res);
}

export async function authSmsVerifyCode({ phone, code }) {
  const res = await fetch(`${AUTH_API_BASE}/auth/sms/verify-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code }),
  });
  return handle(res);
}

export async function membershipsSetRole(getIdToken, { uid, role }) {
  if (!uid || !role) throw new Error("membershipsSetRole: uid and role required");
  const token = await getIdToken();
  const res = await fetch(`${API_BASE}/v1/memberships/${encodeURIComponent(uid)}/role`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role }),
  });
  return handle(res); // return { ok: true, uid, role }
}

export async function billingValidateCard(getIdToken, body) {
  const hdrs = await authHeader(getIdToken, null, { required: true });

  const res = await fetch(`${API_BASE}/v1/billing/validate-card`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...hdrs,
    },
    body: JSON.stringify(body),
  });

  let data = {};
  try { data = await res.json(); } catch {}

  if (!res.ok) {
    const detail = data?.detail || data || {};
    const err = new Error(detail?.message || "Card not accepted.");
    err.code = detail?.code;
    err.funding = detail?.funding;
    err.status = res.status;
    throw err;
  }

  return data;
}