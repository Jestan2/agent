// src/components/RightRail.jsx
import { useMemo, useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLoadScript } from "@react-google-maps/api";
import { useAuth } from "../context/AuthContext";
import { crmEndJob, crmCancelJob } from "../lib/api";

/* ---------------------- API: preview + save editors ---------------------- */
import {
  previewJobWorkers,
  previewJobDuration,
  previewJobNotes,
  editJobWorkers,
  editJobDuration,
  editJobNotes,
  couponsPreview, // ← NEW
} from "../lib/api";

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

// $ currency
function money(n) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

// Turn API errors (objects or JSON strings) into a human message
function humanizeApiError(err) {
  if (!err) return null;

  // If we got the whole error object
  if (typeof err === "object") {
    return err.detail || err.message || JSON.stringify(err);
  }

  // If we got a string (possibly JSON like `{"detail":"..."}"`)
  if (typeof err === "string") {
    try {
      const parsed = JSON.parse(err);
      if (parsed && typeof parsed === "object") {
        return parsed.detail || parsed.message || err;
      }
    } catch {
      // not JSON, just return it
    }
    return err;
  }

  return String(err);
}

// --- Always render a minimal, clean Cost Breakdown ---
function condenseItems(rows = [], ctx = {}) {
  let labor = 0,
    bg = 0,
    processing = 0,
    tools = 0,
    discount = 0; // ← NEW

  for (const r of rows) {
    const label = String(r?.label || "").toLowerCase();
    const amt = Number(r?.amount ?? 0) || 0;

    if (label.includes("worker") || label.includes("labor")) {
      labor += amt;
    } else if (label.includes("background")) {
      bg += amt;
    } else if (label.includes("processing")) {
      processing += amt;
    } else if (label.includes("tool")) {
      tools += amt;
    } else if (label.includes("discount") || amt < 0) {
      discount += amt; // keep negative
    }
  }

  const out = [];
  if (labor > 0) out.push({ label: "Labor Cost", amount: labor });
  if (bg > 0) out.push({ label: "Background Check Fee", amount: bg });

  const extraProcessing = Number(ctx?.processingFeeAmount ?? 0) || 0;
  if (processing > 0) {
    out.push({ label: "Processing Fee", amount: processing });
  } else if (extraProcessing > 0) {
    out.push({ label: "Processing Fee", amount: extraProcessing });
  }

  if (ctx.includeToolsFromQuote && tools > 0) {
    out.push({ label: "Tools Cost", amount: tools });
  }

  if (ctx.shouldAddTools100) {
    out.push({ label: "Tools Cost", amount: 100 });
  }

  if (discount !== 0) {
    out.push({ label: "Discount", amount: discount }); // negative number shown as −$
  }

  return out;
}

/* ------------------------------ Time helpers ------------------------------ */
function pad(n) {
  return String(n).padStart(2, "0");
}
function formatHumanTime(hh, mm) {
  const d = new Date(0, 0, 0, hh, mm);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function buildMonthMatrix(base) {
  const first = new Date(base.getFullYear(), base.getMonth(), 1);
  const startDay = first.getDay();
  const grid = [];
  let current = new Date(first);
  current.setDate(current.getDate() - startDay);
  for (let wk = 0; wk < 6; wk++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      row.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    grid.push(row);
  }
  return grid;
}
function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function nextBookableHourToday(now = new Date()) {
  const n = new Date(now);
  if (n.getMinutes() > 0 || n.getSeconds() > 0 || n.getMilliseconds() > 0) {
    n.setHours(n.getHours() + 1, 0, 0, 0);
  } else {
    n.setMinutes(0, 0, 0, 0);
  }
  n.setHours(n.getHours() + 1);
  return n.getHours();
}

// Parse "8:00 AM" | "08:00" → "HH:mm" (24h)
function toHHmm(val) {
  if (!val) return null;
  const s = String(val).trim();
  const ampm = s.match(/am|pm/i);
  if (ampm) {
    const m = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ap = m[3].toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return `${pad(h)}:${pad(mm)}`;
  }
  // assume "HH:mm"
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(mm)) return null;
  return `${pad(h)}:${pad(mm)}`;
}

// "HH:mm" → "h:mm AM/PM"
function hhmmToAmPm(hhmm) {
  if (!hhmm) return null;
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const ap = h >= 12 ? "PM" : "AM";
  const disp = h % 12 === 0 ? 12 : h % 12;
  return `${disp}:${pad(m)} ${ap}`;
}

/* ------------------------------ Phone helpers ----------------------------- */
function onlyDigits(s = "") {
  return String(s).replace(/\D/g, "");
}
function toE164US(input) {
  const d = onlyDigits(input);
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return null;
}
function prettyUS(input) {
  const d = onlyDigits(input).slice(-11);
  const dd = d.startsWith("1") && d.length === 11 ? d.slice(1) : d;
  const a = dd.slice(0, 3);
  const b = dd.slice(3, 6);
  const c = dd.slice(6, 10);
  if (dd.length <= 3) return a;
  if (dd.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}
function e164ToPretty(e164) {
  if (!e164) return "";
  const d = onlyDigits(e164);
  const dd = d.startsWith("1") ? d.slice(1) : d;
  return prettyUS(dd);
}

/* ------------------------------ Format helpers ---------------------------- */
// booking-mode formatter (existing)
function formatWhen(s) {
  if (!s) return null;
  const tz = s.timezone_id || undefined;

  if (s.start_at_utc) {
    const d = new Date(s.start_at_utc);
    const dateStr = d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: tz,
    });
    const timeStr = d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });
    return `${dateStr} @ ${timeStr}`;
  }

  if (s.date && s.start_time) {
    const d = new Date(`${s.date}T00:00:00`);
    const dateStr = d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    const [hh, mm] = String(s.start_time)
      .split(":")
      .map((x) => parseInt(x || "0", 10));
    const t = new Date(0, 0, 0, isNaN(hh) ? 0 : hh, isNaN(mm) ? 0 : mm);
    const timeStr = t.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    return `${dateStr} @ ${timeStr}`;
  }

  if (s.date) {
    try {
      const d = new Date(`${s.date}T00:00:00`);
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    } catch {
      return s.date;
    }
  }

  if (s.start_time) {
    const [hh, mm] = String(s.start_time)
      .split(":")
      .map((x) => parseInt(x || "0", 10));
    const d = new Date(0, 0, 0, isNaN(hh) ? 0 : hh, isNaN(mm) ? 0 : mm);
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return null;
}

// job-mode "when" (keeps "8:00 AM" text)
function formatWhenJob(jd) {
  if (!jd) return null;
  const { job_date, job_time } = jd;

  let dateStr = null;
  if (job_date) {
    try {
      const d = new Date(`${job_date}T00:00:00`);
      if (!Number.isNaN(d.getTime())) {
        dateStr = d.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
      } else {
        dateStr = job_date;
      }
    } catch {
      dateStr = job_date;
    }
  }

  if (dateStr && job_time) return `${dateStr} @ ${job_time}`;
  if (dateStr) return dateStr;
  if (job_time) return job_time;
  return null;
}

// truncate
function short(text, max) {
  if (!text) return null;
  const t = String(text).trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) + "…" : t;
}

// (123) 456-7890
function formatPhone(raw) {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, "");
  const ten =
    d.length === 11 && d.startsWith("1")
      ? d.slice(1)
      : d.length === 10
      ? d
      : null;
  if (!ten) return null;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/* --------------------------------- Icons ---------------------------------- */
function PencilIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      {...props}
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}
function LockedIcon() {
  return (
    <span
      className="p-1 rounded-md border border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed"
      title="Service can’t be edited"
      aria-label="Service can’t be edited"
    >
      <svg
        viewBox="0 0 24 24"
        className="w-4 h-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M7 10V7a5 5 0 0 1 10 0v3" />
        <rect x="5" y="10" width="14" height="10" rx="2" />
      </svg>
    </span>
  );
}

