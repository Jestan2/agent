// src/components/CalendarView.jsx
import { useMemo, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useCompanyJobs, monthRange } from "../lib/useCompanyJobs";

/** Config **/
const MAX_VISIBLE = 2;          // show at most 2 job pills per day
const OVERFLOW_DOT_MAX = 6;     // kept for future use

/** Helpers **/
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth() === b.getMonth() &&
         a.getDate() === b.getDate();
}
function buildMonthGrid(active) {
  const first = startOfMonth(active);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay()); // start on Sunday
  const days = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}
function timeHMInTZ(date, tz) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz || "UTC",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
}
function dateKeyInTZ(date, tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const y = parts.find(p => p.type === "year")?.value ?? "0000";
    const m = parts.find(p => p.type === "month")?.value ?? "01";
    const d = parts.find(p => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${d}`;
  } catch {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
}

/* ---------------- Issue detector (strict top-level) ---------------- */
function isWorkerNoShow(job) {
  return job?.issue?.tag === "worker_no_show";
}

function themeFor(job) {
  if (isWorkerNoShow(job)) {
    return {
      dot: "bg-amber-500",
      chipBg: "bg-amber-50",
      chipText: "text-amber-800",
      chipBorder: "border-amber-200",
    };
  }
  return {
    dot: "bg-emerald-500",
    chipBg: "bg-emerald-50",
    chipText: "text-emerald-800",
    chipBorder: "border-emerald-100",
  };
}

/** Pure fade + looser line-height (prevents descender clipping) */
function JobPill({ job }) {
  const jd = job.job_details || job.raw?.job_details || {};
  const start =
    job.start ||
    jd.job_start_timestamp?.toDate?.() ||
    (jd.job_start_iso ? new Date(jd.job_start_iso) : null);

  const tz = job.timezone || jd.timezone || "UTC";
  const timeLabel = start ? timeHMInTZ(start, tz) : "";
  const service = (job.service || jd.services_requested?.[0] || "").toString();
  const theme = themeFor(job);

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={[
        "h-[var(--pill-h)] w-full rounded-md border text-[11px] sm:text-[12px]",
        "px-2 flex items-center gap-1.5",
        "leading-[1.25]",
        "shadow-[0_0_0_1px_rgba(0,0,0,0.02)]",
        theme.chipBg,
        theme.chipText,
        theme.chipBorder,
      ].join(" ")}
      title={`${service ? service + " · " : ""}${timeLabel}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${theme.dot}`} />
      {timeLabel && <span className="font-semibold tabular-nums">{timeLabel}</span>}
      {service && <span className="truncate">· {service}</span>}
    </motion.div>
  );
}

/** One row with an absolute overlay to crossfade skeleton ↔ content */
function RailSlot({ loading, job }) {
  return (
    <div className="relative h-[var(--pill-h)]">
      <AnimatePresence initial={false} mode="wait">
        {loading && !job && (
          <motion.div
            key="ghost"
            className="absolute inset-0 rounded-md border border-gray-100 bg-gray-100"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            aria-hidden
          />
        )}
        {job && (
          <motion.div
            key={job.id}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <JobPill job={job} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Fixed-height, no-reflow 2-row rail (DESKTOP ONLY @xl) */
function DayRail({ jobs, loading }) {
  const items = (jobs || []).slice(0, MAX_VISIBLE);

  return (
    <div
      className={[
        "hidden xl:flex relative px-1.5 sm:px-2 pb-2 flex-col gap-1.5 overflow-hidden",
        // Reserve height for exactly 2 pills (30px each) + a single 6px gap
        "[--pill-h:30px] min-h-[calc(var(--pill-h)*2+6px)]",
      ].join(" ")}
    >
      {Array.from({ length: MAX_VISIBLE }).map((_, i) => (
        <RailSlot key={i} loading={loading} job={items[i]} />
      ))}
    </div>
  );
}

export default function CalendarView({
  onBookDay = () => {},
  onViewDay = () => {},
  selectedDate = null,
}) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const [mobilePicked, setMobilePicked] = useState(null);

  const today = useMemo(() => {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }, []);

  const { start: mStart, end: mEnd } = useMemo(
    () => monthRange(month.getFullYear(), month.getMonth()),
    [month]
  );

  const { jobs, loading: jobsLoading, error: jobsError } = useCompanyJobs({
    from: mStart,
    to: mEnd,
  });

  // Group by day (job_date preferred, else derived from start)
  const jobsByDay = useMemo(() => {
    const map = new Map();
    const add = (key, item) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    };
    for (const j of (jobs || [])) {
      const rawJD = j.raw?.job_details || j.job_details || {};
      // 🔒 Exclude cancelled jobs at the source
      const status = (rawJD?.status || "").toString().toLowerCase();
      if (status === "cancelled") continue;

      const start =
        j.start ||
        rawJD?.job_start_timestamp?.toDate?.() ||
        (rawJD?.job_start_iso ? new Date(rawJD.job_start_iso) : null);

      const keyJob =
        rawJD?.job_date ||
        (start ? dateKeyInTZ(start, j.timezone || rawJD.timezone) : null);
      const keyLocal = start ? dateKeyInTZ(start) : null;

      if (keyJob) add(keyJob, j);
      else if (keyLocal) add(keyLocal, j);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const as =
          a.start ||
          a.job_details?.job_start_timestamp?.toDate?.() ||
          (a.job_details?.job_start_iso ? new Date(a.job_details.job_start_iso) : 0) ||
          0;
        const bs =
          b.start ||
          b.job_details?.job_start_timestamp?.toDate?.() ||
          (b.job_details?.job_start_iso ? new Date(b.job_details.job_start_iso) : 0) ||
          0;
        return (as?.getTime?.() || 0) - (bs?.getTime?.() || 0);
      });
    }
    return map;
  }, [jobs]);

  const days = useMemo(() => buildMonthGrid(month), [month]);

  const goto = useCallback((offset) => {
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + offset, 1));
    setMobilePicked(null);
  }, []);

  const monthLabel = useMemo(
    () => month.toLocaleString(undefined, { month: "long", year: "numeric" }),
    [month]
  );

  const isSame = (d1, d2) => !!d1 && !!d2 && sameDay(d1, d2);

  const jobsForDate = useCallback(
    (d) => {
      const keyLocal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
      // Extra safety: filter out cancelled even if they somehow slipped past grouping
      const list = jobsByDay.get(keyLocal) || [];
      return list.filter((j) => {
        const jd = j.job_details || j.raw?.job_details || {};
        const status = (jd?.status || "").toString().toLowerCase();
        return status !== "cancelled";
      });
    },
    [jobsByDay]
  );

  const pickedJobs = mobilePicked ? jobsForDate(mobilePicked) : [];

  const headerStatus = jobsLoading
    ? <span className="ml-2 text-xs text-gray-500 align-middle">• loading…</span>
    : jobsError
    ? <span className="ml-2 text-xs text-amber-700 align-middle">• {jobsError.message || "error"}</span>
    : null;

  return (
    <div className="w-full h-full bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 md:px-8 xl:px-10 2xl:px-28 py-3 border-b border-gray-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
        <button
          onClick={() => goto(-1)}
          className="xl:hidden inline-flex items-center justify-center h-10 w-10 rounded-lg border border-gray-200 hover:bg-gray-50"
          aria-label="Previous month"
        >
          <span className="text-2xl leading-none select-none">‹</span>
        </button>

        <div className="text-base sm:text-lg font-semibold text-gray-900 mx-2 xl:mx-0 inline-flex items-center">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={`${month.getFullYear()}-${month.getMonth()}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              {monthLabel}
            </motion.span>
          </AnimatePresence>
          {headerStatus}
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => goto(-1)}
            className="hidden xl:inline-flex px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
            aria-label="Previous month"
          >
            <span className="text-2xl leading-none select-none">‹</span>
          </button>
          <button
            onClick={() => goto(1)}
            className="inline-flex items-center justify-center h-10 w-10 xl:h-auto xl:w-auto xl:px-3 xl:py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
            aria-label="Next month"
          >
            <span className="text-2xl leading-none select-none">›</span>
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 px-2 sm:px-4 md:px-6 xl:px-10 2xl:px-28 pb-4 md:pb-6 pt-3 md:pt-4 min-h-0">
        {/* Day names */}
        <div className="max-w-[1200px] mx-auto w-full grid grid-cols-7 text-[10px] sm:text-xs font-medium text-gray-500 mb-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="text-center uppercase tracking-wide">
              {d}
            </div>
          ))}
        </div>

        {/* Month grid */}
        <motion.div
          key={`${month.getFullYear()}-${month.getMonth()}-grid`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
          className="max-w-[1200px] mx-auto w-full grid grid-cols-7 gap-1.5 sm:gap-2 xl:gap-3 min-h-0"
        >
          {days.map((d, i) => {
            const isCurrentMonth = d.getMonth() === month.getMonth();
            const isToday = sameDay(d, today);
            const isPast = d < today;
            const isSelectedExternal = selectedDate && sameDay(d, selectedDate);
            const isSelectedMobile = isSame(d, mobilePicked);

            const dayJobs = jobsForDate(d);
            const dotCount = Math.min(dayJobs.length, 3);
            const hasNoShow = dayJobs.some(isWorkerNoShow);
            const borderClass = isSelectedExternal
              ? "border-gray-900 ring-2 ring-gray-900/60"
              : isCurrentMonth
              ? "border-gray-200"
              : "border-gray-100 opacity-60";

            return (
              <motion.div
                key={i}
                layout
                className={[
                  "group relative rounded-xl border-[1.75px] bg-white transition-transform duration-200 ease-out",
                  "xl:hover:shadow-sm xl:hover:-translate-y-[1px]",
                  borderClass,
                  // Square tiles on phones/tablets; desktop fills height naturally
                  "aspect-square xl:aspect-auto xl:min-h-[112px] 2xl:min-h-[128px]",
                  "touch-manipulation",
                  isSelectedMobile ? "ring-2 ring-gray-900/70" : "",
                ].join(" ")}
              >
                {/* Click/tap surface (mobile+tablet select) */}
                <button
                  type="button"
                  onClick={() => setMobilePicked(d)}
                  className="absolute inset-0 xl:hidden rounded-xl"
                  aria-label={`Select ${d.toDateString()}`}
                />

                {/* Date label */}
                <div className="p-1.5 sm:p-2">
                  <span
                    className={[
                      "inline-flex items-center justify-center h-7 w-7 rounded-full text-[13px] sm:text-sm font-medium",
                      // Mobile/tablet: outlined today; Desktop: filled today
                      isToday
                        ? "border border-gray-900 text-gray-900 xl:bg-gray-900 xl:text-white xl:border-transparent"
                        : "text-gray-700 hover:bg-gray-100 xl:hover:bg-transparent",
                    ].join(" ")}
                  >
                    {d.getDate()}
                  </span>
                </div>

                {/* Desktop: stable rail (2 pills) */}
                <DayRail jobs={dayJobs} loading={jobsLoading} />

                {/* MOBILE + TABLET: bottom-centered tiny dots (1–3) */}
                <div className="xl:hidden pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-1.5 flex items-center gap-1">
                  {Array.from({ length: dotCount }).map((_, idx) => {
                    // If any job is a worker no show, the *first* dot is amber.
                    // Remaining dots stay green.
                    const colorClass =
                      hasNoShow && idx === 0 ? "bg-amber-500" : "bg-emerald-500";

                    return (
                      <span
                        key={idx}
                        className={`h-1.5 w-1.5 rounded-full ${colorClass}`}
                      />
                    );
                  })}
                </div>

                {/* Desktop hover actions */}
                <div
                  className={[
                    "hidden xl:flex pointer-events-none absolute inset-0 rounded-xl",
                    "bg-white/90 opacity-0 group-hover:opacity-100",
                    "transition-opacity duration-200 ease-out",
                    "items-center justify-center",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "pointer-events-auto flex gap-2",
                      "opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0",
                      "transition-all duration-200 ease-out",
                    ].join(" ")}
                  >
                    {!isPast && (
                      <button
                        onClick={() => onBookDay(d)}
                        className="px-3 py-1.5 rounded-full bg-gray-900 text-white text-sm shadow-sm hover:shadow transition-shadow"
                      >
                        Book
                      </button>
                    )}
                    <button
                      onClick={() => onViewDay(d)}
                      className="px-3 py-1.5 rounded-full bg-white text-gray-900 border border-gray-200 text-sm hover:bg-gray-50"
                    >
                      View
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      {/* MOBILE/TABLET bottom sheet */}
      <AnimatePresence>
        {mobilePicked && (
          <motion.div
            initial={{ y: 56, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 56, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="xl:hidden fixed inset-x-0 bottom-0 z-20"
          >
            <div className="mx-4 mb-[max(10px,env(safe-area-inset-bottom))] rounded-3xl border border-gray-200 bg-white shadow-2xl">
              <div className="px-5 pt-4 pb-3">
                <div className="text-sm text-gray-500 mb-1">Selected</div>
                <div className="text-xl font-semibold text-gray-900">
                  {mobilePicked.toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>
              </div>
              <div className="max-h-56 overflow-auto px-5 pb-3 flex flex-col gap-1.5">
                {pickedJobs.length ? (
                  pickedJobs.map((j) => <JobPill key={`m-${j.id}`} job={j} />)
                ) : (
                  <div className="text-sm text-gray-500">No jobs scheduled.</div>
                )}
              </div>
              <div className="px-5 pb-5 grid grid-cols-3 gap-2">
                {mobilePicked >= today ? (
                  <button
                    onClick={() => { onBookDay(mobilePicked); setMobilePicked(null); }}
                    className="h-12 rounded-full bg-gray-900 text-white text-base font-medium shadow-sm"
                  >
                    Book
                  </button>
                ) : (
                  <div className="h-12" />
                )}
                <button
                  onClick={() => { onViewDay(mobilePicked); setMobilePicked(null); }}
                  className="h-12 rounded-full border border-gray-200 bg-white text-gray-900 text-base font-medium"
                >
                  View
                </button>
                <button
                  onClick={() => setMobilePicked(null)}
                  className="h-12 rounded-full border border-gray-200 text-gray-700 text-base font-medium"
                  aria-label="Close"
                  title="Close"
                >
                  Close
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
