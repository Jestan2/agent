// src/components/BookingSuccess.jsx
import { useEffect, useRef, useState, useCallback } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { createChatSession } from "../lib/api";

/* -------------------------- tiny date/time helpers -------------------------- */
function human(date, time, tz) {
  try {
    const iso = time ? `${date}T${time}:00` : date;
    const d = tz ? new Date(new Date(iso).toLocaleString("en-US", { timeZone: tz })) : new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return `${date} ${time || ""}`.trim();
  }
}

/* ------------------------------- ICS builder ------------------------------- */
function buildIcs({ title, date, start_time, address, timezone_id }) {
  const start = new Date(`${date}T${start_time || "09:00"}:00`);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

  const pad = (n) => String(n).padStart(2, "0");
  const fmtUTC = (d) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(
      d.getUTCMinutes()
    )}${pad(d.getUTCSeconds())}Z`;
  const fmtLocal = (d) =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(
      d.getSeconds()
    )}`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GALC//Booking//EN",
    "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}`,
    `DTSTAMP:${fmtUTC(new Date())}`,
    timezone_id ? `DTSTART;TZID=${timezone_id}:${fmtLocal(start)}` : `DTSTART:${fmtLocal(start)}`,
    timezone_id ? `DTEND;TZID=${timezone_id}:${fmtLocal(end)}` : `DTEND:${fmtLocal(end)}`,
    `SUMMARY:${title}`,
    `LOCATION:${(address || "").replace(/\n/g, " ")}`,
    "DESCRIPTION:Great American Labor Co. – booking created.",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
}

/* --------------------------------- Icons ---------------------------------- */
const IconCalendar = (props) => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" {...props}>
    <rect x="3" y="4.5" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M8 2.5v4M16 2.5v4M3 10.5h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const IconCopy = (props) => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" {...props}>
    <rect x="9" y="9" width="10" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2" />
  </svg>
);

