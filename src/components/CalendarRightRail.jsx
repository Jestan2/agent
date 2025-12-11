// src/components/CalendarRightRail.jsx
import { useMemo, useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useCompanyJobs } from "../lib/useCompanyJobs";

/* ----------------------- Helpers (shared) ----------------------- */
function nextBookableHourToday(now) {
  const n = new Date(now);
  const hasMinutes = n.getMinutes() || n.getSeconds() || n.getMilliseconds();
  if (hasMinutes) n.setHours(n.getHours() + 1, 0, 0, 0);
  n.setHours(n.getHours() + 1);
  return n.getHours();
}
function formatLocalTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = String(hhmm).split(":").map(Number);
  const d = new Date(2000, 0, 1, isNaN(h) ? 0 : h, isNaN(m) ? 0 : m);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    hourCycle: "h12",
  });
}
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function safeService(jd) {
  return (jd?.services_requested?.[0] || jd?.service || "Job").toString();
}
function safeWorkers(jd) {
  return (
    jd?.workers ||
    jd?.workers_required ||
    jd?.num_workers ||
    jd?.requested_workers ||
    jd?.headcount ||
    1
  );
}
function safeDurationMinutes(jd, start, end) {
  if (jd?.duration_minutes) return Number(jd.duration_minutes);
  if (jd?.duration_hours) return Math.round(Number(jd.duration_hours) * 60);
  if (jd?.estimated_duration_hours)
    return Math.round(Number(jd.estimated_duration_hours) * 60);
  if (jd?.duration != null && !isNaN(Number(jd.duration))) {
    return Math.round(Number(jd.duration) * 60);
  }
  if (end && start) return Math.max(30, Math.round((end - start) / 60000));
  return 120;
}

/** City/State only (no street) */
function locationCityState(jd) {
  const c1 = jd?.address?.city || jd?.city || jd?.location?.city;
  const s1 =
    jd?.address?.state ||
    jd?.state ||
    jd?.location?.region ||
    jd?.location?.state;
  const cs = [c1, s1].filter(Boolean).join(", ");
  return cs.trim();
}

function toDateMaybe(v) {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  if (typeof v === "string") return new Date(v);
  return v instanceof Date ? v : null;
}
function fmtDuration(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
}

/** hour/minute of a Date in a specific IANA timezone */
function hmInTZ(date, tz) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return { h, m };
  } catch {
    return { h: date.getHours(), m: date.getMinutes() };
  }
}

/** Simple 12h label for the axis (avoids DST quirks) */
function formatHourLabel(h) {
  const hh = ((h + 11) % 12) + 1;
  const ampm = h < 12 ? "AM" : "PM";
  return `${hh} ${ampm}`;
}

/** “2:00 PM – 4:00 PM” in a given tz */
function timeRangeLabel(start, end, tz) {
  const fmt = (d) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  const endIsNextDay = end.getDate() !== start.getDate();
  return `${fmt(start)} – ${fmt(end)}${endIsNextDay ? " (next day)" : ""}`;
}

/** format single time in tz */
function fmtTimeTZ(d, tz) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** returns decimal hour 0..23.999 in tz */
function hourFloatInTZ(date, tz) {
  const { h, m } = hmInTZ(date, tz);
  return h + m / 60;
}

/* ---------------------- View: slotted timeline ---------------------- */
const DAY_START = 7;     // 7 AM
const DAY_END = 22;      // 10 PM label
const WINDOW_END = 23;   // exclusive end (10 PM label means window to 11 PM)

const ROW_H = 44;        // px per hour (desktop / tablet overlay)
const ROW_H_M = 36;      // px per hour (mobile)
const GAP_PX = 4;        // gap between columns

