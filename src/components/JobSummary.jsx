// src/components/JobSummary.jsx
import { useMemo } from "react";

export default function JobSummary({ state }) {
  const slots = state?.slots ?? {};

  // Helper: accept E.164 like +15551234567 (10–15 digits after +)
  const isE164 = (s) => typeof s === "string" && /^\+\d{10,15}$/.test(s.trim());

  // --- 8-element completion model (added on-site phone) ---
  const doneService   = !!slots.service_type;
  const doneWorkers   = typeof slots.workers === "number" && slots.workers > 0;
  const doneDateTime  = !!slots.date && !!slots.start_time; // counts as ONE element
  const doneDuration  = !!slots.duration_hours;
  const doneAddress   =
    slots?.address_present === true ||
    (typeof slots?.address === "string" && slots.address.trim().length > 0);
  const doneTools     = typeof slots.tools === "boolean"; // decision made (yes/no)
  const doneNotes     = typeof slots.notes === "string" && slots.notes.trim().length > 0;

  // NEW: on-site phone (looks for canonical key, but tolerates synonyms)
  const phoneRaw = slots.onsite_manager_phone || slots.contact_phone || slots.phone || "";
  const donePhone = isE164(phoneRaw) || (typeof phoneRaw === "string" && phoneRaw.trim().length > 0);

  const total = 8;
  const completed = [
    doneService,
    doneWorkers,
    doneDateTime,
    doneDuration,
    doneAddress,
    doneTools,
    doneNotes,
    donePhone,      // ← added
  ].reduce((n, v) => n + (v ? 1 : 0), 0);

  const pct = useMemo(() => Math.round((completed / total) * 100), [completed]);

  return (
    <div className="w-full select-none">
      {/* Progress bar (minimal) */}
      <div
        className="relative h-2.5 w-full rounded-full bg-neutral-200"
        aria-label="booking progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        role="progressbar"
      >
        <div className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]" />
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, rgba(17,24,39,1) 0%, rgba(0,0,0,1) 100%)",
          }}
        />
      </div>
    </div>
  );
}