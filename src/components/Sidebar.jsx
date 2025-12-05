// src/components/Sidebar.jsx
import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useState,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import logoUSA from "../assets/usa0.png";
import { useAuth } from "../context/AuthContext.jsx";
import { useCompanyJobs } from "../lib/useCompanyJobs";

import { db } from "../lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { getAccountStatus } from "../lib/api";

const SHOW_JOB_ACTIONS = false; 

/* --------------------------- Small UI bits --------------------------- */
function NameSkeleton() {
  return (
    <div className="w-full flex items-center gap-2 h-10">
      <div className="w-6 h-6 rounded-full bg-gray-200 animate-pulse" />
      <div className="h-3 w-[52%] max-w-[160px] rounded bg-gray-200 animate-pulse" />
      <div className="ml-auto h-3 w-12 rounded bg-gray-200 animate-pulse" />
    </div>
  );
}

function RowSkeleton() {
  return (
    <div
      aria-hidden
      className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-white px-3 py-3 animate-pulse"
    >
      <div className="absolute left-0 top-0 h-full w-1 bg-emerald-500/70" />
      <div className="flex items-start gap-2">
        <span className="mt-1 h-2 w-2 rounded-full bg-emerald-500/70" />
        <div className="min-w-0 flex-1">
          <div className="h-4 w-28 bg-gray-200 rounded" />
          <div className="mt-2 h-3 w-44 bg-gray-100 rounded" />
          <div className="mt-3 h-5 w-20 bg-gray-100 rounded-full" />
        </div>
      </div>
    </div>
  );
}


function PlusIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" {...props}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function DotsIcon(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...props}>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}
function CancelIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M15 9L9 15M9 9l6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function AccountIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...props}>
      <circle cx="12" cy="8" r="4" fill="currentColor" />
      <path d="M4 19.5c0-3.59 3.58-6.5 8-6.5s8 2.91 8 6.5V21H4v-1.5Z" fill="currentColor" />
    </svg>
  );
}

function UserOutlineIcon(props) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" {...props}>
      <circle cx="12" cy="8" r="3.5" strokeWidth="1.7" />
      <path d="M4.5 19.5c0-3.6 3.6-6 7.5-6s7.5 2.4 7.5 6" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/* --------------------------- Time helpers --------------------------- */
function timeHMInTZ(d, tz) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz || "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function formatPrettyDateInTZ(d, tz) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz || "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const parts = dtf.formatToParts(d);
  const month = parts.find(p => p.type === "month")?.value || "";
  const dayNum = Number(parts.find(p => p.type === "day")?.value || "0");
  const year = parts.find(p => p.type === "year")?.value || "";
  return `${month} ${ordinal(dayNum)}, ${year}`;
}
function isFullRefundEligible(startISO) {
  const now = new Date();
  const start = new Date(startISO);
  return start.getTime() - now.getTime() >= 24 * 60 * 60 * 1000;
}

/* --------------------------- Status theme --------------------------- */
function themeFor(variant = "upcoming") {
  if (variant === "past") {
    return {
      accent: "bg-gray-300",
      dot: "bg-gray-300",
      chipBg: "bg-gray-50",
      chipText: "text-gray-600",
      chipBorder: "border-gray-200",
      rowText: "text-gray-700",
      rowMuted: "opacity-80 hover:opacity-100",
    };
  }
  if (variant === "active") {
    return {
      accent: "bg-sky-500",
      dot: "bg-sky-500",
      chipBg: "bg-sky-50",
      chipText: "text-sky-700",
      chipBorder: "border-sky-100",
      rowText: "text-gray-900",
      rowMuted: "",
    };
  }
  return {
    accent: "bg-emerald-500",
    dot: "bg-emerald-500",
    chipBg: "bg-emerald-50",
    chipText: "text-emerald-700",
    chipBorder: "border-emerald-100",
    rowText: "text-gray-900",
    rowMuted: "",
  };
}

/* --------------------------- Jobs Gate wiring --------------------------- */
const JOBS_GATE_KEY = "jobs.gate.v1";
function readJobsGate(defaultIfMissing) {
  try {
    const raw = sessionStorage.getItem(JOBS_GATE_KEY);
    if (raw) return !!JSON.parse(raw).enabled;
  } catch {}
  return !!defaultIfMissing;
}