function hourLabels(start = DAY_START, end = DAY_END) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/* ---------------- Skeleton atoms (fixed overlay, no reflow) ---------- */
function SkelBar({ className = "" }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className}`} />;
}

/* ---------- Issue + theme ---------- */
function isWorkerNoShow(job) {
  return job?.issue?.tag === "worker_no_show";
}

function themeForTimeline(job) {
  if (isWorkerNoShow(job)) {
    return {
      cardBg: "bg-amber-50",
      cardBorder: "border-amber-200",
      cardText: "text-amber-900",
      cardHover: "hover:border-amber-300",
      cardRing: "focus:ring-amber-200",
      gradTop: "to-amber-100/70",
      gradBottom: "to-amber-100/80",
      gradText: "text-amber-700/80",
      accent: "bg-amber-400/90",
      chipBorder: "border-amber-200",
      chipBg: "bg-amber-50",
      chipText: "text-amber-900",
      chipHover: "hover:border-amber-300",
    };
  }
  return {
    cardBg: "bg-emerald-50",
    cardBorder: "border-emerald-200",
    cardText: "text-emerald-900",
    cardHover: "hover:border-emerald-300",
    cardRing: "focus:ring-emerald-200",
    gradTop: "to-emerald-100/70",
    gradBottom: "to-emerald-100/80",
    gradText: "text-emerald-700/80",
    accent: "bg-emerald-400/90",
    chipBorder: "border-emerald-200",
    chipBg: "bg-emerald-50",
    chipText: "text-emerald-900",
    chipHover: "hover:border-emerald-300",
  };
}

/** Fixed-height timeline that never unmounts.
 *  - No layout jump: grid height is constant.
 *  - Cross-midnight jobs: we clip only by window times (no post-clamp nudging).
 *  - Overlaps: Calendar-style columns with “+N more” when too many.
 *  - Click any block/chip to open the job details route.
 */
function TimelineBase({ jobs, axisTZ, rowH, mobile = false, showSkeleton, onOpenJob }) {
  const hours = hourLabels();
  const frameH = (WINDOW_END - DAY_START) * rowH; // fixed container height
  const isEmpty = !showSkeleton && jobs.length === 0;

  // y-position helper that matches hour-line placement (mid-row)
  const toY = (hrFloat) => (hrFloat - DAY_START + 0.5) * rowH;

  // Precomputed placeholder blocks (deliberate = no jitter)
  const blocks = mobile
    ? [
        { topHr: 9, durHrs: 1.0 },
        { topHr: 13, durHrs: 1.0 },
        { topHr: 16, durHrs: 0.8 },
      ]
    : [
        { topHr: 9, durHrs: 1.1 },
        { topHr: 13, durHrs: 1.3 },
        { topHr: 16, durHrs: 1.0 },
      ];

  // Split jobs into visible segments + overflows (top/bottom)
  const visible = [];
  const overflowTop = [];
  const overflowBottom = [];

  for (const j of jobs) {
    const tz = j.tz || axisTZ;
    let s = hourFloatInTZ(j.start, tz);
    let e = hourFloatInTZ(j.end, tz);
    if (e <= s) e += 24; // cross-midnight normalization

    const clippedStart = Math.max(DAY_START, Math.min(s, WINDOW_END));
    const clippedEnd = Math.max(DAY_START, Math.min(e, WINDOW_END));
    const intersects = s < WINDOW_END && e > DAY_START && clippedEnd > clippedStart;

    const topClip = s < DAY_START;
    const bottomClip = e > WINDOW_END;

    if (intersects) {
      const topPx = toY(clippedStart);
      const endPx = toY(clippedEnd);
      const heightPx = Math.max(1, endPx - topPx); // exact mapping, no nudge

      visible.push({
        j,
        tz,
        topPx,
        heightPx,
        topClip,
        bottomClip,
        startF: clippedStart,
        endF: clippedEnd,
        rangeLabel: timeRangeLabel(j.start, j.end, tz),
      });
    } else {
      // Fully outside window
      if (e <= DAY_START || (s < DAY_START && e <= DAY_START)) {
        overflowTop.push({ j, tz });
      } else if (s >= WINDOW_END || (s >= WINDOW_END && e > WINDOW_END)) {
        overflowBottom.push({ j, tz });
      }
    }
  }

  // ---- Overlap layout: cluster -> columns -> (cap with +N more) ----
  visible.sort((a, b) => a.startF - b.startF || a.endF - b.endF);

  const MAX_COLS = mobile ? 2 : 3;
  const laidOut = [];
  const overflowBadges = [];

  let i = 0;
  while (i < visible.length) {
    // Build a cluster (any overlapping in time)
    const cluster = [];
    let clusterEnd = -Infinity;
    let k = i;
    while (k < visible.length) {
      const ev = visible[k];
      if (cluster.length === 0 || ev.startF < clusterEnd) {
        cluster.push(ev);
        clusterEnd = Math.max(clusterEnd, ev.endF);
        k++;
      } else {
        break;
      }
    }

    // Assign columns greedily
    const cols = []; // each col holds current endF
    for (const ev of cluster) {
      let placed = false;
      for (let c = 0; c < cols.length; c++) {
        if (cols[c] <= ev.startF) {
          cols[c] = ev.endF;
          ev.col = c;
          placed = true;
          break;
        }
      }
      if (!placed) {
        ev.col = cols.length;
        cols.push(ev.endF);
      }
    }

    const totalCols = cols.length;
    const hasOverflow = totalCols > MAX_COLS;
    const showCols = hasOverflow ? MAX_COLS - 1 : totalCols; // reserve 1 col for +N
    const shownColsTotal = hasOverflow ? MAX_COLS : totalCols;

    const colWidthPct = 100 / shownColsTotal;
    let hiddenCount = 0;

    for (const ev of cluster) {
      if (hasOverflow && ev.col >= showCols) {
        hiddenCount++;
        continue;
      }
      const leftPct = ev.col * colWidthPct;
      const leftPx = ev.col * GAP_PX;
      const width = `calc(${colWidthPct}% - ${GAP_PX}px)`;
      const left = `calc(${leftPct}% + ${leftPx}px)`;

      laidOut.push({
        ...ev,
        left,
        width,
      });
    }

    if (hasOverflow && hiddenCount > 0) {
      const clusterTop = Math.min(...cluster.map((e) => e.topPx));
      const badgeTop = Math.max(0, Math.min(clusterTop + 4, frameH - 24));
      const badgeCol = shownColsTotal - 1;
      const leftPct = badgeCol * colWidthPct;
      const leftPx = badgeCol * GAP_PX;
      const width = `calc(${colWidthPct}% - ${GAP_PX}px)`;
      const left = `calc(${leftPct}% + ${leftPx}px)`;
      overflowBadges.push({ top: badgeTop, left, width, count: hiddenCount });
    }

    i = k;
  }

  // Container height locked by rows -> zero layout jump.
  return (
    <div className="relative overflow-hidden">
      {/* Hour grid (always rendered) */}
      {hours.map((h) => (
        <div key={h} className="relative flex" style={{ height: rowH }}>
          <div className="w-16 shrink-0 pr-3 text-[12px] text-gray-500 text-right flex items-center justify-end">
            {formatHourLabel(h)}
          </div>
          <div className="flex-1 relative">
            {/* hour line drawn at the row midpoint */}
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-gray-200" />
          </div>
        </div>
      ))}

      {/* Layer: content blocks */}
      <motion.div
        className="absolute inset-0 ml-16 mr-1"
        animate={{ opacity: showSkeleton ? 0 : 1 }}
        transition={{ duration: 0.18 }}
        style={{ pointerEvents: showSkeleton ? "none" : "auto" }}
      >
        {laidOut.map(({ j, tz, topPx, heightPx, topClip, bottomClip, rangeLabel, left, width }) => {
          const t = themeForTimeline(j);
          return (
          <div
            key={j.id}
            role="button"
           tabIndex={0}
            onClick={() => onOpenJob?.(j)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpenJob?.(j)}
            className={`absolute rounded-lg ${t.cardBg} border ${t.cardBorder} ${t.cardText} shadow-[0_1px_0_rgba(0,0,0,0.04)] cursor-pointer ${t.cardHover} hover:shadow-sm focus:outline-none focus:ring-2 ${t.cardRing}`}
            style={{ top: topPx, height: heightPx, left, width }}
            title={`${rangeLabel} • ${j.service}${j.locCityState ? " • " + j.locCityState : ""} • ${j.workers} worker(s) • ${fmtDuration(j.durationMin)}`}
          >
            {/* Clip hints (kept inside the card; container hides overflow) */}
            {topClip && (
              <>
                <div className={`absolute top-0 left-0 right-0 h-4 bg-gradient-to-t from-transparent ${t.gradTop} rounded-t-lg pointer-events-none`} />
                <div className={`absolute top-0.5 right-1 text-[10px] ${t.gradText} pointer-events-none`}>cont. ↑</div>
              </>
            )}
            {bottomClip && (
              <>
                <div className={`absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-b from-transparent ${t.gradBottom} rounded-b-lg pointer-events-none`} />
                <div className={`absolute bottom-1 right-1 text-[10px] ${t.gradText} pointer-events-none`}>→ cont.</div>
              </>
            )}

            <div className="h-full w-full px-3 py-2 flex flex-col justify-center">
              <div className="text-[12px] font-semibold leading-5 truncate">
                <span className="tabular-nums">{rangeLabel}</span> · {j.service}
              </div>
              <div className="text-[12px] leading-5 text-gray-700/90 truncate">
                {j.locCityState ? j.locCityState + " · " : ""}
                {j.workers} worker{j.workers === 1 ? "" : "s"} · {fmtDuration(j.durationMin)}
              </div>
            </div>
            <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-lg ${t.accent}`} />
          </div>
      );
      })}

        {/* "+N more" overflow badges for dense clusters */}
        {overflowBadges.map((b, idx) => (
          <div
            key={`badge-${idx}`}
            className="absolute flex items-center justify-center px-2 py-1 rounded-full border border-gray-200 bg-white text-gray-700 text-[12px] shadow-sm select-none"
            style={{ top: b.top, left: b.left, width: b.width, height: 24 }}
            title={`${b.count} more overlapping jobs`}
          >
            +{b.count} more
          </div>
        ))}

        {/* Late-night chips pinned at bottom (jobs fully after WINDOW_END) */}
        {overflowBottom.length > 0 && (
          <div className="absolute left-0 right-0 bottom-2 ml-16 mr-1 flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-gray-500 select-none">Late night</span>
            {overflowBottom.slice(0, 2).map(({ j, tz }) => {
              const t = themeForTimeline(j);
              return (
                <button
                  key={`late-${j.id}`}
                  type="button"
                  onClick={() => onOpenJob?.(j)}
                  className={`px-2.5 py-1 rounded-full border ${t.chipBorder} ${t.chipBg} ${t.chipText} text-[12px] shadow-[0_1px_0_rgba(0,0,0,0.03)] ${t.chipHover}`}
                  title={`${timeRangeLabel(j.start, j.end, tz)} • ${j.service}`}
                >
                  {fmtTimeTZ(j.start, tz)} – {fmtTimeTZ(j.end, tz)}
                  {j.end.getDate() !== j.start.getDate() ? " (+1)" : ""} · {j.service}
                </button>
              );
            })}
            {overflowBottom.length > 2 && (
              <div className="px-2.5 py-1 rounded-full border border-gray-200 bg-white text-gray-700 text-[12px] select-none">
                +{overflowBottom.length - 2} more
              </div>
            )}
          </div>
        )}

        {/* Early jobs chips (fully before DAY_START) — rare but supported */}
        {overflowTop.length > 0 && (
          <div className="absolute left-0 right-0 top-2 ml-16 mr-1 flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-gray-500 select-none">Early</span>
            {overflowTop.slice(0, 2).map(({ j, tz }) => {
              const t = themeForTimeline(j);
              return (
                <button
                  key={`early-${j.id}`}
                  type="button"
                  onClick={() => onOpenJob?.(j)}
                  className={`px-2.5 py-1 rounded-full border ${t.chipBorder} ${t.chipBg} ${t.chipText} text-[12px] shadow-[0_1px_0_rgba(0,0,0,0.03)] ${t.chipHover}`}
                  title={`${timeRangeLabel(j.start, j.end, tz)} • ${j.service}`}
                >
                  {fmtTimeTZ(j.start, tz)} – {fmtTimeTZ(j.end, tz)}
                  {j.end.getDate() !== j.start.getDate() ? " (+1)" : ""} · {j.service}
                </button>
              );
            })}
            {overflowTop.length > 2 && (
              <div className="px-2.5 py-1 rounded-full border border-gray-200 bg-white text-gray-700 text-[12px] select-none">
                +{overflowTop.length - 2} more
              </div>
            )}
          </div>
        )}
      </motion.div>

      {/* Layer: skeleton */}
      <motion.div
        className="absolute inset-0 ml-16 mr-1 pointer-events-none"
        animate={{ opacity: showSkeleton ? 1 : 0 }}
        transition={{ duration: 0.18 }}
      >
        {blocks.map((b, i) => {
          const top = toY(b.topHr);
          const height = Math.max(12, b.durHrs * rowH);
          return (
            <div
              key={i}
              className="absolute left-0 right-0 rounded-lg border border-gray-200 bg-gray-100/80"
              style={{ top, height }}
            >
              <div className="h-full w-full px-3 py-2">
                <SkelBar className="h-3 w-28 mb-2" />
                <SkelBar className="h-3 w-40" />
              </div>
            </div>
          );
        })}
      </motion.div>

      {/* Layer: empty state (centered, overlay, no reflow) */}
      <motion.div
        className="absolute inset-0 ml-16 mr-1 grid place-items-center pointer-events-none"
        animate={{ opacity: isEmpty ? 1 : 0 }}
        transition={{ duration: 0.18 }}
      >
        <div className="text-[13px] text-gray-500">No jobs scheduled.</div>
      </motion.div>
    </div>
  );
}