/* ------------------------------- UI Atoms --------------------------------- */
function Line({
  label,
  amount,
  children,
  action,
  instant = false,
  variant = "slide",
  layoutOn = true,
}) {
  const initial = instant
    ? false
    : variant === "fadeScale"
    ? { opacity: 0, scale: 0.98 }
    : { opacity: 0, y: 6 };
  const animate =
    variant === "fadeScale" ? { opacity: 1, scale: 1 } : { opacity: 1, y: 0 };
  const exit = instant
    ? undefined
    : variant === "fadeScale"
    ? { opacity: 0, scale: 0.98 }
    : { opacity: 0, y: -6 };

  return (
    <motion.div
      layout={layoutOn ? "position" : false}
      initial={initial}
      animate={animate}
      exit={exit}
      transition={{ duration: 0.16 }}
      className="flex items-center justify-between text-[14px]"
    >
      <span className="text-gray-600">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-medium text-[#04193b]">
          {children !== undefined ? children : money(amount)}
        </span>
        {action}
      </div>
    </motion.div>
  );
}

/* ----------------------------- Coupon Card UI ----------------------------- */
function CouponCard({
  canCoupon,
  appliedCoupon,
  couponInput,
  couponLoading,
  couponError,
  couponSuccess,
  couponDiscountCents,
  onChange,
  onApply,
  onRemove,
}) {
  if (!canCoupon) return null;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[13px] font-semibold text-[#04193b]">Coupon</div>
        {appliedCoupon ? (
          <button
            onClick={onRemove}
            className="text-xs text-red-600 hover:underline"
            title="Remove coupon"
          >
            Remove
          </button>
        ) : null}
      </div>

      {!appliedCoupon ? (
        <div className="flex gap-2 items-stretch w-full">
          <input
            /* allow shrinking so the row never overflows */
            className="flex-1 min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-[#04193b]/10 uppercase"
            /* (keep your other props the same) */
            type="text"
            inputMode="text"
            placeholder="WELCOME20"
            value={couponInput}
            onChange={(e) => onChange(e.target.value)}
            maxLength={24}
          />
          <button
            onClick={onApply}
            disabled={!couponInput.trim() || couponLoading}
            className={[
              // don’t let the button shrink; keep text on one line; reserve enough width
              "shrink-0 whitespace-nowrap min-w-[96px] px-4 py-2 rounded-xl text-sm transition-colors",
              !couponInput.trim() || couponLoading
                ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                : "bg-[#04193b] text-white hover:opacity-90",
            ].join(" ")}
            aria-busy={couponLoading ? "true" : "false"}
          >
            {couponLoading ? "Checking…" : "Apply"}
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="text-sm">
            <span className="text-gray-500">Applied:</span>{" "}
            <span className="font-semibold tracking-wide">{appliedCoupon}</span>
          </div>
        </div>
      )}

    {couponError ? (
      <div className="mt-2 text-sm text-red-600" aria-live="polite">{couponError}</div>
    ) : null}
    {!couponError && couponSuccess ? (
      <div className="mt-2 text-sm text-green-600" aria-live="polite">{couponSuccess}</div>
    ) : null}
    </div>
  );
}

/* ----------------------- Skeleton / Placeholder UI ------------------------ */
function SkelBar({ className = "" }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className}`} />;
}
function SkelLine() {
  return (
    <div className="flex items-center justify-between text-[14px] py-[2px]">
      <SkelBar className="h-3 w-24" />
      <SkelBar className="h-4 w-28" />
    </div>
  );
}
function SkeletonDetailsCard() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2" aria-busy="true">
      <SkelLine />
      <SkelLine />
      <SkelLine />
      <SkelLine />
      <SkelLine />
      <SkelLine />
      <SkelLine />
    </div>
  );
}
function SkeletonCostCard() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4" aria-busy="true">
      <div className="mb-3">
        <SkelBar className="h-3 w-28" />
      </div>
      <div className="space-y-2">
        <SkelLine />
        <SkelLine />
        <SkelLine />
      </div>
      <div className="my-3 border-t border-dashed border-gray-200" />
      <div className="flex items-center justify-between">
        <SkelBar className="h-3 w-16" />
        <SkelBar className="h-5 w-24" />
      </div>
    </div>
  );
}
function SkeletonBookButton() {
  return (
    <div className="pt-0">
      <div className="w-full h-11 rounded-xl animate-pulse bg-gray-200" aria-busy="true" />
    </div>
  );
}
function SkeletonRightRailDesktop({ jobMode }) {
  return (
    <div className="w-[360px] max-w-[360px] p-4 space-y-6">
      <div className="flex items-center justify-between">
        <SkelBar className="h-5 w-36" />
      </div>
      <SkeletonDetailsCard />
      <SkeletonCostCard />
      {!jobMode && <SkeletonBookButton />}
    </div>
  );
}
function SkeletonBottomSheet() {
  return (
    <div className="px-4 pb-4 max-h-[60vh] overflow-y-auto">
      <SkeletonDetailsCard />
      <div className="mt-4" />
      <SkeletonCostCard />
      <div className="mt-4">
        <div className="w-full h-11 rounded-xl animate-pulse bg-gray-200" aria-busy="true" />
      </div>
    </div>
  );
}

/* ------------------------- Modal (clean centered) ------------------------- */
function EditorModal({ open, title, onClose, children, wide = false }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[70] bg-black/35 backdrop-blur-[1.5px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-0 z-[71] p-4 sm:p-6 flex items-center justify-center"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.18 }}
            aria-modal="true"
            role="dialog"
          >
            <div
              className="w-full bg-white rounded-2xl border border-gray-200 shadow-2xl overflow-hidden"
              style={{ maxWidth: wide ? 860 : 640 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                <h3 className="text-[18px] sm:text-[19px] font-semibold text-[#04193b]">
                  {title}
                </h3>
                <button
                  onClick={onClose}
                  className="p-2.5 rounded-md hover:bg-gray-100"
                  aria-label="Close"
                  title="Close"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="w-5 h-5"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="none"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <div className="p-5 sm:p-6 text-[15.5px] sm:text[16px] leading-[1.65] text-gray-800">
                {children}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ---------------------- Editors (Chat parity) ----------------------------- */
// 1) CalendarTimePicker
function CalendarTimePicker({
  onPickDateAndTime,
  onCancel,
  preselectedDate,
  preselectedTime,
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [step, setStep] = useState("date");
  const [selectedDate, setSelectedDate] = useState(null);

  useEffect(() => {
    if (!preselectedDate) return;
    const [yyyy, mm, dd] = String(preselectedDate).split("-");
    if (yyyy && mm && dd) {
      const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
      d.setHours(0, 0, 0, 0);
      setSelectedDate(d);
      setStep("time");
      setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  }, [preselectedDate]);

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  const grid = useMemo(() => buildMonthMatrix(month), [month]);

  const times = useMemo(() => {
    const END_HOUR = 22;
    let startHour = 7;

    if (selectedDate) {
      const todayMid = new Date();
      todayMid.setHours(0, 0, 0, 0);
      const selMid = new Date(selectedDate);
      selMid.setHours(0, 0, 0, 0);
      const isToday = selMid.getTime() === todayMid.getTime();
      if (isToday) {
        startHour = Math.max(nextBookableHourToday(new Date()), 7);
      }
    }

    if (startHour > END_HOUR) return [];
    const slots = [];
    for (let h = startHour; h <= END_HOUR; h++) {
      slots.push({ h, m: 0, label: formatHumanTime(h, 0) });
    }
    return slots;
  }, [selectedDate]);

  const canGoPrev = useMemo(() => {
    const prev = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    const lastDayPrev = new Date(prev.getFullYear(), prev.getMonth() + 1, 0);
    return lastDayPrev >= today;
  }, [month, today]);

  const selectDate = useCallback(
    (d) => {
      if (d < today) return;
      setSelectedDate(d);
      setStep("time");
    },
    [today]
  );

  const selectTime = useCallback(
    (h, m) => {
      if (!selectedDate) return;
      const yyyy = selectedDate.getFullYear();
      const mm = pad(selectedDate.getMonth() + 1);
      const dd = pad(selectedDate.getDate());
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const timeStr = `${pad(h)}:${pad(m)}`;
      onPickDateAndTime(dateStr, timeStr);
    },
    [onPickDateAndTime, selectedDate]
  );

  return (
    <div className="w-full flex justify-start">
      <div className="max-w-[760px] w-full">
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2">
            {/* Left: Calendar */}
            <div className="p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <button
                  className="px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
                  onClick={() =>
                    setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
                  }
                  disabled={!canGoPrev}
                >
                  ‹
                </button>
                <div className="font-semibold text-[#04193b]">
                  {month.toLocaleString(undefined, { month: "long", year: "numeric" })}
                </div>
                <button
                  className="px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50"
                  onClick={() =>
                    setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
                  }
                >
                  ›
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 text-xs text-gray-500 mb-1">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <div key={d} className="text-center py-1">
                    {d}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {grid.flat().map((d, idx) => {
                  const disabled = d < today;
                  const isThisMonth = d.getMonth() === month.getMonth();
                  const active = selectedDate && isSameDay(d, selectedDate);
                  return (
                    <button
                      key={idx}
                      onClick={() => !disabled && selectDate(new Date(d))}
                      className={[
                        "h-10 rounded-lg text-sm transition-all",
                        active
                          ? "bg-[#04193b] text-white"
                          : disabled
                          ? "text-gray-300 cursor-not-allowed"
                          : isThisMonth
                          ? "text-[#04193b] hover:bg-gray-100"
                          : "text-gray-400 hover:bg-gray-100",
                      ].join(" ")}
                    >
                      {d.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right: Time list */}
            <div className="p-4 sm:p-6 border-t sm:border-t-0 sm:border-l border-gray-200">
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={selectedDate ? "pick-time" : "pick-date"}
                  initial={{ x: 20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: -20, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className={selectedDate ? "space-y-3" : ""}
                >
                  {!selectedDate ? (
                    <div className="text-sm text-gray-600">
                      Pick a date to see available times.
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-600">
                          {selectedDate?.toLocaleDateString(undefined, {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                          })}
                        </div>
                        <button
                          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
                          onClick={() => setStep("date")}
                        >
                          Change date
                        </button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {times.map(({ h, m, label }) => (
                          <button
                            key={`${h}-${m}`}
                            onClick={() => selectTime(h, m)}
                            className={[
                              "w-full h-12 rounded-xl border bg-white font-medium transition-all",
                              "border-gray-200 hover:border-[#04193b] hover:shadow-sm",
                            ].join(" ")}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>

              <div className="mt-6">
                <button
                  onClick={onCancel}
                  className="text-sm px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 2) Text field picker (used for Notes save-through-API)
function TextFieldPicker({
  label,
  placeholder,
  maxLen,
  initial = "",
  onSet,
  onCancel,
  saving = false,
  disabled = false,
}) {
  const [val, setVal] = useState(initial || "");
  const remaining = maxLen - val.length;

  return (
    <div className="max-w-[760px] w-full">
      <div className="space-y-3">
        {label ? (
          <div className="text-[13px] text-gray-600">{label}</div>
        ) : null}
        <input
          type="text"
          maxLength={maxLen}
          placeholder={placeholder}
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 outline-none focus:ring-2 focus:ring-[#04193b]/10"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          disabled={disabled}
        />
        <div className="text-xs text-gray-500">{remaining} characters left</div>
        <div className="flex gap-2">
          <button
            disabled={!val.trim() || saving || disabled}
            onClick={() => val.trim() && onSet?.(val.trim())}
            className={[
              "rounded-xl px-4 py-2 border border-transparent text-sm",
              !val.trim() || saving || disabled
                ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                : "bg-[#04193b] text-white hover:opacity-90",
            ].join(" ")}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={onCancel}
            className="rounded-xl px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// 3) Phone picker (kept UI; parent handles persistence)
function OnsitePhonePicker({ initial, onSet, onCancel }) {
  const [val, setVal] = useState(e164ToPretty(initial || ""));
  const [touched, setTouched] = useState(false);
  const e164 = toE164US(val);
  const valid = Boolean(e164);

  return (
    <div className="max-w-[760px] w-full">
      <div className="space-y-3">
        <input
          type="tel"
          inputMode="tel"
          placeholder="(555) 123-4567"
          className={[
            "w-full rounded-xl border bg-white px-3 py-3 outline-none focus:ring-2 focus:ring-[#04193b]/10",
            touched && !valid ? "border-red-300" : "border-gray-200",
          ].join(" ")}
          value={val}
          onChange={(e) => setVal(prettyUS(e.target.value))}
          onBlur={() => setTouched(true)}
        />
        <div className="text-xs">
          {!touched || valid ? (
            <span className="text-gray-500">US numbers only</span>
          ) : (
            <span className="text-red-600">Enter a valid US phone number.</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            disabled={!valid}
            onClick={() => valid && onSet?.(e164)}
            className={[
              "rounded-xl px-4 py-2 border border-transparent text-sm",
              valid
                ? "bg-[#04193b] text-white hover:opacity-90"
                : "bg-gray-200 text-gray-500 cursor-not-allowed",
            ].join(" ")}
          >
            Set
          </button>
          <button
            onClick={onCancel}
            className="rounded-xl px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* 4) Address picker (kept; parent handles persistence) */
function GooglePlacesAddressInput({ initialValue, onChangeText, onPlaceSelected }) {
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: ["places"],
  });
  const [mounted, setMounted] = useState(false);
  const inputId = "address-autocomplete-input-right-rail";

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || !isLoaded || !window.google) return;
    const input = document.getElementById(inputId);
    if (!input) return;

    const ac = new window.google.maps.places.Autocomplete(input, {
      types: ["address"],
      fields: ["address_components", "formatted_address"],
      componentRestrictions: { country: "us" },
    });

    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      const formatted = place?.formatted_address || "";
      const comps = place?.address_components || [];
      const country = comps.find((c) => c.types?.includes("country"))?.short_name;
      if (country !== "US") {
        input.value = "";
        input.placeholder = "US addresses only";
        onChangeText?.("");
        return;
      }
      input.value = formatted;
      onChangeText?.(formatted);
      onPlaceSelected?.(formatted, comps);
    });
  }, [mounted, isLoaded]);

  // Keep raw input in sync if initialValue changes
  useEffect(() => {
    const input = document.getElementById(inputId);
    if (input && typeof initialValue === "string") {
      input.value = initialValue;
    }
  }, [initialValue]);

  return (
    <>
      <input
        id={inputId}
        defaultValue={initialValue}
        onInput={(e) => onChangeText?.(e.target.value)}
        placeholder="123 Main St, City, ST 12345"
        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 outline-none focus:ring-2 focus:ring-[#04193b]/10"
      />
      {loadError && (
        <div className="text-sm text-red-600 mt-2">
          Couldn’t load Google Places. Check your API key.
        </div>
      )}
    </>
  );
}

function AddressPicker({ initial, onSet, onCancel, flat = false }) {
  const [val, setVal] = useState(initial || "");
  useEffect(() => setVal(initial || ""), [initial]);

  if (flat) {
    return (
      <div className="max-w-[760px] w-full">
        <div className="space-y-3">
          <GooglePlacesAddressInput
            initialValue={val}
            onChangeText={setVal}
            onPlaceSelected={(formatted, comps) => {
              const country = comps?.find((c) => c.types?.includes("country"))?.short_name;
              if (country !== "US") {
                setVal("");
                return;
              }
              setVal(formatted);
            }}
          />
          <div className="flex gap-2">
            <button
              onClick={() => val.trim() && onSet?.(val.trim())}
              className="rounded-xl px-4 py-2 border border-transparent bg-[#04193b] text-white hover:opacity-90 text-sm"
            >
              Set
            </button>
            <button
              onClick={onCancel}
              className="rounded-xl px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex justify-start">
      <div className="max-w-[760px] w-full">
        <div className="bg-white rounded-2xl px-4 py-4 sm:px-5 sm:py-5 text-[15px] leading-relaxed border border-gray-200 shadow-sm">
          <div className="font-medium mb-2">Enter address</div>
          <GooglePlacesAddressInput
            initialValue={val}
            onChangeText={setVal}
            onPlaceSelected={(formatted, comps) => {
              const country = comps?.find((c) => c.types?.includes("country"))?.short_name;
              if (country !== "US") {
                setVal("");
                return;
              }
              setVal(formatted);
            }}
          />
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => val.trim() && onSet?.(val.trim())}
              className="rounded-xl px-4 py-2 border border-transparent bg-[#04193b] text-white hover:opacity-90 text-sm"
            >
              Set
            </button>
            <button
              onClick={onCancel}
              className="rounded-xl px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Price-impact editor (Workers/Duration) ------------------ */
function PricePreviewBlock({ loading, error, currentTotal, previewTotal, delta }) {
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  const abs = Math.abs(delta || 0);
  return (
    <div className="mt-4 rounded-xl border border-gray-200 p-3 sm:p-4 bg-white">
      {loading ? (
        <div className="text-sm text-gray-600">Calculating…</div>
      ) : error ? (
        <div className="text-sm text-red-600">{String(error)}</div>
      ) : (
        <>
          {/* Totals row */}
          <div className="flex items-center justify-between">
            <div className="flex-1 text-left">
              <div className="text-xs text-gray-500">Current</div>
              <motion.div
                key={currentTotal ?? "—"}
                initial={{ opacity: 0.8 }}
                animate={{ opacity: 1 }}
                className="text-[20px] font-semibold text-[#04193b]"
              >
                {currentTotal == null ? "—" : money(currentTotal)}
              </motion.div>
            </div>
            <div className="mx-3 text-gray-400">→</div>
            <div className="flex-1 text-right">
              <div className="text-xs text-gray-500">New</div>
              <motion.div
                key={previewTotal ?? "—"}
                initial={{ opacity: 0.6, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-[22px] font-semibold text-[#04193b]"
              >
                {previewTotal == null ? "—" : money(previewTotal)}
              </motion.div>
            </div>
          </div>

          {/* Delta pill */}
          <div className="mt-2 flex justify-center">
            <span
              className={[
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold border",
                delta > 0
                  ? "bg-red-50 text-red-700 border-red-200"
                  : delta < 0
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-gray-50 text-gray-700 border-gray-200",
              ].join(" ")}
            >
              {delta == null
                ? "—"
                : delta === 0
                ? "No price change"
                : `${sign}${money(abs)} ${delta > 0 ? "more" : "less"}`}
            </span>
          </div>

          <div className="mt-2 text-[12px] text-gray-500 text-center">
            Save to apply this new total.
          </div>
        </>
      )}
    </div>
  );
}

function WorkersDurationEditor({
  kind, // "workers" | "duration_hours"
  currentValue,
  onClose,
  jobId,
  getIdToken,
  onApplyAuthoritative, // ({ booking, quote }) => void
}) {
  const [picked, setPicked] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [preview, setPreview] = useState(null); // { current_total, delta_total, quote_preview }

  const doPreview = useCallback(
    async (val) => {
      setPicked(val);
      setErr(null);
      setLoading(true);
      try {
        if (!jobId) throw new Error("missing jobId");
        const fn = kind === "workers" ? previewJobWorkers : previewJobDuration;
        const resp = await fn({ jobId, [kind]: val, getIdToken });
        setPreview(resp || null);
      } catch (e) {
        setPreview(null);
        setErr(e?.message || "Failed to preview");
      } finally {
        setLoading(false);
      }
    },
    [jobId, getIdToken, kind]
  );

  const doSave = useCallback(
    async () => {
      if (picked == null) return;
      setErr(null);
      setLoading(true);
      try {
        if (!jobId) throw new Error("missing jobId");
        const fn = kind === "workers" ? editJobWorkers : editJobDuration;
        const resp = await fn({ jobId, [kind]: picked, getIdToken });
        onApplyAuthoritative?.(resp || {});
        onClose?.();
      } catch (e) {
        setErr(e?.message || "Failed to save");
      } finally {
               setLoading(false);
      }
    },
    [picked, kind, jobId, getIdToken, onApplyAuthoritative, onClose]
  );

  const currentTotal = preview?.current_total ?? null;
  const previewTotal = preview?.quote_preview?.total ?? null;
  const delta = preview?.delta_total ?? null;
  const saveCta = loading ? "Saving…" : "Save";

  return (
    <div className="max-w-[760px] w-full">
      <div className="space-y-3">
        {kind === "workers" ? (
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
              const active = picked === n || (!picked && currentValue === n);
              return (
                <button
                  key={n}
                  onClick={() => doPreview(n)}
                  className={[
                    "inline-flex items-center justify-center px-4 py-3 rounded-xl border font-semibold transition-all",
                    active
                      ? "bg-[#04193b] text-white border-[#04193b]"
                      : "bg-white border-gray-200 hover:border-[#04193b] hover:shadow-sm",
                  ].join(" ")}
                >
                  {n}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {[2, 5, 8].map((h) => {
              const active = picked === h || (!picked && Number(currentValue) === h);
              return (
                <button
                  key={h}
                  onClick={() => doPreview(h)}
                  className={[
                    "inline-flex items-center justify-center px-4 py-3 rounded-xl border font-semibold transition-all",
                    active
                      ? "bg-[#04193b] text-white border-[#04193b]"
                      : "bg-white border-gray-200 hover:border-[#04193b] hover:shadow-sm",
                  ].join(" ")}
                >
                  {h} hours
                </button>
              );
            })}
          </div>
        )}

        <PricePreviewBlock
          loading={loading}
          error={err}
          currentTotal={currentTotal}
          previewTotal={previewTotal}
          delta={delta}
        />

        <div className="flex gap-2 pt-1">
          <button
            disabled={picked == null || loading || err || !jobId}
            onClick={doSave}
            className={[
              "rounded-xl px-4 py-2 border border-transparent text-sm",
              picked == null || loading || err || !jobId
                ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                : "bg-[#04193b] text-white hover:opacity-90",
            ].join(" ")}
          >
            {saveCta}
          </button>
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------- Mobile Bottom Sheet ------------------------------- */
function MobileSheet({
  details,
  items,
  total,
  ready,
  editingLocked,
  onConfirm,
  onEdit,
  show = true,
  summaryIsEmpty,
  jobMode,
  openEditor,
  onExtend,
  onEnd,
  onCancel,
  loading = false,
  showLockNotice = false,
}) {
  // Start closed; only open via explicit event
  const [open, setOpen] = useState(false);
  // If the sheet gets disabled/unmounted, force-close it
  useEffect(() => {
    if (!show) setOpen(false);
  }, [show]);

  useEffect(() => {
    const openHandler = () => setOpen(true);
    const closeHandler = () => setOpen(false);
    window.addEventListener("right-rail:close", closeHandler);
    return () => {
      window.removeEventListener("right-rail:open", openHandler);
      window.removeEventListener("right-rail:close", closeHandler);
    };
  }, []);

  const handleEdit = useCallback(
    (field) => {
      setOpen(false);
      setTimeout(() => {
        if (jobMode) openEditor?.(field);
        else onEdit?.(field);
      }, 160);
    },
    [jobMode, openEditor, onEdit]
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="xl:hidden fixed inset-0 bg-black/30 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
          <motion.div
            className="xl:hidden fixed inset-x-0 bottom-0 z-50"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "tween", duration: 0.22 }}
          >
            <div className="mx-auto w-full max-w-[640px]">
              <div className="rounded-t-2xl bg-white shadow-lg border-t border-gray-200">
                <div className="pt-2 pb-1 flex items-center justify-center">
                  <div className="h-1.5 w-12 rounded-full bg-gray-300" />
                </div>

                <div className="px-4 pb-2 flex items-center justify-between">
                  <h2 className="text-[16px] font-semibold text-[#04193b]">
                    {jobMode ? "Job changes" : "Booking Details"}
                  </h2>
                  <button
                    className="p-2 rounded-md hover:bg-gray-100"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    title="Close"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="w-5 h-5"
                      stroke="currentColor"
                      strokeWidth="2"
                      fill="none"
                    >
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>

                <div className="px-4 pb-4 max-h-[60vh] overflow-y-auto">
                  {loading ? (
                    <SkeletonBottomSheet />
                  ) : (
                    <>
                      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
                        <AnimatePresence initial={false}>
                          {details.map((d) =>
                            d.value ? (
                              <Line
                                key={d.k}
                                label={d.label}
                                amount={null}
                                action={
                                  jobMode && d.field === "service_type" ? (
                                    <LockedIcon />
                                  ) : (
                                    <button
                                      onClick={() => handleEdit(d.field)}
                                      disabled={jobMode && editingLocked}
                                      title={
                                        jobMode && editingLocked
                                          ? "Edits locked within 24 hours of start"
                                          : `Edit ${d.label}`
                                      }
                                      aria-label={`Edit ${d.label}`}
                                      className={[
                                        "p-1 rounded-md border",
                                        jobMode && editingLocked
                                          ? "text-gray-400 border-gray-200 bg-gray-100 cursor-not-allowed"
                                          : "text-[#04193b] border-gray-200 bg-white hover:bg-gray-50",
                                      ].join(" ")}
                                    >
                                      <PencilIcon />
                                    </button>
                                  )
                                }
                              >
                                {d.value}
                              </Line>
                            ) : null
                          )}
                        </AnimatePresence>

                        <AnimatePresence initial={false}>
                          {!summaryIsEmpty &&
                            details.filter((d) => !d.value).length > 0 && (
                              <motion.div
                                key="placeholders-mobile"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="space-y-1.5"
                              >
                                {details
                                  .filter((d) => !d.value)
                                  .map((d) => (
                                    <div
                                      key={d.k}
                                      className="flex items-center justify-between text-[14px]"
                                    >
                                      <span className="text-gray-400">
                                        {d.label}
                                      </span>
                                      <span className="text-gray-300">—</span>
                                    </div>
                                  ))}
                              </motion.div>
                            )}
                        </AnimatePresence>
                      </div>

                      <div className="bg-white rounded-2xl border border-gray-200 p-4 mt-4">
                        <div className="text-[13px] font-semibold text-[#04193b] mb-3">
                          Cost Breakdown
                        </div>
                        <div className="space-y-2">
                          <AnimatePresence initial={false}>
                            {items.map((row, i) => (
                              <Line key={row.label + i} label={row.label} amount={row.amount} />
                            ))}
                          </AnimatePresence>
                        </div>
                        <div className="my-3 border-t border-dashed border-gray-200" />
                        <motion.div
                          key={total ?? "—"}
                          initial={{ opacity: 0, scale: 0.98 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.18 }}
                          className="flex items-center justify-between"
                        >
                          <div className="text-[14px] text-gray-600">Total</div>
                          <div className="text-[18px] font-semibold text-[#04193b]">
                            {total === null ? "—" : money(total)}
                          </div>
                        </motion.div>
                      </div>

                      {!jobMode && (
                        <div className="mt-4">
                          <button
                            type="button"
                            disabled={!ready}
                            onClick={() => ready && onConfirm?.()}
                            className={[
                              "w-full h-11 rounded-xl text-[15px] font-medium",
                              ready
                                ? "bg-[#04193b] text-white hover:opacity-90"
                                : "bg-gray-200 text-gray-500 cursor-not-allowed",
                            ].join(" ")}
                          >
                            Book
                          </button>
                        </div>
                      )}

                      {jobMode && (
                        <div className="bg-white rounded-2xl border border-gray-200 p-4 mt-4">
                          <div className="text-[13px] font-semibold text-[#04193b] mb-3">
                            Actions
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <button
                              type="button"
                              onClick={() => (onExtend ? onExtend() : openEditor?.("duration_hours"))}
                              title="Extend job duration"
                              className="px-3 py-2 rounded-xl text-sm border bg-white text-[#04193b] border-gray-200 hover:bg-gray-50"
                            >
                              Extend
                            </button>
                            <button
                              type="button"
                              onClick={onEnd}
                              className="px-3 py-2 rounded-xl text-sm border bg-white text-[#04193b] border-gray-200 hover:bg-gray-50"
                            >
                              End Job
                            </button>
                            <button
                              type="button"
                              onClick={() => onCancel?.()}
                              className="px-3 py-2 rounded-xl text-sm border border-red-600 text-red-700 bg-white hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
                              title="Cancel this job"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {jobMode && showLockNotice && (
                        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-2xl p-4">
                          <p className="text-sm text-amber-900">
                            All job changes must be requested{" "}
                            <span className="font-semibold">24 hours</span> before the job
                            starts. If you need assistance please call{" "}
                            <a href="tel:18882586801" className="underline font-semibold">
                              888-258-6801
                            </a>
                            .
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------ Main Component ----------------------------- */
export default function RightRail({
  jobId: jobIdProp,
  summary,
  quoteCard,
  ui,
  ready,
  onConfirm,
  onEdit,
  onApply,
  show = true,
}) {
  const { getIdToken } = useAuth() || {};

  const [visible, setVisible] = useState(show);
  const [editingLocked, setEditingLocked] = useState(false);
  const firstCostMountRef = useRef(true);

  // Local optimistic state so the panel updates immediately after Save
  const [localSummary, setLocalSummary] = useState(summary || {});
  useEffect(() => setLocalSummary(summary || {}), [summary]);

  // Local quote override (after saves OR coupon)
  const [localQuote, setLocalQuote] = useState(null);

  useEffect(() => setVisible(show), [show]);

  useEffect(() => {
    const handler = () => setEditingLocked(true);
    window.addEventListener("right-rail:lock", handler);
    return () => window.removeEventListener("right-rail:lock", handler);
  }, []);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const s = localSummary || {};
  const resolvedQuoteCard = localQuote || quoteCard || null;
  const resolvedUi = ui || null;
  const resolvedReady = typeof ready === "boolean" ? ready : false;

  const jobMode = Boolean(s?.job_details);

  const jobId =
    jobIdProp ||
    s?.job_id ||
    s?.id ||
    s?.job?.id ||
    s?.job_details?.job_id ||
    null;

  /* --------------------------- COUPON (booking mode) --------------------------- */
const [couponInput, setCouponInput] = useState("");  // ← NEW
const onCouponChange = useCallback((v) => {
  setCouponInput(v);
  setCouponError(null);
  setCouponSuccess(null);
}, []);
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState(null);
  const [couponSuccess, setCouponSuccess] = useState(null);
  const [couponDiscountCents, setCouponDiscountCents] = useState(0); // keep name, store dollars

  const canCoupon = !jobMode; // coupons only in booking mode
  const normalizeCode = (s) => (s || "").replace(/\s+/g, "").toUpperCase();

  const applyCouponLocally = useCallback(
    (resp, base) => {
      // Prefer backend-provided quote_preview; otherwise derive local delta
      const qp = resp?.quote_preview;
      if (qp && typeof qp.total === "number") {
        setLocalQuote(qp);
        return;
      }
      const baseQuote = base || resolvedQuoteCard || quoteCard || null;
      const raw = Number(resp?.discount_cents ?? resp?.discount ?? resp?.amount_off_cents ?? 0);
      const disc = Math.max(0, raw) / 100; // cents → dollars
      if (!baseQuote || disc <= 0) return;

      const items = Array.isArray(baseQuote.items) ? [...baseQuote.items] : [];
      items.push({ label: "Discount", amount: -disc });
      const totalNum = Math.max(0, Number(baseQuote.total || 0) - disc);

      setLocalQuote({ ...baseQuote, items, total: totalNum });
    },
    [quoteCard, resolvedQuoteCard]
  );

  const handleApplyCoupon = useCallback(async () => {
    if (!canCoupon) return;
    const code = normalizeCode(couponInput);
    if (!code) return;

    setCouponLoading(true);
    setCouponError(null);
    setCouponSuccess(null);
    try {
      const resp = await couponsPreview({
        booking: s,
        code,
        getIdToken,
      });

      // ✅ If backend says "not ok", show its reason and bail.
      if (!resp?.ok) {
        setAppliedCoupon(null);
        setCouponDiscountCents(0);
        setLocalQuote(null);
        setCouponError(humanizeApiError(resp?.reason) || "Invalid or ineligible coupon.");
        setCouponSuccess(null);
        return;
      }

      const normalized = normalizeCode(resp?.code || code);
      const raw = Number(resp?.discount_cents ?? resp?.discount ?? resp?.amount_off_cents ?? 0);
      const disc = Math.max(0, raw) / 100; // cents → dollars

      applyCouponLocally(resp, quoteCard || resolvedQuoteCard || null);
      setAppliedCoupon(normalized);
      setCouponDiscountCents(disc);
      setCouponSuccess("Coupon applied successfully.");

      // mirror onto summary so parent flows can include coupon_code when booking
      setLocalSummary((cur) => ({ ...(cur || {}), coupon_code: normalized }));

      // broadcast for any listeners
      window.dispatchEvent(
        new CustomEvent("booking:coupon/set", {
          detail: { code: normalized, discount_cents: Math.max(0, raw) },
        })
      );
    } catch (e) {
      setAppliedCoupon(null);
      setCouponDiscountCents(0);
      setCouponError(humanizeApiError(e?.message || e) || "Invalid or ineligible coupon.");
      setCouponSuccess(null);
      // clear any previous quote override
      setLocalQuote(null);
      // also clear mirrored code if any
      setLocalSummary((cur) => {
        const next = { ...(cur || {}) };
        delete next.coupon_code;
        return next;
      });
    } finally {
      setCouponLoading(false);
    }
  }, [canCoupon, couponInput, s, quoteCard, resolvedQuoteCard, applyCouponLocally]);

  const handleRemoveCoupon = useCallback(() => {
    setAppliedCoupon(null);
    setCouponDiscountCents(0);
    setCouponError(null);
    setCouponSuccess(null);
    setLocalQuote(null); // revert to base quote
    setLocalSummary((cur) => {
      const next = { ...(cur || {}) };
      delete next.coupon_code;
      return next;
    });
    window.dispatchEvent(new CustomEvent("booking:coupon/clear"));
  }, []);

  // Re-preview coupon automatically if booking/quote changes while a coupon is applied
useEffect(() => {
  if (!canCoupon || !appliedCoupon) return;
  let cancelled = false;
  (async () => {
    try {
      const resp = await couponsPreview({
        booking: s,
        code: appliedCoupon,
        getIdToken,
      });
      if (cancelled) return;
      const raw =
        (resp?.discount_cents ?? resp?.discount ?? resp?.amount_off_cents ?? 0) | 0;
      setCouponDiscountCents(Math.max(0, raw));
      applyCouponLocally(resp, quoteCard || resolvedQuoteCard || null);
    } catch {
      // keep prior visual state; user can re-apply manually
    }
  })();
  return () => {
    cancelled = true;
  };
}, [
  canCoupon,
  appliedCoupon,
  s?.workers,
  s?.duration_hours,
  s?.service_type,
  s?.address,
  s?.timezone_id,
  (quoteCard && quoteCard.total) || 0,
  (resolvedQuoteCard && resolvedQuoteCard.total) || 0,
  applyCouponLocally,
  quoteCard,
  resolvedQuoteCard,
  s,
  getIdToken, // <-- add this
]);

  // Confirm handler that forwards coupon_code (if any) to the parent onConfirm
  const handleConfirmWithCoupon = useCallback(() => {
    const code =
      (appliedCoupon && appliedCoupon.trim()) ||
      (typeof s?.coupon_code === "string" && s.coupon_code.trim()) ||
      null;

    // Pass coupon_code only if we have one; keep signature compatible
    if (typeof onConfirm === "function") {
      onConfirm(code ? { couponCode: code } : undefined);
    }
  }, [appliedCoupon, s?.coupon_code, onConfirm]);


  /* ------------------------------ Open editor ------------------------------ */
  const [editor, setEditor] = useState(null);
  const openEditor = useCallback(
    (field) => {
      if (!jobMode) {
        onEdit?.(field);
        return;
      }
      const jd = s.job_details || {};
      const ci = s.client_info || {};
      const addr = jd.address || {};
      const pre = {};

      if (field === "date_time") {
        pre.initialDate = jd.job_date || null;
        pre.initialTime = toHHmm(jd.job_time) || null;
      } else if (field === "onsite_manager_phone") {
        pre.initialPhone =
          ci.phone_number && String(ci.phone_number).startsWith("+")
            ? ci.phone_number
            : ci.phone_number
            ? `+1${String(ci.phone_number).replace(/\D/g, "").slice(-10)}`
            : "";
      } else if (field === "notes") {
        pre.initialNotes = jd.job_description_raw || jd.job_description || "";
      } else if (field === "tools_details") {
        pre.initialTools = jd.tools_details || "";
      } else if (field === "address") {
        const structured = addr?.street
          ? `${addr.street}${addr.city ? `, ${addr.city}` : ""}${
              addr.state ? `, ${addr.state}` : ""
            }${addr.postal_code ? ` ${addr.postal_code}` : ""}`
          : "";
        pre.initialAddress =
          (jd?.address_text && jd.address_text.trim()) || structured || "";
      } else if (field === "workers") {
        pre.initialWorkers = Number(jd.workers_required || 0) || null;
      } else if (field === "duration_hours") {
        pre.initialDuration = Number(jd.duration || 0) || null;
      }

      setEditor({ type: field, ...pre });
    },
    [jobMode, onEdit, s]
  );
  const closeEditor = useCallback(() => setEditor(null), []);

  /* -------------------------- Modern action modals ------------------------- */
  const [actionModal, setActionModal] = useState(null);
  const openAction = useCallback((t) => setActionModal(t), []);
  const closeAction = useCallback(() => setActionModal(null), []);

  const getJobStartDate = useCallback((summaryLike) => {
    const jd = summaryLike?.job_details || {};
    const ts = jd.job_start_timestamp || jd.start_at_utc || jd.job_start_iso;
    if (ts && typeof ts === "object" && "seconds" in ts) {
      return new Date(ts.seconds * 1000);
    }
    if (typeof ts === "string") {
      const d = new Date(ts);
      if (!Number.isNaN(d.getTime())) return d;
    }
    if (jd.job_date && jd.job_time) {
      try {
        return new Date(`${jd.job_date} ${jd.job_time}`);
      } catch {}
    }
    return null;
  }, []);

  const jobStart = getJobStartDate(s);
  const hoursUntil = jobStart ? (jobStart.getTime() - Date.now()) / 36e5 : null;
  const hasStarted = hoursUntil !== null && hoursUntil <= 0;
  const freeCancel = hoursUntil !== null && hoursUntil >= 24;
  const lockBy24hWindow = jobMode && hoursUntil !== null && hoursUntil < 24;
  const uiLock = Boolean(lockBy24hWindow || editingLocked);

  const handleExtend = useCallback(() => {
    openAction("extend");
  }, [openAction]);
  const handleEndJob = useCallback(() => {
    if (!jobId) return;
    openAction("end");
  }, [jobId, openAction]);
  const handleCancelJob = useCallback(() => {
    if (!jobId) return;
    openAction("cancel");
  }, [jobId, openAction]);

  const applyEdit = useCallback(
    (field, value) => {
      if (typeof onApply === "function") onApply({ field, value });
      else
        window.dispatchEvent(
          new CustomEvent("job:field:update", {
            detail: { field, value },
          })
        );

      if (jobMode) {
        setLocalSummary((curr) => {
          const next = { ...(curr || {}) };
          next.job_details = { ...(next.job_details || {}) };
          next.client_info = { ...(next.client_info || {}) };

          if (field === "date_time" && value && typeof value === "object") {
            const { date, time } = value;
            if (date) next.job_details.job_date = date;
            if (time) next.job_details.job_time = hhmmToAmPm(time);
          } else if (field === "onsite_manager_phone") {
            const digits = onlyDigits(value);
            next.client_info.phone_number = digits.startsWith("1")
              ? digits
              : `1${digits}`;
          } else if (field === "notes") {
            next.job_details.job_description_raw = value;
          } else if (field === "tools_details") {
            next.job_details.tools_details = value;
          } else if (field === "address") {
            next.job_details.address_text = value;
          } else if (field === "workers") {
            next.job_details.workers_required = Number(value);
          } else if (field === "duration_hours") {
            next.job_details.duration = Number(value);
          } else if (field === "tools") {
            next.job_details.tools = Boolean(value);
          }
          return next;
        });
      }
      setEditor(null);
    },
    [jobMode, onApply]
  );

  const mergeAuthoritativeJob = useCallback((resp) => {
    if (!resp) return;
    const booking = resp.booking || resp?.data?.booking || null;
       const quote = resp.quote || resp?.data?.quote || null;
    if (quote) setLocalQuote(quote);
    if (booking) {
      setLocalSummary((curr) => {
        const next = { ...(curr || {}) };
        next.job_details = { ...(next.job_details || {}) };
        if (typeof booking.workers === "number")
          next.job_details.workers_required = booking.workers;
        if (typeof booking.duration_hours === "number")
          next.job_details.duration = booking.duration_hours;
        if (typeof booking.notes === "string")
          next.job_details.job_description_raw = booking.notes;
        return next;
      });
    }
  }, []);

  /* ------------------------------- Details list ---------------------------- */
  const summaryIsEmpty = !s || Object.keys(s).length === 0;

  const details = useMemo(() => {
    if (s?.job_details) {
      const jd = s.job_details || {};
      const ci = s.client_info || {};
      const addr = jd.address || {};
      const textAddress = (jd.address_text || "").trim();
      const fullAddress = textAddress
        ? textAddress
        : addr.street
        ? `${addr.street}${addr.city ? `, ${addr.city}` : ""}${
            addr.state ? `, ${addr.state}` : ""
          }${addr.postal_code ? ` ${addr.postal_code}` : ""}`
        : null;

      const displayAddress = fullAddress ? short(fullAddress, 28) : null;

      const serviceRaw = Array.isArray(jd.services_requested)
        ? jd.services_requested[0]
        : jd.services_requested;
      const service =
        serviceRaw && typeof serviceRaw === "string"
          ? serviceRaw[0].toUpperCase() + serviceRaw.slice(1)
          : null;

      return [
        { k: "service_type", label: "Service", value: service, field: "service_type" },
        {
          k: "workers",
          label: "Workers",
          value: jd.workers_required ? String(jd.workers_required) : null,
          field: "workers",
        },
        {
          k: "date_time",
          label: "Date & time",
          value: formatWhenJob(jd),
          field: "date_time",
        },
        {
          k: "duration_hours",
          label: "Duration",
          value:
            jd.duration != null
              ? `${parseInt(jd.duration, 10)} hour${
                  parseInt(jd.duration, 10) === 1 ? "" : "s"
                }`
              : null,
          field: "duration_hours",
        },
        { k: "address", label: "Address", value: displayAddress, field: "address" },
        {
          k: "notes",
          label: "Notes",
          value: jd.job_description_raw || jd.job_description || null,
          field: "notes",
        },
        {
          k: "onsite_manager_phone",
          label: "Contact",
          value: ci.phone_number ? formatPhone(ci.phone_number) : null,
          field: "onsite_manager_phone",
        },
      ];
    }

    // BOOKING MODE
    const workers = typeof s?.workers === "number" ? String(s.workers) : null;
    const when = formatWhen(s);
    const duration =
      s?.duration_hours != null
        ? `${parseInt(s.duration_hours, 10)} hour${
            parseInt(s.duration_hours, 10) === 1 ? "" : "s"
          }`
        : null;
    const address = short(s?.address, 18);
    const tools = s?.tools === true ? "Yes" : s?.tools === false ? "No" : null;
    const notes = short(s?.notes, 18);
    const phone =
      (typeof s?.onsite_manager_phone === "string"
        ? s.onsite_manager_phone.includes("*")
          ? s.onsite_manager_phone
          : formatPhone(s.onsite_manager_phone)
        : null) ||
      formatPhone(
        resolvedUi?.state?.slots?.onsite_manager_phone ||
          resolvedUi?.slots?.onsite_manager_phone ||
          null
      );

    return [
      {
        k: "service_type",
        label: "Service",
        value: s?.service_type
          ? s.service_type[0].toUpperCase() + s.service_type.slice(1)
          : null,
        field: "service_type",
      },
      { k: "workers", label: "Workers", value: workers, field: "workers" },
      { k: "date_time", label: "Date & time", value: when, field: "date_time" },
      { k: "duration_hours", label: "Duration", value: duration, field: "duration_hours" },
      { k: "address", label: "Address", value: address, field: "address" },
      { k: "tools", label: "Tools", value: tools, field: "tools" },
      { k: "notes", label: "Notes", value: notes, field: "notes" },
      { k: "onsite_manager_phone", label: "Contact", value: phone, field: "onsite_manager_phone" },
    ];
  }, [s, resolvedUi]);

  const items = useMemo(() => {
    const srcQuote = resolvedQuoteCard;
    if (srcQuote?.items) {
      const isBookingMode = !s?.job_details;

      const shouldAddTools100 = Boolean(
        s?.job_details &&
          (s.job_details?.tools_needed === true ||
            Number(s.job_details?.cost_summary?.tools_cost?.total_cost) === 100)
      );
      const processingFeeAmount =
        Number(s?.job_details?.cost_summary?.total_processing_fee ?? 0) || 0;

      const rows = condenseItems(srcQuote.items, {
        shouldAddTools100,
        processingFeeAmount,
        includeToolsFromQuote: isBookingMode,
      });
      // 🔹 Job mode: append discount from Firestore cost_summary if not already present
      if (!isBookingMode) {
        const cs = s?.job_details?.cost_summary || {};
        const disc = Number(cs?.coupon?.discount ?? 0) || 0; // Firestore stores positive
        const hasDiscountRow = rows.some(
          (r) =>
            String(r.label || "").toLowerCase().includes("discount") ||
            (typeof r.amount === "number" && r.amount < 0)
        );
        if (disc > 0 && !hasDiscountRow) {
          rows.push({ label: "Discount", amount: -Math.abs(disc) });
        }
      }
      return rows;
    }

    // Job mode fallback
    if (s?.job_details) {
      const jd = s.job_details || {};
      const cs = jd.cost_summary || {};
      const csWorker = cs.worker_cost || {};
      const jdWorker = jd.worker_cost || {};
      const out = [];

      const laborRaw =
        csWorker.total != null
          ? csWorker.total
          : jdWorker.total != null
          ? jdWorker.total
          : null;

      const labor = laborRaw != null && laborRaw !== "" ? Number(laborRaw) : null;
      const bg =
        cs.background_check_fee != null && cs.background_check_fee !== ""
          ? Number(cs.background_check_fee)
          : null;
      const processing =
        cs.total_processing_fee != null && cs.total_processing_fee !== ""
          ? Number(cs.total_processing_fee)
          : null;
      const hasToolsExactly =
        jd.tools_needed === true || Number(cs?.tools_cost?.total_cost) === 100;

      if (labor !== null && !Number.isNaN(labor)) out.push({ label: "Labor Cost", amount: labor });
      if (bg !== null && !Number.isNaN(bg)) out.push({ label: "Background Check Fee", amount: bg });
      if (hasToolsExactly) out.push({ label: "Tools Cost", amount: 100 });
      if (processing !== null && !Number.isNaN(processing))
        out.push({ label: "Processing Fee", amount: processing });

      // 🔹 Also surface discount from Firestore if present
      const disc = Number(cs?.coupon?.discount ?? 0) || 0; // positive in Firestore
      if (disc > 0) out.push({ label: "Discount", amount: -Math.abs(disc) });
      

      return out;
    }

    // Booking mode fallback
    return condenseItems(quoteCard?.items || [], {
      includeToolsFromQuote: !s?.job_details,
    });
  }, [s, resolvedQuoteCard, quoteCard]);

  useEffect(() => {
    if (!jobMode) return;
    if (firstCostMountRef.current === false) return;
    if (!items || items.length === 0) return;
    const id = requestAnimationFrame(() => {
      firstCostMountRef.current = false;
    });
    return () => cancelAnimationFrame(id);
  }, [jobMode, items.length]);

  const total = useMemo(() => {
    if (resolvedQuoteCard?.total != null) return Number(resolvedQuoteCard.total);
    if (s?.job_details) {
      const cs = s.job_details.cost_summary || {};
      if (cs.final_amount_due_now != null && cs.final_amount_due_now !== "") {
        return Number(cs.final_amount_due_now);
      }
    }
    return quoteCard?.total ?? null;
  }, [s, resolvedQuoteCard, quoteCard]);

  /* --------------------- Loading / Placeholder management ------------------ */
  const hasAnyDetailValue = details.some((d) => !!d.value);
  const hasCostItems = Array.isArray(items) && items.length > 0;
  const hasTotal = total !== null && total !== undefined;
  const dataLoaded = hasAnyDetailValue || hasCostItems || hasTotal;

  const [showSkeleton, setShowSkeleton] = useState(true);
  useEffect(() => {
    if (!mounted) return;
    if (dataLoaded) {
      const t = setTimeout(() => setShowSkeleton(false), 250);
      return () => clearTimeout(t);
    } else {
      setShowSkeleton(true);
    }
  }, [mounted, dataLoaded]);

  const tzForJob = s?.job_details?.timezone || s?.job_details?.timezone_id || undefined;

  const [notesSaving, setNotesSaving] = useState(false);
  const [notesError, setNotesError] = useState(null);

  const handleAuthoritativeApply = useCallback(({ booking, quote }) => {
    if (quote) setLocalQuote(quote);
    if (booking) {
      setLocalSummary((curr) => {
        const next = { ...(curr || {}) };
        next.job_details = { ...(next.job_details || {}) };
        if (typeof booking.workers === "number")
          next.job_details.workers_required = booking.workers;
        if (typeof booking.duration_hours === "number")
          next.job_details.duration = booking.duration_hours;
        if (typeof booking.notes === "string")
          next.job_details.job_description_raw = booking.notes;
        return next;
      });
    }
  }, []);

  /* --------------------------------- Render -------------------------------- */
  const tzForDisplay = tzForJob;

  return (
    <>
      {visible && (
        <AnimatePresence mode="wait">
          {mounted && (
            <motion.aside
              key={showSkeleton ? "skeleton-aside" : "content-aside"}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.18 }}
              className="hidden xl:flex flex-col border-l border-gray-200 bg-white sticky top-[56px] h-[calc(100dvh-56px)] overflow-y-auto overflow-x-hidden"
            >
              <AnimatePresence mode="wait">
                {showSkeleton ? (
                  <motion.div
                    key="desktop-skeleton"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    <SkeletonRightRailDesktop jobMode={jobMode} />
                  </motion.div>
                ) : (
                  <motion.div
                    key="desktop-content"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.18 }}
                    className="w-[360px] max-w-[360px] p-4 space-y-6"
                  >
                    <div className="flex items-center justify-between">
                      <h2 className="text-[16px] pt-2 font-semibold text-[#04193b]">
                        {jobMode ? "Details & Changes" : "Booking Details"}
                      </h2>
                    </div>

                    {/* Details */}
                    <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2">
                      <AnimatePresence initial={false}>
                        {details.map((d) =>
                          d.value ? (
                            <Line
                              key={d.k}
                              label={d.label}
                              amount={null}
                              action={
                                jobMode && d.field === "service_type" ? (
                                  <LockedIcon />
                                ) : (
                                  <button
                                    onClick={() =>
                                      jobMode ? openEditor(d.field) : onEdit?.(d.field)
                                    }
                                    disabled={jobMode && uiLock}
                                    title={
                                      jobMode && uiLock
                                        ? "Edits locked within 24 hours of start"
                                        : `Edit ${d.label}`
                                    }
                                    aria-label={`Edit ${d.label}`}
                                    className={[
                                      "p-1 rounded-md border",
                                      jobMode && uiLock
                                        ? "text-gray-400 border-gray-200 bg-gray-100 cursor-not-allowed"
                                        : "text-[#04193b] border-gray-200 bg-white hover:bg-gray-50",
                                    ].join(" ")}
                                  >
                                    <PencilIcon />
                                  </button>
                                )
                              }
                            >
                              {d.value}
                            </Line>
                          ) : null
                        )}
                      </AnimatePresence>

                      <AnimatePresence initial={false}>
                        {!summaryIsEmpty && details.filter((d) => !d.value).length > 0 && (
                          <motion.div
                            key="placeholders"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="space-y-1.5"
                          >
                            {details
                              .filter((d) => !d.value)
                              .map((d) => (
                                <div
                                  key={d.k}
                                  className="flex items-center justify-between text-[14px]"
                                >
                                  <span className="text-gray-400">{d.label}</span>
                                  <span className="text-gray-300">—</span>
                                </div>
                              ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Coupon (booking mode only) */}
                    <CouponCard
                      canCoupon={canCoupon}
                      appliedCoupon={appliedCoupon}
                      couponInput={couponInput}
                      couponLoading={couponLoading}
                      couponError={couponError}
                      couponSuccess={couponSuccess}
                      couponDiscountCents={couponDiscountCents}
                      onChange={onCouponChange}
                      onApply={handleApplyCoupon}
                      onRemove={handleRemoveCoupon}
                    />

                    {/* Cost */}
                    <div className="bg-white rounded-2xl border border-gray-200 p-4">
                      <div className="text-[13px] font-semibold text-[#04193b] mb-3">
                        Cost Breakdown
                      </div>
                      <div className="space-y-2">
                        <AnimatePresence initial={false}>
                          {items.map((row, i) => (
                            <Line
                              key={row.label + i}
                              label={row.label}
                              amount={row.amount}
                              variant={jobMode ? "fadeScale" : "slide"}
                              instant={jobMode && firstCostMountRef.current}
                              layoutOn={!(jobMode && firstCostMountRef.current)}
                            />
                          ))}
                        </AnimatePresence>
                      </div>
                      <div className="my-3 border-t border-dashed border-gray-200" />
                      <motion.div
                        key={total ?? "—"}
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.18 }}
                        className="flex items-center justify-between"
                      >
                        <div className="text-[14px] text-gray-600">Total</div>
                        <div className="text-[18px] font-semibold text-[#04193b]">
                          {total === null ? "—" : money(total)}
                        </div>
                      </motion.div>
                    </div>

                    {/* Book button (desktop) */}
                    {!jobMode && (
                      <div className="pt-0">
                        <button
                          type="button"
                          disabled={!resolvedReady}
                          onClick={() => resolvedReady && handleConfirmWithCoupon()}
                          className={[
                            "w-full h-11 rounded-xl text-[15px] font-medium",
                            resolvedReady
                              ? "bg-[#04193b] text-white hover:opacity-90"
                              : "bg-gray-200 text-gray-500 cursor-not-allowed",
                          ].join(" ")}
                        >
                          Book
                        </button>
                      </div>
                    )}

                    {/* Job actions */}
                    {jobMode && (
                      <div className="bg-white rounded-2xl border border-gray-200 p-4">
                        <div className="text-[13px] font-semibold text-[#04193b] mb-3">
                          Actions
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={handleExtend}
                            title="Extend job duration"
                            className="px-3 py-2 rounded-xl text-base border bg-white text-[#04193b] border-gray-200 hover:bg-gray-50"
                          >
                            Extend
                          </button>
                          <button
                            type="button"
                            onClick={handleEndJob}
                            className="px-3 py-2 rounded-xl text-base border bg-white text-[#04193b] border-gray-200 hover:bg-gray-50"
                          >
                            End Job
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelJob}
                            className="px-3 py-2 rounded-xl text-base border border-red-600 text-red-600 bg-white hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
                            title="Cancel this job"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {jobMode && uiLock && (
                      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
                        <p className="text-sm text-amber-900">
                          All job changes must be requested{" "}
                          <span className="font-semibold">24 hours</span> before the job
                          starts. If you need assistance please call{" "}
                          <a href="tel:18882586801" className="underline font-semibold">
                            888-258-6801
                          </a>
                          .
                        </p>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.aside>
          )}
        </AnimatePresence>
      )}

      {/* Mobile sheet (coupon UI kept desktop-only for now) */}
      <div className="xl:hidden">
        <AnimatePresence>
          {mounted && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.18 }}
            >
              <MobileSheet
                details={details}
                items={items}
                total={total}
                ready={resolvedReady}
                editingLocked={uiLock}
                onConfirm={handleConfirmWithCoupon}
                onEdit={onEdit}
                show={visible}
                summaryIsEmpty={summaryIsEmpty}
                jobMode={jobMode}
                openEditor={openEditor}
                onExtend={handleExtend}
                onEnd={handleEndJob}
                onCancel={handleCancelJob}
                loading={showSkeleton}
                showLockNotice={jobMode && uiLock}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ---------- Popups ---------- */}
      {/* Date/Time */}
      <EditorModal open={jobMode && editor?.type === "date_time"} title="Pick date & time" onClose={closeEditor} wide>
        <CalendarTimePicker
          preselectedDate={editor?.initialDate || null}
          preselectedTime={editor?.initialTime || null}
          onPickDateAndTime={(dateStr, timeStr) =>
            applyEdit("date_time", { date: dateStr, time: timeStr, timezone: tzForJob })
          }
          onCancel={closeEditor}
        />
      </EditorModal>

      {/* Onsite phone */}
      <EditorModal open={jobMode && editor?.type === "onsite_manager_phone"} title="On-site phone number" onClose={closeEditor}>
        <OnsitePhonePicker
          initial={editor?.initialPhone || ""}
          onSet={(e164) => applyEdit("onsite_manager_phone", e164)}
          onCancel={closeEditor}
        />
      </EditorModal>

      {/* Notes — API-backed save via editJobNotes */}
      <EditorModal open={jobMode && editor?.type === "notes"} title="Worker notes" onClose={closeEditor}>
        <TextFieldPicker
          label="Worker notes"
          placeholder="Brief notes for the crew (max 150 chars)…"
          maxLen={150}
          initial={editor?.initialNotes || ""}
          saving={notesSaving}
          disabled={!jobId}
          onSet={async (val) => {
            if (!jobId) return;
            setNotesError(null);
            setNotesSaving(true);
            try {
              const resp = await editJobNotes({ jobId, notes: val, getIdToken });
              mergeAuthoritativeJob(resp);
              closeEditor();
            } catch (e) {
              setNotesError(e?.message || "Failed to save notes");
            } finally {
              setNotesSaving(false);
            }
          }}
          onCancel={closeEditor}
        />
        {notesError ? <div className="text-sm text-red-600 mt-2">{notesError}</div> : null}
      </EditorModal>

      {/* Tools details */}
      <EditorModal open={jobMode && editor?.type === "tools_details"} title="Tools to bring" onClose={closeEditor}>
        <TextFieldPicker
          label="Which tools should we bring?"
          placeholder="e.g., power drill, ladder, basic toolkit"
          maxLen={120}
          initial={editor?.initialTools || ""}
          onSet={(val) => applyEdit("tools_details", val)}
          onCancel={closeEditor}
        />
      </EditorModal>

      {/* Address */}
      <EditorModal open={jobMode && editor?.type === "address"} title="Address" onClose={closeEditor} wide>
        <AddressPicker
          key={`addr-${editor?.initialAddress || ""}`}
          initial={editor?.initialAddress || ""}
          onSet={(formatted) => applyEdit("address", formatted)}
          onCancel={closeEditor}
          flat
        />
      </EditorModal>

      {/* Workers / Duration */}
      <EditorModal open={jobMode && editor?.type === "workers"} title="Workers" onClose={closeEditor}>
        <WorkersDurationEditor
          kind="workers"
          currentValue={editor?.initialWorkers ?? null}
          onClose={closeEditor}
          jobId={jobId}
          getIdToken={getIdToken}
          onApplyAuthoritative={handleAuthoritativeApply}
        />
      </EditorModal>
      <EditorModal open={jobMode && editor?.type === "duration_hours"} title="Estimated duration" onClose={closeEditor}>
        <WorkersDurationEditor
          kind="duration_hours"
          currentValue={editor?.initialDuration ?? null}
          onClose={closeEditor}
          jobId={jobId}
          getIdToken={getIdToken}
          onApplyAuthoritative={handleAuthoritativeApply}
        />
      </EditorModal>

      {/* ------------------------- Action Confirmation Modals ------------------------- */}
      {/* Extend: simple bridge into duration editor */}
      <EditorModal open={jobMode && actionModal === "extend"} title="Extend job" onClose={closeAction}>
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            Extend the estimated duration to keep the crew on site longer.
          </p>
          <div>
            <button
              className="rounded-xl px-4 py-2 text-sm bg-[#04193b] text-white hover:opacity-90"
              onClick={() => {
                closeAction();
                setEditor({ type: "duration_hours", initialDuration: s?.job_details?.duration ?? null });
              }}
            >
              Choose new duration
            </button>
          </div>
        </div>
      </EditorModal>

      {/* End Job */}
      <EditorModal open={jobMode && actionModal === "end"} title="End job?" onClose={closeAction}>
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            This will end the job and finalize charges based on time worked.
          </p>
          <div className="flex gap-2">
            <button
              className="rounded-xl px-4 py-2 text-sm bg-[#04193b] text-white hover:opacity-90"
              onClick={async () => {
                try {
                  await crmEndJob({ jobId, getIdToken });
                  closeAction();
                  // Optional: broadcast
                  window.dispatchEvent(new Event("job:ended"));
                } catch (e) {
                  alert(e?.message || "Failed to end job");
                }
              }}
            >
              End job
            </button>
            <button
              className="rounded-xl px-4 py-2 text-sm border border-gray-200 bg-white hover:bg-gray-50"
              onClick={closeAction}
            >
              Cancel
            </button>
          </div>
        </div>
      </EditorModal>

      {/* Cancel Job */}
      <EditorModal open={jobMode && actionModal === "cancel"} title="Cancel job?" onClose={closeAction}>
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            {hasStarted
              ? "The job has started. Cancelling now may incur charges."
              : freeCancel
              ? "You’re more than 24 hours out — cancellation should be free."
              : "Within 24 hours of the start time — cancellation fee may apply."}
          </p>
          <div className="flex gap-2">
            <button
              className="rounded-xl px-4 py-2 text-sm border border-red-600 text-red-600 bg-white hover:bg-red-50"
              onClick={async () => {
                try {
                  await crmCancelJob({ jobId, getIdToken });
                  closeAction();
                  window.dispatchEvent(new Event("job:cancelled"));
                } catch (e) {
                  alert(e?.message || "Failed to cancel job");
                }
              }}
            >
              Confirm cancel
            </button>
            <button
              className="rounded-xl px-4 py-2 text-sm border border-gray-200 bg-white hover:bg-gray-50"
              onClick={closeAction}
            >
              Keep job
            </button>
          </div>
        </div>
      </EditorModal>
    </>
  );
}
