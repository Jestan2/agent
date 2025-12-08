// src/components/JobActivity.jsx
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import {
  doc,
  getDoc,
  collection,
  query,
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { motion, AnimatePresence } from "framer-motion";
import { db } from "../lib/firebase";

import { useAuth } from "../context/AuthContext";
import {
  editBookingDateTime,
  editBookingAddress,
  editBookingOnsitePhone,
  addressNormalize,
} from "../lib/api";

// NEW: scroll-to-bottom jumper
import ScrollToBottom from "./ScrollToBottom";

/* ----------------------------- Shared utilities ---------------------------- */

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function formatPrettyStamp(val, withTime = true, tz) {
  if (!val) return "";
  let d;
  try {
    if (typeof val?.toDate === "function") d = val.toDate();
    else d = new Date(val);
  } catch {
    return "";
  }
  if (Number.isNaN(d?.getTime?.())) return "";

  const month = d.toLocaleString(undefined, { month: "long", timeZone: tz });
  const day = ordinal(
    Number(d.toLocaleString(undefined, { day: "numeric", timeZone: tz }))
  );
  const year = d.toLocaleString(undefined, { year: "numeric", timeZone: tz });
  const dateStr = `${month} ${day}, ${year}`;
  if (!withTime) return dateStr;

  const timeStr = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
  return `${dateStr} at ${timeStr}`;
}
function formatTimeOnly(val, tz) {
  if (!val) return "";
  let d;
  try {
    if (typeof val?.toDate === "function") d = val.toDate();
    else d = new Date(val);
  } catch {
    return "";
  }
  if (Number.isNaN(d?.getTime?.())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}
function prettyPhone(s) {
  const d = String(s || "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length <= 3) return ten;
  if (ten.length <= 6) return `(${ten.slice(0, 3)}) ${ten.slice(3)}`;
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6, 10)}`;
}
function isHHmm(s) {
  return typeof s === "string" && /^\d{1,2}:\d{2}$/.test(s) && !/[AP]M/i.test(s);
}
function toAmPm(hhmmOrAmPm) {
  if (!hhmmOrAmPm) return "";
  if (/[AP]M/i.test(hhmmOrAmPm)) return hhmmOrAmPm;
  if (isHHmm(hhmmOrAmPm)) {
    const [hh, mm] = hhmmOrAmPm.split(":").map(Number);
    const d = new Date(0, 0, 0, hh, mm);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return String(hhmmOrAmPm);
}
function parseOneLineUsAddress(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  let street = "", city = "", state = "", postal_code = "";
  if (parts.length >= 3) {
    street = parts[0]; city = parts[1];
    const m = parts[2].match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (m) { state = m[1].toUpperCase(); postal_code = m[2]; }
    else { const toks = parts[2].split(/\s+/); state = (toks[0] || "").toUpperCase(); postal_code = toks.slice(1).join(" ").trim(); }
  } else if (parts.length === 2) {
    street = parts[0];
    const m = parts[1].match(/^(.*)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (m) { city = m[1].trim(); state = m[2].toUpperCase(); postal_code = m[3]; } else { city = parts[1]; }
  } else street = raw;

  const ok = street && city && /^[A-Za-z]{2}$/.test(state) && /^\d{5}(?:-\d{4})?$/.test(postal_code);
  if (!ok) return null;
  return { street, city, state, postal_code, country: "United States" };
}

/* ---------------------------- Editor Modal (kept) --------------------------- */

function EditorModal({ field, value, job, onClose, onSave }) {
  const labelMap = {
    address: "Enter address",
    date_time: "Edit date & time",
    onsite_manager_phone: "On-site phone number",
    workers: "Edit number of workers",
    notes: "Worker notes",
  };
  const [textVal, setTextVal] = useState(value || "");
  const [dateVal, setDateVal] = useState("");
  const [timeVal, setTimeVal] = useState("");

  useEffect(() => {
    if (!field) return;
    if (field === "date_time") {
      const jd = job?.job_details ?? {};
      setDateVal(jd.job_date || "");
      setTimeVal(jd.job_time || "");
      return;
    }
    if (field === "onsite_manager_phone") {
      setTextVal(value ? prettyPhone(value) : "");
      return;
    }
    setTextVal(value || "");
  }, [field, value, job]);

  if (!field) return null;
  const label = labelMap[field] || "Edit";

  const handleSave = () => {
    if (field === "date_time") return onSave?.(field, { date: dateVal, time: timeVal });
    if (field === "workers") {
      const num = Number(textVal || "1");
      return onSave?.(field, isNaN(num) || num <= 0 ? 1 : num);
    }
    onSave?.(field, textVal.trim());
  };

  return (
    <AnimatePresence>
      {field ? (
        <>
          <motion.div
            key="overlay"
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[999]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            key="modal"
            className="fixed inset-0 z-[1000] flex items-center justify-center px-4"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.16 }}
          >
            <div className="w-full max-w-[560px]">
              <div className="bg-white rounded-2xl px-5 py-5 text-[15px] leading-relaxed border border-gray-200 shadow-sm">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="font-medium text-[#04193b]">{label}</div>
                  <button
                    onClick={onClose}
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                    aria-label="Close"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="w-5 h-5"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      fill="none"
                    >
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>

                {field === "date_time" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Date</label>
                      <input
                        type="date"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-[#04193b]/10"
                        value={dateVal}
                        onChange={(e) => setDateVal(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Time</label>
                      <input
                        type="text"
                        placeholder="8:00 AM"
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-[#04193b]/10"
                        value={timeVal}
                        onChange={(e) => setTimeVal(e.target.value)}
                      />
                    </div>
                  </div>
                ) : field === "notes" ? (
                  <textarea
                    rows={3}
                    maxLength={200}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-[#04193b]/10"
                    value={textVal}
                    onChange={(e) => setTextVal(e.target.value)}
                    placeholder="Brief notes for the crew…"
                  />
                ) : field === "workers" ? (
                  <input
                    type="number"
                    min={1}
                    className="w-32 rounded-xl border border-gray-200 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-[#04193b]/10"
                    value={textVal}
                    onChange={(e) => setTextVal(e.target.value)}
                  />
                ) : field === "onsite_manager_phone" ? (
                  <input
                    type="tel"
                    inputMode="tel"
                    placeholder="(555) 123-4567"
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-[#04193b]/10"
                    value={textVal}
                    onChange={(e) => setTextVal(prettyPhone(e.target.value))}
                  />
                ) : (
                  <input
                    type="text"
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-[#04193b]/10"
                    value={textVal}
                    onChange={(e) => setTextVal(e.target.value)}
                    placeholder={field === "address" ? "123 Main St, City, ST 12345" : "Enter value…"}
                  />
                )}

                <div className="mt-4 flex gap-2 justify-end">
                  <button onClick={handleSave} className="rounded-xl px-4 py-2 bg-[#04193b] text-white text-sm hover:opacity-90">
                    Save
                  </button>
                  <button onClick={onClose} className="rounded-xl px-4 py-2 border border-gray-200 bg-white text-sm hover:bg-gray-50">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

/* -------------------------------- Skeletons -------------------------------- */

function HeaderSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-6 w-48 rounded bg-gray-200" />
      <div className="mt-2 flex gap-2">
        <div className="h-6 w-28 rounded-full bg-gray-200" />
        <div className="h-6 w-20 rounded-full bg-gray-200" />
        <div className="h-6 w-24 rounded-full bg-gray-200" />
      </div>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="relative">
      <div className="absolute left-[23px] top-0 bottom-0 w-[2px] bg-gray-200 rounded-full" />
      <div className="space-y-8">
        {[0, 1, 2].map((i) => (
          <div key={i} className="relative pl-14">
            <div className="absolute left-0 top-2 w-12 flex items-center justify-center">
              <div className="h-3.5 w-3.5 rounded-full bg-gray-300" />
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white">
              <div className="p-4 animate-pulse">
                <div className="h-4 w-16 rounded bg-gray-200" />
                <div className="mt-3 h-5 w-3/4 rounded bg-gray-200" />
                <div className="mt-2 h-5 w-2/4 rounded bg-gray-200" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ Media Renderer ------------------------------ */
/** Keeps photos modest in size:
 *  - 1 image: centered, max-w ~320–380px
 *  - 2 images: side-by-side, centered, each portrait aspect
 *  - 3+: small grid fallback
 */
function MediaStrip({ urls = [] }) {
  if (!Array.isArray(urls) || urls.length === 0) return null;

  // 1 image — smaller + centered
  if (urls.length === 1) {
    const url = urls[0];
    return (
      <div className="mt-3 flex justify-center">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="w-full max-w-[320px] sm:max-w-[360px] md:max-w-[380px] overflow-hidden rounded-2xl border border-gray-100 bg-gray-50 shadow-sm"
        >
          <div className="relative w-full aspect-[4/5]">
            <img
              src={url}
              alt="attachment"
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
        </motion.div>
      </div>
    );
  }

  // 2 images — side-by-side, smaller container
  if (urls.length === 2) {
    return (
      <div className="mt-3 flex justify-center">
        <div className="grid grid-cols-2 gap-3 w-full max-w-[520px]">
          {urls.map((url, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: i * 0.03 }}
              className="overflow-hidden rounded-2xl border border-gray-100 bg-gray-50 shadow-sm"
            >
              <div className="relative w-full aspect-[4/5]">
                <img
                  src={url}
                  alt={`attachment ${i + 1}`}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    );
  }

  // 3+ fallback — still modest
  return (
    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
      {urls.map((url, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, delay: i * 0.02 }}
          className="overflow-hidden rounded-xl border border-gray-100 bg-gray-50"
        >
          <div className="relative w-full aspect-[4/5]">
            <img
              src={url}
              alt={`attachment ${i + 1}`}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
        </motion.div>
      ))}
    </div>
  );
}

/* --------------------------- No-show alert renderer -------------------------- */

function WarningIcon({ className = "w-5 h-5" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  );
}

function NoShowCard({ when, description }) {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
      <div className="p-4">
        <div className="flex items-center gap-2 text-amber-800">
          <div className="inline-flex items-center gap-2">
            <span className="inline-flex items-center justify-center rounded-lg bg-amber-100 px-2 py-1 text-[12px] font-semibold uppercase tracking-wide">
              <WarningIcon className="w-4 h-4 mr-1" />
              Worker update
            </span>
          </div>
          <span className="ml-auto text-[13px]">{when}</span>
        </div>

        <div className="mt-2 text-[16px] leading-[1.55] text-amber-900 whitespace-pre-line">
          {description}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- Component -------------------------------- */

export default function JobActivityModernB({ jobId, onRightRail }) {
  const [job, setJob] = useState(null);
  const [loadingJob, setLoadingJob] = useState(true);
  const [activity, setActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);

  const auth = useAuth?.();
  const getIdToken = auth?.getIdToken;

  const [editingField, setEditingField] = useState(null);
  const [editingVal, setEditingVal] = useState("");

  // Scroll container ref (for the jump-to-bottom button)
  const scrollElRef = useRef(null);

  // fetch job
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    (async () => {
      setLoadingJob(true);
      try {
        const ref = doc(db, "jobs", jobId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          if (!cancelled) {
            setJob(null);
            onRightRail?.({ show: false });
          }
          return;
        }
        const data = snap.data();
        if (!cancelled) {
          setJob(data);

          try {
            window.sessionStorage.setItem("last.chat.path", `/job/${jobId}`);
          } catch {}

          const jd = data.job_details ?? {};
          const cs = jd.cost_summary ?? {};
          const wc = (cs.worker_cost ?? jd.worker_cost) ?? {};
          const toNum = (v) =>
            v == null ? null : Number(String(v).replace(/[^0-9.\-]/g, ""));
          const workersTotal = toNum(wc.total);
          const bg = toNum(cs.background_check_fee);
          const laborOnly =
            workersTotal == null ? null : workersTotal - (bg ?? 0);
          const quoteCard = {
            total: toNum(cs.final_amount_due_now) ?? workersTotal ?? null,
            items: [
              laborOnly != null
                ? { label: "Labor Cost", amount: laborOnly }
                : null,
              bg != null ? { label: "Background Check Fee", amount: bg } : null,
            ].filter(Boolean),
          };

          onRightRail?.({
            jobId,
            summary: { ...data, job_id: jobId },
            quoteCard,
            ui: { rail_update: false, sticky_total: null, current_step: null },
            ready: true,
            onEdit: (field) => {
              const jdLocal = data.job_details ?? {};
              const ciLocal = data.client_info ?? {};
              if (field === "address") {
                const a = jdLocal.address || {};
                const addr = a.street
                  ? `${a.street}${a.city ? `, ${a.city}` : ""}${a.state ? `, ${a.state}` : ""}${a.postal_code ? ` ${a.postal_code}` : ""}`
                  : "";
                setEditingVal(addr);
              } else if (field === "date_time") {
                setEditingVal(
                  `${jdLocal.job_date || ""} ${jdLocal.job_time || ""}`.trim()
                );
              } else if (field === "onsite_manager_phone") {
                setEditingVal(ciLocal.phone_number ? ciLocal.phone_number : "");
              } else if (field === "workers") {
                setEditingVal(
                  jdLocal.workers_required
                    ? String(jdLocal.workers_required)
                    : "1"
                );
              } else if (field === "notes") {
                setEditingVal(
                  jdLocal.job_description_raw || jdLocal.job_description || ""
                );
              } else setEditingVal("");
              setEditingField(field);
            },
            onApply: async ({ field, value }) => {
              await applyJobFieldUpdate(field, value);
            },
            show: true,
          });
        }
      } catch (e) {
        console.warn("Failed to load job:", e);
        if (!cancelled) {
          setJob(null);
          onRightRail?.({ show: false });
        }
      } finally {
        if (!cancelled) setLoadingJob(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId, onRightRail]);

  // activity stream
  useEffect(() => {
    if (!jobId) return;
    const jobRef = doc(db, "jobs", jobId);
    const activityCol = collection(jobRef, "activity");
    const qy = query(activityCol, orderBy("created_at", "asc"));
    setActivityLoading(true);
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows = [];
        snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
        setActivity(rows);
        setActivityLoading(false);
      },
      (err) => {
        console.warn("activity snapshot error", err);
        setActivityLoading(false);
      }
    );
    return () => unsub();
  }, [jobId]);

  const tz =
    job?.job_details?.timezone_id || job?.job_details?.timezone || undefined;

  const heading = useMemo(
    () => (jobId ? `Job ${jobId}` : "Job activity"),
    [jobId]
  );

  // header chips
  const headerChips = useMemo(() => {
    if (!job) return [];
    const jd = job.job_details ?? {};
    const dateLabel = jd.job_date
      ? formatPrettyStamp(new Date(`${jd.job_date}T00:00:00`), false, tz)
      : "";
    const timeLabel = jd.job_time ? toAmPm(jd.job_time) : "";
    const city = jd.address?.city || "";
    return [dateLabel, timeLabel, city].filter(Boolean);
  }, [job, tz]);

  // group by human date
  const grouped = useMemo(() => {
    const map = new Map();
    for (const it of activity) {
      const keyDate = formatPrettyStamp(it.created_at, false, tz);
      if (!map.has(keyDate)) map.set(keyDate, []);
      map.get(keyDate).push(it);
    }
    return Array.from(map.entries()).map(([dateLabel, items]) => ({
      dateLabel,
      items,
    }));
  }, [activity, tz]);

  const handleEditorClose = useCallback(() => {
    setEditingField(null);
    setEditingVal("");
  }, []);

  const applyJobFieldUpdate = useCallback(
    async (field, value) => {
      if (!jobId) return;

      if (field === "date_time") {
        const jd = job?.job_details ?? {};
        const tzLocal =
          value?.timezone || jd.timezone || jd.timezone_id || "America/New_York";
        const date = value?.date || jd.job_date || "";
        const rawTime = value?.time || jd.job_time || "";
        const time = toAmPm(rawTime);
        try {
          await editBookingDateTime(jobId, { date, time, timeZone: tzLocal }, getIdToken);
        } catch (err) {
          console.error("Failed to update date/time:", err);
          alert(typeof err?.message === "string" ? err.message : "Failed to update date/time");
        }
        return;
      }

      if (field === "address") {
        try {
          let addrObj = null;
          if (value && typeof value === "object" && value.street) {
            addrObj = {
              street: String(value.street || "").trim(),
              city: String(value.city || "").trim(),
              state: String(value.state || "").trim(),
              postal_code: String(value.postal_code || "").trim(),
              country: String(value.country || "United States").trim(),
              ...(value.geo_coords ? { geo_coords: value.geo_coords } : {}),
              ...(value.address_line ? { address_line: value.address_line } : {}),
            };
          } else if (typeof value === "string") {
            const parsed = parseOneLineUsAddress(value);
            if (!parsed) {
              alert("Enter address as: 123 Main St, City, ST 12345");
              return;
            }
            addrObj = parsed;
            try {
              const norm = await addressNormalize(value);
              if (norm?.lat != null && norm?.lng != null) {
                addrObj.geo_coords = { lat: norm.lat, lng: norm.lng };
              }
            } catch (e) {
              console.warn("addressNormalize failed:", e);
            }
          } else {
            alert("Unsupported address format.");
            return;
          }
          await editBookingAddress(jobId, addrObj, getIdToken);
        } catch (err) {
          console.error("Failed to update address:", err);
          alert(typeof err?.message === "string" ? err.message : "Failed to update address");
        }
        return;
      }

      if (field === "onsite_manager_phone") {
        try {
          const phoneNumber =
            (value && typeof value === "object" && value.phoneNumber) ||
            (typeof value === "string" ? value : "");
          if (!phoneNumber) {
            alert("Enter a valid US phone number.");
            return;
          }
          await editBookingOnsitePhone(jobId, { phoneNumber }, getIdToken);
        } catch (err) {
          console.error("Failed to update on-site phone:", err);
          alert(typeof err?.message === "string" ? err.message : "Failed to update on-site phone");
        }
        return;
      }

      console.log("[applyJobFieldUpdate] Unhandled field:", field, value);
    },
    [jobId, job, getIdToken]
  );

  const handleEditorSave = useCallback(
    async (field, newValue) => {
      if (
        field === "date_time" ||
        field === "address" ||
        field === "onsite_manager_phone"
      ) {
        await applyJobFieldUpdate(field, newValue);
      } else {
        console.log("[stub] update field", field, "to", newValue, "for job", jobId);
      }
      setEditingField(null);
      setEditingVal("");
    },
    [applyJobFieldUpdate, jobId]
  );

  return (
    <div className="h-[calc(100vh-56px)] relative">
      <EditorModal
        field={editingField}
        value={editingVal}
        job={job}
        onClose={handleEditorClose}
        onSave={handleEditorSave}
      />

      {/* main scroll area */}
      {/* NOTE: extra bottom padding on mobile so sticky footer doesn't overlap */}
      <div ref={scrollElRef} className="h-full overflow-y-auto px-4 pb-24 md:pb-10">
        <div className="max-w-[760px] mx-auto py-6 space-y-6 text-[17px]">
          {/* Header */}
          <div className="flex flex-col gap-2">
            {loadingJob ? (
              <HeaderSkeleton />
            ) : (
              <>
                <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-gray-900">
                  <span className="font-bold text-[#04193b]">
                    {heading.replace("Job ", "")}
                  </span>
                </h1>
                {headerChips.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {headerChips.map((chip, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 h-7 text-[14px] text-gray-700"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* Timeline */}
          {activityLoading ? (
            <TimelineSkeleton />
          ) : activity.length === 0 ? (
            <div className="text-[15px] text-gray-400">No activity yet for this job.</div>
          ) : (
            <div className="relative">
              {/* rail */}
              <div className="absolute left-[23px] top-0 bottom-0 w-[2px] bg-gray-200 rounded-full" />
              <div className="space-y-8">
                {grouped.map(({ dateLabel, items }) => (
                  <div key={dateLabel} className="space-y-4">
                    <div className="sticky top-0 z-10 -mx-4 px-4 py-1.5 bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60">
                      <div className="text-[13px] font-medium text-gray-500 uppercase tracking-wide">
                        {dateLabel}
                      </div>
                    </div>

                    {items.map((it) => {
                      const when = formatTimeOnly(it.created_at, tz);
                      const hasMedia =
                        Array.isArray(it.media_urls) && it.media_urls.length > 0;
                      const isNoShow = (it.type || "").toLowerCase() === "worker_no_show_removed";

                      return (
                        <motion.div
                          key={it.id}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 8 }}
                          transition={{ duration: 0.16 }}
                          className="relative pl-14"
                        >
                          {/* node */}
                          <div className="absolute left-0 top-2 w-12 flex items-center justify-center">
                            <div
                              className={
                                "h-3.5 w-3.5 rounded-full " +
                                (isNoShow
                                  ? "bg-amber-600 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]"
                                  : "bg-[#04193b] shadow-[0_0_0_3px_rgba(4,25,59,0.08)]")
                              }
                            />
                          </div>

                          {/* card */}
                          {isNoShow ? (
                            <NoShowCard when={when} description={it.description} />
                          ) : (
                            <div className="rounded-2xl border border-gray-200 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.03)]">
                              <div className="p-4">
                                <div className="text-[15px] text-gray-500">{when}</div>

                                {it.description ? (
                                  <div className="mt-1.5 text-[16px] sm:text-[17px] leading-[1.55] text-[#0f172a] whitespace-pre-line">
                                    {it.description}
                                  </div>
                                ) : null}

                                {hasMedia ? <MediaStrip urls={it.media_urls} /> : null}
                              </div>
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

    {/* Mobile sticky footer: matches Chat “Confirm & Book” */}
    <div className="xl:hidden sticky bottom-0 left-0 right-0 z-10">
      <div className="bg-gradient-to-t from-white via-white/90 to-transparent">
        <div className="mx-auto w-full max-w-[760px] px-4 pt-2 pb-[max(env(safe-area-inset-bottom),12px)]">
          <div className="mx-auto w-full max-w-[560px] border-t border-gray-200" />
          <div className="mt-2 flex justify-center">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("right-rail:open"))}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-gray-900 hover:bg-gray-100 active:bg-gray-200 transition"
              aria-label="View booking details"
            >
              <span>Details</span>
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

      {/* Jump-to-bottom arrow appears when not at the bottom */}
      <ScrollToBottom container={scrollElRef.current} hideThreshold={80} />
    </div>
  );
}