/* --------------------------- Smart Portal Popover --------------------------- */
function MenuPortal({ anchorRef, open, onClose, children, offset = 10, padding = 8 }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [visible, setVisible] = useState(false);

  const compute = useCallback(() => {
    const anchor = anchorRef?.current;
    const menuEl = menuRef.current;
    if (!anchor || !menuEl) return;

    const ar = anchor.getBoundingClientRect();
    const mr = menuEl.getBoundingClientRect();
    const mw = mr.width || 200;
    const mh = mr.height || 60;

    let left = ar.right + offset;
    if (left + mw + padding > window.innerWidth) {
      left = ar.left - offset - mw;
    }

    let top = ar.top + ar.height / 2 - mh / 2;
    top = Math.max(padding, Math.min(top, window.innerHeight - padding - mh));

    setPos({ top, left });
    setVisible(true);
  }, [anchorRef, offset, padding]);

  useLayoutEffect(() => {
    if (!open) return;
    setVisible(false);
    const id = requestAnimationFrame(compute);
    return () => cancelAnimationFrame(id);
  }, [open, compute, children]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => compute();
    const onResize = () => compute();
    const onKey = (e) => e.key === "Escape" && onClose?.();
    const onDocClick = (e) => {
      const inAnchor = anchorRef?.current?.contains(e.target);
      const inMenu = menuRef.current?.contains(e.target);
      if (!inAnchor && !inMenu) onClose?.();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocClick);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocClick);
    };
  }, [open, onClose, compute, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        zIndex: 1000,
        visibility: visible ? "visible" : "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}

/* --------------------------- Helpers to read job times --------------------------- */
function getStartDate(job) {
  const jd = job.job_details || job.raw?.job_details || {};
  const d =
    jd.job_start_timestamp?.toDate?.() ||
    (jd.job_start_iso ? new Date(jd.job_start_iso) : null) ||
    job.start ||
    null;
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
}
function getDurationHours(job) {
  const jd = job.job_details || job.raw?.job_details || {};
  let h =
    jd.duration_hours ??
    jd.durationHours ??
    jd.duration ??
    null;
  if (typeof h === "string") {
    const parsed = Number(h.replace(/[^\d.]/g, ""));
    h = Number.isFinite(parsed) ? parsed : null;
  }
  if (!Number.isFinite(h) || h <= 0) h = 2;
  return h;
}
function getEndDate(job) {
  const s = getStartDate(job);
  if (!s) return null;
  const hours = getDurationHours(job);
  return new Date(s.getTime() + hours * 60 * 60 * 1000);
}
function getTZ(job) {
  const jd = job.job_details || job.raw?.job_details || {};
  return jd.timezone || job.timezone || "UTC";
}
function getStatus(job) {
  const jd = job.job_details || job.raw?.job_details || {};
  return (jd.status || "").toString().toLowerCase();
}

/* --------------------------- Job row --------------------------- */
function JobRow({ job, onCancel, onSelect, variant = "upcoming" }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rowRef = useRef(null);
  const btnRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (!rowRef.current) return;
      if (!rowRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  const tz = getTZ(job);
  const start = getStartDate(job) || new Date();

  const prettyDate = formatPrettyDateInTZ(start, tz);
  const timeLabel = timeHMInTZ(start, tz);
  const jd = job.job_details || job.raw?.job_details || {};
  const service = (jd.services_requested?.[0] || job.service || "").toString();
  const displayId = job.id || "Booking";
  const city = jd.address?.city || job.city || "";

  const theme = themeFor(variant);

  const handleRowClick = (e) => {
    if (btnRef.current?.contains(e.target)) return;
    onSelect?.(job);
  };
  const handleRowKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(job);
    }
  };

  return (
    <motion.div
      ref={rowRef}
      layout
      role="button"
      tabIndex={0}
      onClick={handleRowClick}
      onKeyDown={handleRowKey}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ duration: 0.18 }}
      className={[
        "group relative overflow-hidden rounded-xl border border-[var(--border)] bg-white hover:border-gray-300 hover:bg-gray-50 transition-colors cursor-pointer",
        theme.rowMuted,
      ].join(" ")}
    >
      <div className={`absolute left-0 top-0 h-full w-1 ${theme.accent}`} />
      <div className="px-3 py-2.5">
        <div className="flex items-start gap-2">
          <span className={`mt-1 h-2 w-2 rounded-full ${theme.dot}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className={`truncate font-medium ${theme.rowText}`}>{displayId}</div>
              {service ? (
                <span
                  className={[
                    "px-2 py-0.5 rounded-full text-[10px] leading-5 border",
                    theme.chipBg,
                    theme.chipText,
                    theme.chipBorder,
                  ].join(" ")}
                >
                  {service}
                </span>
              ) : null}

              {/* RIGHT-SIDE ACTION SLOT (keeps spacing even when disabled) */}
              <div className="ml-auto relative shrink-0 w-[26px] h-[26px]">
                <button
                  ref={btnRef}
                  type="button"
                  onClick={(e) => {
                    if (!SHOW_JOB_ACTIONS) return; // no-op when disabled
                    e.stopPropagation();
                    setMenuOpen((v) => !v);
                  }}
                  aria-haspopup="menu"
                  aria-expanded={SHOW_JOB_ACTIONS ? menuOpen : false}
                  aria-hidden={!SHOW_JOB_ACTIONS}
                  tabIndex={SHOW_JOB_ACTIONS ? 0 : -1}
                  className={[
                    "absolute inset-0 grid place-items-center rounded transition p-1",
                    SHOW_JOB_ACTIONS
                      ? "opacity-0 group-hover:opacity-100 hover:bg-gray-100"
                      : "invisible pointer-events-none", // keeps same footprint, no interactivity
                  ].join(" ")}
                  title="Job actions"
                >
                  <DotsIcon />
                </button>

                {SHOW_JOB_ACTIONS && (
                  <MenuPortal anchorRef={btnRef} open={menuOpen} onClose={() => setMenuOpen(false)}>
                    <AnimatePresence>
                      {menuOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -4, scale: 0.98 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -4, scale: 0.98 }}
                          transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
                          className="w-48 rounded-lg bg-white shadow-xl ring-1 ring-black/5 overflow-hidden"
                          role="menu"
                          aria-label="Booking actions"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            role="menuitem"
                            className="group flex items-center gap-2.5 w-full text-left px-3 py-2.5 text-sm
                                      text-red-600 hover:bg-red-50 hover:text-red-700
                                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpen(false);
                              onCancel?.(job);
                            }}
                          >
                            <CancelIcon />
                            <span>Cancel booking</span>
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </MenuPortal>
                )}
              </div>
            </div>

            <div className="mt-0.5 text-[12px] text-gray-500 truncate">
              {prettyDate} · {timeLabel}
              {city ? <span> · {city}</span> : null}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* --------------------------- Shared content --------------------------- */
function SidebarContent({
  collapsed,
  setCollapsed,
  isLoadingName,
  finalDisplayName,
  triggerNewChat,
  jobsErr,
  showPlaceholders,
  activeNow,
  upcoming,
  recentPast,
  handleCancel,
  handleOpenJob,
  goAccount,
  closeMobile,
}) {
  return (
    <div className="flex h-full flex-col bg-[var(--bg-rail)]">
      {/* HEADER */}
      <div className="h-14 flex items-center px-3 border-b border-[var(--border)] bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <div
          className={[
            "inline-flex items-center gap-2 overflow-hidden",
            "transition-[max-width,opacity,transform] duration-300 ease-out",
            collapsed ? "max-w-0 opacity-0" : "max-w-[160px] opacity-100 translate-x-0",
          ].join(" ")}
        >
          <img
            src={logoUSA}
            alt="The Great American Labor Co. logo"
            className="h-5 md:h-6 w-auto block select-none shrink-0"
            draggable="false"
          />
        </div>

        <div className="ml-auto inline-flex items-center gap-1">
          {!collapsed ? (
            <button
              type="button"
              onClick={() => setCollapsed?.(true)}
              className="hidden md:inline-flex p-2 rounded-lg hover:bg-gray-100 text-gray-700"
              title="Collapse"
              aria-label="Collapse"
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setCollapsed?.(false)}
              className="hidden md:inline-flex p-2 rounded-lg hover:bg-gray-100 text-gray-700"
              title="Expand"
              aria-label="Expand"
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}

          {/* Mobile close */}
          <button
            type="button"
            onClick={closeMobile}
            className="md:hidden p-2 rounded-lg hover:bg-gray-100 text-gray-700"
            aria-label="Close sidebar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M6 6l12 12M6 18l12-12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* ACTION */}
      <div className="p-3 space-y-2">
        <button
          onClick={triggerNewChat}
          className={[
            "w-full inline-flex items-center gap-2",
            "rounded-lg border border-[var(--border)] bg-white shadow-sm",
            "px-3 py-2 text-sm text-gray-900 hover:bg-gray-50 transition",
          ].join(" ")}
        >
          <div className="h-5 w-5 rounded-full bg-gray-900 text-white grid place-items-center">
            <PlusIcon aria-hidden="true" />
          </div>
          {!collapsed && <span className="font-semibold text-[15px] leading-5">New chat</span>}
        </button>
      </div>

      {/* LISTS */}
      <div className="px-2 pb-2 overflow-y-auto flex-1">
        <AnimatePresence initial={false} mode="wait">
          {!collapsed && (
            <motion.div
              key="lists"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              {/* single error / loading gate */}
              {jobsErr ? (
                <div
                  className="px-2 py-2 text-sm rounded-lg border"
                  style={{ borderColor: "#F59E0B", background: "#FFFBEB", color: "#92400E" }}
                >
                  {jobsErr}
                </div>
              ) : showPlaceholders ? (
                <div className="space-y-2">
                  <RowSkeleton />
                  <RowSkeleton />
                </div>
              ) : (
                (() => {
                  const hasAny =
                    (activeNow?.length || 0) +
                      (upcoming?.length || 0) +
                      (recentPast?.length || 0) >
                    0;

                  // ✅ When there are zero jobs across all sections, show one nice line only.
                  if (!hasAny) {
                    return (
                      <div className="px-3 py-3 text-sm text-gray-500 text-center">
                        Nothing here yet — create a new chat to book your first job.
                      </div>
                    );
                  }

                  // Otherwise, render sections as before.
                  return (
                    <>
                      {/* ACTIVE */}
                      <div className="px-1 text-[11px] uppercase tracking-wide text-[var(--muted)] mt-1 mb-1">
                        Active now
                      </div>
                      {(activeNow?.length ?? 0) ? (
                        <motion.div layout className="space-y-2">
                          <AnimatePresence initial={false}>
                            {activeNow.map((j) => (
                              <JobRow
                                key={j.id}
                                job={j}
                                onCancel={handleCancel}
                                onSelect={handleOpenJob}
                                variant="active"
                              />
                            ))}
                          </AnimatePresence>
                        </motion.div>
                      ) : (
                        <div className="px-2 py-2 text-sm text-gray-400">No active jobs</div>
                      )}

                      {/* UPCOMING */}
                      <div className="px-1 text-[11px] uppercase tracking-wide text-[var(--muted)] mt-4 mb-1">
                        Upcoming
                      </div>
                      {(upcoming?.length ?? 0) ? (
                        <motion.div layout className="space-y-2">
                          <AnimatePresence initial={false}>
                            {upcoming.map((j) => (
                              <JobRow
                                key={j.id}
                                job={j}
                                onCancel={handleCancel}
                                onSelect={handleOpenJob}
                                variant="upcoming"
                              />
                            ))}
                          </AnimatePresence>
                        </motion.div>
                      ) : (
                        <div className="px-2 py-2 text-sm text-gray-400">Nothing upcoming</div>
                      )}

                      {/* RECENT */}
                      <div className="px-1 text-[11px] uppercase tracking-wide text-[var(--muted)] mt-4 mb-1">
                        Recent (last 7 days)
                      </div>
                      {(recentPast?.length ?? 0) ? (
                        <motion.div layout className="space-y-2">
                          <AnimatePresence initial={false}>
                            {recentPast.map((j) => (
                              <JobRow
                                key={j.id}
                                job={j}
                                onCancel={handleCancel}
                                onSelect={handleOpenJob}
                                variant="past"
                              />
                            ))}
                          </AnimatePresence>
                        </motion.div>
                      ) : (
                        <div className="px-2 py-2 text-sm text-gray-400">No recent jobs</div>
                      )}
                    </>
                  );
                })()
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* FOOTER */}
      <div className="mt-auto px-3 pt-3 pb-2 border-t border-[var(--border)] bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <AccountButton
          compact={collapsed}
          isLoadingName={isLoadingName}
          finalDisplayName={finalDisplayName}
          goAccount={goAccount}
        />
      </div>
    </div>
  );
}

function AccountButton({ isLoadingName, finalDisplayName, goAccount, compact = false }) {
  if (compact) {
    return (
      <motion.button
        onClick={goAccount}
        aria-label="Manage account"
        title="Manage account"
        // exactly 72px wide so it's centered in the collapsed rail;
        // -ml-3 cancels the footer's px-3 so the 72px region starts flush at the rail edge
        className="inline-flex items-center justify-center w-[72px] -ml-3 p-2 rounded-lg hover:bg-gray-100 transition"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="h-8 w-8 grid place-items-center rounded-xl border border-[var(--border)] bg-white/80 backdrop-blur text-gray-700 hover:text-gray-900 shadow-sm">
          <UserOutlineIcon />
        </div>
      </motion.button>
    );
  }

  return (
    <button
      onClick={goAccount}
      className={[
        "w-full inline-flex items-center gap-2",
        "rounded-lg px-2.5 py-2 text-sm hover:bg-gray-100 transition",
      ].join(" ")}
      aria-label="Manage account"
      title="Manage account"
    >
      <div className="flex-1 min-h-[40px] flex items-center justify-between overflow-hidden">
        <AnimatePresence initial={false} mode="wait">
          {isLoadingName ? (
            <motion.div
              key="skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-full"
            >
              <NameSkeleton />
            </motion.div>
          ) : (
            <motion.div
              key="name"
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 2 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="w-full flex items-center justify-between min-w-0"
            >
              <span className="text-gray-800 truncate min-w-0 pr-2">{finalDisplayName}</span>
              <span className="text-[11px] text-[var(--muted)] shrink-0">Manage</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </button>
  );
}

/* --------------------------- Component --------------------------- */
export default function Sidebar({
  open,
  setOpen,
  collapsed = false,
  setCollapsed,
}) {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const reduceMotion = useReducedMotion();

  // Lock background scroll on small screens when open
  useEffect(() => {
    // Overlay mode = any width below xl (tablets + phones)
    const isOverlayMode = () => window.matchMedia("(max-width: 1279.98px)").matches;
    if (open && isOverlayMode()) {
      document.documentElement.classList.add("overflow-hidden");
      document.body.classList.add("overflow-hidden");
    } else {
      document.documentElement.classList.remove("overflow-hidden");
      document.body.classList.remove("overflow-hidden");
    }
    return () => {
      document.documentElement.classList.remove("overflow-hidden");
      document.body.classList.remove("overflow-hidden");
    };
  }, [open]);

  // Auto-focus the panel when opened on mobile
  const panelRef = useRef(null);
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => panelRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
  }, [open]);

  /* ---- jobs gate state ---- */
  const [jobsGate, setJobsGate] = useState(() => readJobsGate(!!user));
  useEffect(() => {
    setJobsGate(readJobsGate(!!user));
  }, [user]);
  useEffect(() => {
    const onGate = (e) => setJobsGate(!!e?.detail?.enabled);
    window.addEventListener("company:jobs-gate", onGate);
    return () => window.removeEventListener("company:jobs-gate", onGate);
  }, []);

  /* ---- name (bottom area) ---- */
 // Local fallback (in case the member doc doesn't exist yet)
 const [fallbackName, setFallbackName] = useState("");
 const [fallbackLoading, setFallbackLoading] = useState(true);
 useEffect(() => {
   setFallbackLoading(true);
   if (!user) {
     setFallbackName("Guest");
     const t = setTimeout(() => setFallbackLoading(false), 60);
     return () => clearTimeout(t);
   }
   const n =
     (user.displayName && user.displayName.trim()) ||
     (user.email?.split("@")[0]) ||
     user.phoneNumber ||
     "User";
   setFallbackName(n);
   const t = setTimeout(() => setFallbackLoading(false), 60);
   return () => clearTimeout(t);
 }, [user?.uid, user?.displayName, user?.email, user?.phoneNumber]);

 // Live member doc from: customers/{customerId}/members/{uid}
 const [memberDoc, setMemberDoc] = useState(null);
 const [memberLoading, setMemberLoading] = useState(false);

 useEffect(() => {
   if (!user?.uid) {
     setMemberDoc(null);
     return;
   }
   let unsub;
   let cancelled = false;
   (async () => {
     setMemberLoading(true);
     try {
       // Ask backend which company/customer this user belongs to.
       // Falls back to uid (single-member company) if not present.
       let cid = null;
       try {
         const s = await getAccountStatus(() => user.getIdToken());
         cid = s?.customer_id || s?.company_id || null;
       } catch {}
       if (!cid) cid = user.uid;

       const ref = doc(db, "customers", cid, "members", user.uid);
       unsub = onSnapshot(ref, (snap) => {
         setMemberDoc(snap.exists() ? { id: snap.id, ...snap.data() } : null);
         setMemberLoading(false);
       });
     } catch {
       if (!cancelled) setMemberLoading(false);
     }
   })();
   return () => {
     cancelled = true;
     if (unsub) unsub();
   };
 }, [user?.uid]);

 // Prefer the display_name from the member doc; fall back to the local guess.
 const resolvedName =
   (memberDoc?.display_name?.trim?.()) ||
   ([memberDoc?.first_name, memberDoc?.last_name].filter(Boolean).join(" ").trim()) ||
   fallbackName;

  // Stream jobs from (now - 7 days) forward
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const fromSince = useRef(new Date(Date.now() - sevenDaysMs)).current;

  const enabled = jobsGate && !!user;
  const { jobs: jobsAll, loading: jobsLoading, error: jobsError } =
    useCompanyJobs({ from: fromSince, enabled });

  const [jobsHydrated, setJobsHydrated] = useState(false);
  useEffect(() => {
    if (!jobsLoading) setJobsHydrated(true);
  }, [jobsLoading]);

  // Split and sort
  const { activeNow, upcoming, recentPast } = useMemo(() => {
    const now = new Date();
    const lowerBound = new Date(now.getTime() - sevenDaysMs);
    const a = [];
    const u = [];
    const p = [];

    for (const j of jobsAll || []) {
      const status = getStatus(j);
      if (status === "cancelled") continue;

      const s = getStartDate(j);
      const e = getEndDate(j);
      if (!s || !e) continue;

      if (now >= s && now < e) a.push(j);
      else if (s >= now) u.push(j);
      else if (e < now && e >= lowerBound) p.push(j);
    }

    a.sort((x, y) => getStartDate(x) - getStartDate(y));
    u.sort((x, y) => getStartDate(x) - getStartDate(y));
    p.sort((x, y) => getEndDate(y) - getEndDate(x));

    return { activeNow: a, upcoming: u, recentPast: p };
  }, [jobsAll]);

  const showPlaceholders = authLoading || !jobsHydrated || jobsLoading;

  const jobsErr = (!enabled || !jobsError)
    ? ""
    : jobsError?.code === "permission-denied"
      ? "Denied by security rules."
      : jobsError?.message || "Unable to stream jobs.";

  // Close on ESC (mobile)
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setOpen?.(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const triggerNewChat = useCallback(() => {
    navigate("/");
    setOpen?.(false);
  }, [navigate, setOpen]);

  const goAccount = useCallback(() => {
    setOpen?.(false);
    if (user) {
      navigate("/account");
      return;
    }
    try {
      window.sessionStorage.setItem(
        "auth.intent",
        JSON.stringify({ type: "goto", path: "/account" })
      );
    } catch {}
    try {
      window.dispatchEvent(
        new CustomEvent("auth:open", {
          detail: { resumeAction: { type: "goto", path: "/account" } },
        })
      );
    } catch {
      navigate("/account");
    }
  }, [navigate, setOpen, user]);

  // Merge all loading states for the name area
  const isLoadingName = authLoading || fallbackLoading || memberLoading;

  // Final value shown in the footer button
  const finalDisplayName = !isLoadingName ? (resolvedName || "User") : "";

  const handleCancel = useCallback((job) => {
    const jd = job.job_details || job.raw?.job_details || {};
    const startISO =
      jd.job_start_timestamp?.toDate?.()?.toISOString?.() ||
      jd.job_start_iso ||
      "";
    const eligible = isFullRefundEligible(startISO);
    const msg = eligible
      ? "Cancel booking?\n\nYou’re within the full-refund window (≥24h before start)."
      : "Cancel booking?\n\nFull refund window has passed (starts <24h).";
    if (confirm(msg)) {
      console.log("Cancellation stub →", job.id);
      alert("Cancellation stub: this will call /v1/jobs/cancel next.");
    }
  }, []);

  const handleOpenJob = useCallback((job) => {
    if (!job?.id) return;
    navigate(`/job/${job.id}`);
    setOpen?.(false);
  }, [navigate, setOpen]);

  /* --------------------------- Desktop/tablet smooth "mask reveal" --------------------------- */
  const desktopWidth = collapsed ? 72 : 280;
  const desktopTransition = reduceMotion
    ? { duration: 0.001 }
    : {
        type: "spring",
        stiffness: 520,
        damping: 44,
        mass: 0.9,
        // small delay when collapsing so inner fades first (no jank)
        delay: collapsed ? 0.08 : 0,
      };

  return (
    <>
      {/* DESKTOP/TABLET rail with fixed inner width (content never squeezes) */}
      <motion.aside
        initial={false}
        animate={{ width: desktopWidth }}
        transition={desktopTransition}
        className={[
          "hidden xl:block md:sticky md:top-0 z-20 relative", // relative for overlay controls
          "h-[calc(100vh-56px)] border-r border-[var(--border)] bg-[var(--bg-rail)]",
          "overflow-hidden transform-gpu will-change-[width]",
        ].join(" ")}
        aria-label="Sidebar"
      >
        {/* Fixed-width inner frame: 280px at all times (masked by overflow) */}
        <div className="h-full w-[280px] min-w-[280px]">
          <SidebarContent
            collapsed={collapsed}
            setCollapsed={setCollapsed}
            isLoadingName={isLoadingName}
            finalDisplayName={finalDisplayName}
            triggerNewChat={triggerNewChat}
            jobsErr={jobsErr}
            showPlaceholders={showPlaceholders}
            activeNow={activeNow}
            upcoming={upcoming}
            recentPast={recentPast}
            handleCancel={handleCancel}
            handleOpenJob={handleOpenJob}
            goAccount={goAccount}
            closeMobile={() => {}}
          />
        </div>

        {/* Always-visible expand button while collapsed, anchored to the rail edge */}
        <AnimatePresence initial={false}>
          {collapsed && (
            <motion.button
              key="edge-expand"
              type="button"
              onClick={() => setCollapsed?.(false)}
              className="absolute top-2 right-2 h-8 w-8 grid place-items-center rounded-lg hover:bg-gray-100 text-gray-700"
              title="Expand"
              aria-label="Expand"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.12 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.button>
          )}
        </AnimatePresence>

        {/* Subtle gradient at the reveal edge (polish) */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-6"
          style={{
            background: "linear-gradient(to left, rgba(0,0,0,0.06), rgba(0,0,0,0))",
            mixBlendMode: "multiply",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: collapsed ? 0.25 : 0 }}
          transition={{ duration: 0.2 }}
        />
      </motion.aside>

      {/* MOBILE OVERLAY + SHEET (unchanged) */}
      <AnimatePresence initial={false}>
        {open && (
          <>
            <motion.div
              key="sb-backdrop"
              className="fixed inset-0 z-40 xl:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <div
                className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
                onClick={() => setOpen?.(false)}
              />
            </motion.div>

            <motion.aside
              key="sb-sheet"
              ref={panelRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label="Sidebar"
              className="fixed xl:hidden left-0 top-0 bottom-0 z-50 w-[min(88vw,380px)] border-r border-[var(--border)] bg-white shadow-2xl transform-gpu will-change-transform overflow-hidden"
              initial={{ x: -24, opacity: 0, filter: "blur(2px)" }}
              animate={{ x: 0, opacity: 1, filter: "blur(0px)" }}
              exit={{ x: -20, opacity: 0, filter: "blur(2px)" }}
              transition={
                reduceMotion ? { duration: 0.001 } : { type: "spring", stiffness: 520, damping: 42, mass: 0.9 }
              }
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.02}
              onDragEnd={(_, info) => {
                const threshold = 70;
                if (info.offset.x > threshold || info.velocity.x > 600) setOpen?.(false);
              }}
            >
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="h-full"
              >
                <SidebarContent
                  collapsed={false}
                  setCollapsed={() => {}}
                  isLoadingName={isLoadingName}
                  finalDisplayName={finalDisplayName}
                  triggerNewChat={triggerNewChat}
                  jobsErr={jobsErr}
                  showPlaceholders={showPlaceholders}
                  activeNow={activeNow}
                  upcoming={upcoming}
                  recentPast={recentPast}
                  handleCancel={handleCancel}
                  handleOpenJob={handleOpenJob}
                  goAccount={goAccount}
                  closeMobile={() => setOpen?.(false)}
                />
              </motion.div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