/* --------------------------------- Component -------------------------------- */
export default function BookingSuccess() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const navigate = useNavigate();
  const prefersReduced = useReducedMotion();

  // focus trap
  const dialogRef = useRef(null);
  const firstBtnRef = useRef(null);

  /* ------------------------- open/close via window events ------------------------- */
  useEffect(() => {
    const onOpen = (e) => {
      setData(e.detail || null);
      setOpen(true);
      setTimeout(() => firstBtnRef.current?.focus(), 0);
    };
    const onClose = () => setOpen(false);
    window.addEventListener("booking:success", onOpen);
    window.addEventListener("booking:success:close", onClose);
    return () => {
      window.removeEventListener("booking:success", onOpen);
      window.removeEventListener("booking:success:close", onClose);
    };
  }, []);

  /* ------------------------------ keyboard support ------------------------------ */
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* --------------------------------- actions --------------------------------- */
  const copyId = useCallback(async () => {
    const text = data?.display_id || data?.job_id || "";
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  }, [data]);

  const addToCalendar = useCallback(() => {
    const blob = buildIcs({
      title: `${data?.display_id || "GALC booking"} — GALC Job`,
      date: data?.date,
      start_time: data?.start_time,
      address: data?.address,
      timezone_id: data?.timezone_id,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data?.display_id || "booking"}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  // ✅ Updated: go directly to the job route (prefer display_id like GALC-5013)
  const viewBooking = useCallback(() => {
    setOpen(false);
    const id = (data?.display_id || data?.job_id || "").toString().trim();
    if (id) {
      navigate(`/job/${encodeURIComponent(id)}`);
    } else {
      // Fallback if we somehow didn't receive an ID
      navigate("/account", { state: { focus: "jobs" } });
    }
  }, [navigate, data]);

  const bookAnother = useCallback(async () => {
    setOpen(false);
    try {
      const { session_id } = await createChatSession({ uid: "demo-user-1" });
      navigate(`/c/${session_id}`);
    } catch {
      const sid = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
      navigate(`/c/${sid}`);
    }
  }, [navigate]);

  const similarBooking = useCallback(() => {
    setOpen(false);
    const detail = { display_id: data?.display_id || null };
    try {
      localStorage.setItem("pending_similar_tip", JSON.stringify(detail));
    } catch {}
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("booking:similar:tip", { detail }));
    }, 0);
  }, [data]);

  /* ------------------------------ motion variants ------------------------------ */
  const overlayVariants = { hidden: { opacity: 0 }, show: { opacity: 1 }, exit: { opacity: 0 } };
  const sheetVariants = prefersReduced
    ? { hidden: { opacity: 0 }, show: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        hidden: { y: 24, opacity: 0, scale: 0.98 },
        show: { y: 0, opacity: 1, scale: 1, transition: { type: "spring", stiffness: 320, damping: 28 } },
        exit: { y: 12, opacity: 0, scale: 0.98 },
      };

  const Check = () => (
    <svg width="52" height="52" viewBox="0 0 24 24" aria-hidden="true">
      <motion.circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-600/20" />
      <motion.path
        d="M7 12l3 3 7-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: prefersReduced ? 0 : 0.6, ease: "easeOut", delay: 0.1 }}
        className="text-emerald-600"
      />
    </svg>
  );

  /* ----------------------------------- UI ----------------------------------- */
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Overlay */}
          <motion.div className="fixed inset-0 z-40 bg-black/40" variants={overlayVariants} initial="hidden" animate="show" exit="exit" />

          {/* Bottom sheet on mobile, centered on md+ */}
          <div className="fixed inset-0 z-50 grid items-end md:place-items-center">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="booking-success-title"
              aria-describedby="booking-success-desc"
              ref={dialogRef}
              className="w-full md:max-w-[640px] bg-white rounded-t-3xl md:rounded-3xl shadow-xl md:shadow-2xl
                         md:border md:border-gray-100 overflow-hidden"
              variants={sheetVariants}
              initial="hidden"
              animate="show"
              exit="exit"
            >
              {/* Grabber for mobile */}
              <div className="md:hidden pt-2 grid place-items-center">
                <div className="h-1.5 w-12 rounded-full bg-gray-200" />
              </div>

              {/* Header: hero */}
              <div className="px-6 pt-4 pb-2 sm:px-8 sm:pt-6 sm:pb-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid place-items-center rounded-full bg-emerald-50 text-emerald-600 w-14 h-14">
                    <Check />
                  </span>
                  <div className="min-w-0">
                    <div id="booking-success-title" className="text-[15px] font-semibold text-emerald-700">
                      Booking confirmed
                    </div>
                    <div className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-[#04193b] truncate">
                      {data?.display_id || "—"}
                    </div>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="ml-auto rounded-xl p-2 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-black/10"
                    aria-label="Close"
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 6l12 12M18 6l-12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Details: two calm lines (+ subtle divider) */}
              <div className="px-6 sm:px-8">
                <div className="border-t border-gray-100" />
                <div className="py-4 sm:py-5 space-y-1.5 text-[15px]">
                  <div className="text-gray-900">
                    {human(data?.date, data?.start_time, data?.timezone_id)}
                    {data?.address ? <span className="text-gray-400"> · </span> : null}
                    <span className="text-gray-700">{data?.address || ""}</span>
                  </div>
                  <div className="text-gray-600">
                    <span className="capitalize">{data?.service_type || "Service"}</span>
                    {data?.workers ? <span> · {data.workers} worker(s)</span> : null}
                    {data?.duration_hours ? <span> · {data.duration_hours}h</span> : null}
                  </div>
                </div>
              </div>

              {/* CTA bar */}
              <div className="px-6 sm:px-8 pb-4 sm:pb-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <button
                    onClick={viewBooking}
                    ref={firstBtnRef}
                    className="w-full sm:w-auto px-5 py-3 rounded-2xl bg-[#04193b] text-white font-medium shadow-sm
                               focus:outline-none focus-visible:ring-2 focus-visible:ring-[#04193b]/20"
                  >
                    View booking
                  </button>

                  <button
                    onClick={bookAnother}
                    className="w-full sm:w-auto px-5 py-3 rounded-2xl bg-gray-50 hover:bg-gray-100 text-gray-900 font-medium"
                  >
                    New booking
                  </button>

                  <button
                    onClick={similarBooking}
                    className="w-full sm:w-auto px-5 py-3 rounded-2xl bg-gray-50 hover:bg-gray-100 text-gray-900 font-medium"
                  >
                    Similar booking
                  </button>

                  <div className="flex-1" />

                  {/* Icon-only utilities (Swap: Calendar + Copy) */}
                  <div className="flex gap-2">
                    <button
                      onClick={addToCalendar}
                      className="h-10 w-10 grid place-items-center rounded-xl bg-white hover:bg-gray-50 border border-gray-200"
                      aria-label="Add to calendar"
                      title="Add to calendar"
                    >
                      <IconCalendar />
                    </button>
                    <button
                      onClick={copyId}
                      className="h-10 w-10 grid place-items-center rounded-xl bg-white hover:bg-gray-50 border border-gray-200"
                      aria-label="Copy booking ID"
                      title="Copy booking ID"
                    >
                      <IconCopy />
                    </button>
                  </div>
                </div>

                <div className="mt-4 text-sm text-gray-500" id="booking-success-desc" />
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