/** Desktop / Tablet overlay */
function SlottedDay({ jobs, axisTZ, flat = false, showSkeleton = false, onOpenJob }) {
  return (
    <div className={flat ? "p-0" : "xl:bg-white xl:rounded-2xl xl:border xl:border-gray-200 xl:p-4"}>
      <div className="text-[13px] font-semibold text-[#04193b] mb-3">Timeline</div>
      <TimelineBase jobs={jobs} axisTZ={axisTZ} rowH={ROW_H} showSkeleton={showSkeleton} onOpenJob={onOpenJob} />
    </div>
  );
}

/** Mobile */
function SlottedDayCompact({ jobs, axisTZ, flat = true, showSkeleton = false, onOpenJob }) {
  return (
    <div className={flat ? "p-0" : "xl:bg-white xl:rounded-2xl xl:border xl:border-gray-200 xl:p-3"}>
      {!flat && <div className="text-[13px] font-semibold text-[#04193b] mb-2">Timeline</div>}
      <TimelineBase jobs={jobs} axisTZ={axisTZ} rowH={ROW_H_M} mobile showSkeleton={showSkeleton} onOpenJob={onOpenJob} />
    </div>
  );
}

/* ----------------------- Main component ------------------------ */
export default function CalendarRightRail({
  open = false,
  mode = "book", // "book" | "view"
  date = null,   // JS Date
  onClose,
  onPickTime,    // (hh:mm) -> void
}) {
  const navigate = useNavigate();

  const openJob = useCallback(
    (job) => {
      if (!job?.id) return;
      navigate(`/job/${job.id}`);
      onClose?.(); // close the sheet on mobile/tablet overlays
    },
    [navigate, onClose]
  );

  const pretty = useMemo(() => {
    if (!date) return "—";
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }, [date]);

  const timeSlots = useMemo(() => {
    if (!date) return [];
    const d = startOfDay(date);
    const today = startOfDay(new Date());
    const isToday =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();

    const START_HOUR = isToday ? Math.max(nextBookableHourToday(new Date()), 7) : 7;
    const END_HOUR = 22;

    if (START_HOUR > END_HOUR) return [];
    const slots = [];
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      const hh = String(h).padStart(2, "0");
      slots.push(`${hh}:00`);
    }
    return slots;
  }, [date]);

  /* --------------------- Jobs for the selected day --------------------- */
  const dayFrom = date ? startOfDay(date) : null;
  const dayTo = date ? endOfDay(date) : null;

  const { jobs: rawJobs = [], loading: jobsLoading = false } = useCompanyJobs(
    dayFrom && dayTo ? { from: dayFrom, to: dayTo } : { from: null, to: null }
  );

  const jobsForDay = useMemo(() => {
    if (!date) return [];
    return rawJobs
      .filter((j) => {
        const jd = j.job_details || j.raw?.job_details || {};
        const status = (jd?.status || "").toString().toLowerCase();
        return status !== "cancelled"; // 🚫 exclude cancelled
      })
      .map((j) => {
        const jd = j.job_details || j.raw?.job_details || {};
        const start =
          j.start ||
          toDateMaybe(jd.job_start_timestamp) ||
          toDateMaybe(jd.job_start_iso);
        const end =
          j.end ||
          toDateMaybe(jd.job_end_timestamp) ||
          toDateMaybe(jd.job_end_iso);
        const durationMin = safeDurationMinutes(jd, start, end);
        const service = safeService(jd);
        const workers = safeWorkers(jd);
        const locCityState = locationCityState(jd);
        const tz =
          jd?.timezone ||
          j.timezone ||
          Intl.DateTimeFormat().resolvedOptions().timeZone;

        const endRef =
          end || (start ? new Date(start.getTime() + durationMin * 60000) : null);

        return {
          id: j.id,
          start,
          end: endRef,
          durationMin,
          service,
          workers,
          locCityState,
          tz,
          issue: j.issue || j.raw?.issue || null,
        };
      })
      .filter((x) => x.start instanceof Date && x.end instanceof Date && !isNaN(x.start))
      .sort((a, b) => a.start - b.start);
  }, [rawJobs, date]);

  // Axis tz is stable
  const axisTZ = useMemo(
    () => jobsForDay[0]?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone,
    [jobsForDay]
  );

  // --- Early return still OK (desktop/tablet rely on open) ---
  if (!open) return null;

  // --- Close on ESC & lock background scroll (mobile) ---
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("overflow-hidden");
    document.body.classList.add("overflow-hidden");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("overflow-hidden");
      document.body.classList.remove("overflow-hidden");
    };
  }, [onClose]);

  /* --------- Clean gating (opacity only) to avoid any jump ---------- */
  const [showSkeleton, setShowSkeleton] = useState(true);
  useEffect(() => {
    setShowSkeleton(true);
  }, [date]);

  useEffect(() => {
    if (jobsLoading) return setShowSkeleton(true);
    const t = setTimeout(() => setShowSkeleton(false), 180);
    return () => clearTimeout(t);
  }, [jobsLoading]);

  return (
    <>
      {/* INLINE RIGHT RAIL — xl+ only */}
      <aside className="hidden xl:flex flex-col border-l border-gray-200 bg-white sticky top-[56px] h-[calc(100dvh-56px)] overflow-y-auto overflow-x-hidden">
        <div className="w-[320px] 2xl:w-[360px] p-5 space-y-6">
          <Header mode={mode} onClose={onClose} />
          <div className="text-[14px] text-gray-600">{pretty}</div>

          {mode === "book" ? (
            <BookList timeSlots={timeSlots} onPickTime={onPickTime} />
          ) : (
            <SlottedDay jobs={jobsForDay} axisTZ={axisTZ} showSkeleton={showSkeleton} onOpenJob={openJob} />
          )}
        </div>
      </aside>

      {/* TABLET OVERLAY — lg..xl */}
      <div className="hidden lg:block xl:hidden h-full bg-white border-l border-gray-200 shadow-2xl">
        <div className="px-5 pt-5 pb-6 space-y-4 overflow-auto">
          <Header mode={mode} onClose={onClose} />
          <div className="text-[14px] text-gray-600">For {pretty}</div>

          {mode === "book" ? (
            <BookList flat timeSlots={timeSlots} onPickTime={onPickTime} />
          ) : (
            <SlottedDay
              flat
              jobs={jobsForDay}
              axisTZ={axisTZ}
              showSkeleton={showSkeleton}
              onOpenJob={openJob}
            />
          )}
        </div>
      </div>

      {/* MOBILE — bottom sheet */}
      <motion.div
        key="mb-backdrop"
        className="lg:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.div
        key="mb-sheet"
        role="dialog"
        aria-modal="true"
        className="lg:hidden fixed inset-x-0 bottom-0 z-50"
        initial={{ y: 56, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 56, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.04}
        onDragEnd={(_, info) => {
          if (info.offset.y > 80 || info.velocity.y > 800) onClose?.();
        }}
      >
        <div className="mx-3 mb-[max(10px,env(safe-area-inset-bottom))] rounded-3xl border border-gray-200 bg-white shadow-2xl">
          {/* grabber */}
          <div className="relative h-6">
            <div className="absolute left-1/2 -translate-x-1/2 top-2 h-1.5 w-12 rounded-full bg-gray-300" />
          </div>

          <div className="px-4 pb-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold text-[#04193b]">
                {mode === "book" ? "Select a time" : "Day schedule"}
              </h2>
              <button
                onClick={onClose}
                className="h-8 w-8 grid place-items-center rounded-md border border-gray-200 bg-white hover:bg-gray-50"
                aria-label="Close"
                title="Close"
              >
                ×
              </button>
            </div>

            <div className="text-[13px] text-gray-500">For {pretty}</div>

            {mode === "book" ? (
              <BookGrid flat timeSlots={timeSlots} onPickTime={onPickTime} />
            ) : (
              <div className="max-h-[60vh] overflow-auto pr-1">
                <SlottedDayCompact
                  flat
                  jobs={jobsForDay}
                  axisTZ={axisTZ}
                  showSkeleton={showSkeleton}
                  onOpenJob={openJob}
                />
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                onClick={onClose}
                className="h-10 px-3 rounded-full border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50"
                aria-label="Close"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  );
}

/** — Components — */
function Header({ mode, onClose }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-[16px] pt-2 font-semibold text-[#04193b]">
        {mode === "book" ? "Select a time" : "Day schedule"}
      </h2>
      <button
        onClick={onClose}
        className="h-8 w-8 grid place-items-center rounded-md border border-gray-200 bg-white hover:bg-gray-50"
        aria-label="Close"
        title="Close"
      >
        ×
      </button>
    </div>
  );
}

/* ---------------------- Booking (responsive chrome) ---------------------- */
function BookList({ timeSlots, onPickTime, flat = false }) {
  return (
    <div className={flat ? "p-0" : "xl:bg-white xl:rounded-2xl xl:border xl:border-gray-200 xl:p-4"}>
      <div className="text-[13px] font-semibold text-[#04193b] mb-3">
        Available times
      </div>
      {timeSlots.length === 0 ? (
        <div className="text-[13px] text-gray-500">No times left today. Please pick a different day.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {timeSlots.map((t) => (
            <button
              key={t}
              onClick={() => onPickTime?.(t)}
              className="w-full h-11 rounded-2xl border border-gray-200 bg-white
                         text-[14px] font-medium text-[#04193b]
                         hover:border-[#04193b] hover:shadow-sm transition"
            >
              {formatLocalTime(t)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BookGrid({ timeSlots, onPickTime, flat = false }) {
  if (!timeSlots?.length) {
    return (
      <div className={flat ? "p-0" : "xl:bg-white xl:rounded-2xl xl:border xl:border-gray-200 xl:p-4"}>
        <div className="text-[13px] text-gray-500">No times left today. Please pick a different day.</div>
      </div>
    );
  }
  return (
    <div className={flat ? "p-0" : "xl:bg-white xl:rounded-2xl xl:border xl:border-gray-200 xl:p-3"}>
      {!flat && <div className="text-[13px] font-semibold text-[#04193b] mb-2">Available times</div>}
      <div className="grid grid-cols-3 gap-2">
        {timeSlots.map((t) => (
          <button
            key={t}
            onClick={() => onPickTime?.(t)}
            className="h-10 rounded-xl border border-gray-200 bg-white
                       text-[13px] font-medium text-[#04193b]
                       hover:border-[#04193b] hover:shadow-sm transition"
          >
            {formatLocalTime(t)}
          </button>
        ))}
      </div>
    </div>
  );
}
