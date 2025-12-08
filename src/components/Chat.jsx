// src/components/Chat.jsx
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import remarkGfm from "remark-gfm";
import {
  brainTurn,
  provisionalJob,
  getChatSession,
  createChatSession,
  getAccountStatus,
  savePendingDraft,
} from "../lib/api";
import ScrollToBottom from "./ScrollToBottom";
import JobSummary from "./JobSummary";
import TypingDot from "./TypingDot";
import ReactMarkdown from "react-markdown";
import { useLoadScript } from "@react-google-maps/api";
import { useAuth } from "../context/AuthContext.jsx";
import { auth } from "../lib/firebase";

const PLACES_LIBS = ["places"];

import movingIcon from "../assets/moving100.png";
import cleaningIcon from "../assets/cleaning100.png";
import otherIcon from "../assets/other1000.png";

const LANDING_HEADLINES = [
  "What do you need done?",
  "Need a hand with something?",
  "What’s the job today?",
  "How can we help today?",
  "Let’s get your job started.",
  "What can our crew handle?",
];

const baseMdComponents = {
  h1: (p) => (
    <h1 className="text-[22px] sm:text-[24px] font-semibold tracking-tight text-[#04193b] mt-1.5 mb-2.5">
      {p.children}
    </h1>
  ),
  h2: (p) => (
    <h2 className="text-[18px] sm:text-[20px] font-semibold tracking-tight text-[#04193b] mt-1.5 mb-2">
      {p.children}
    </h2>
  ),
  h3: (p) => (
    <h3 className="text-[16px] sm:text-[17px] font-semibold tracking-tight text-[#04193b] mt-1.5 mb-1.5">
      {p.children}
    </h3>
  ),
  p: (p) => <p className="mb-3 last:mb-0">{p.children}</p>,
  ul: (p) => <ul className="list-disc pl-5 space-y-1">{p.children}</ul>,
  ol: (p) => <ol className="list-decimal pl-5 space-y-1">{p.children}</ol>,
  li: (p) => <li className="ml-0">{p.children}</li>,
  strong: (p) => <strong className="font-semibold">{p.children}</strong>,
  a: (p) => (
    <a
      href={p.href}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2 hover:no-underline"
    >
      {p.children}
    </a>
  ),
  code: (p) => (
    <code className="px-1.5 py-0.5 rounded bg-gray-100 text-[13px]">
      {p.children}
    </code>
  ),
  blockquote: (p) => (
    <blockquote className="border-l-2 border-gray-200 pl-3 text-gray-700 italic">
      {p.children}
    </blockquote>
  ),
};

/* --------------------------- AuthSheet helpers ---------------------------- */
const openAuthSheet = (detail = {}) =>
  window.dispatchEvent(new CustomEvent("auth:open", { detail }));
const closeAuthSheet = () =>
  window.dispatchEvent(new CustomEvent("auth:close"));

function getOrCreateSessionId() {
  const k = "bm_session_id";
  let v = localStorage.getItem(k);
  if (!v) {
    v = crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    localStorage.setItem(k, v);
  }
  return v;
}

// localStorage key builder for our POC snapshot
function snapshotKeyFor(sessionId) {
  return `chat_snapshot_${sessionId}`;
}

/* ---------- Helper: nextBookableHourToday (1 hour out logic) ---------- */
function nextBookableHourToday(now = new Date()) {
  const n = new Date(now);
  if (
    n.getMinutes() > 0 ||
    n.getSeconds() > 0 ||
    n.getMilliseconds() > 0
  ) {
    n.setHours(n.getHours() + 1, 0, 0, 0);
  } else {
    n.setMinutes(0, 0, 0, 0);
  }
  n.setHours(n.getHours() + 1);
  return n.getHours();
}

const UpArrowIcon = (props) => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" {...props}>
    <path
      d="M7.5 12 L12 7.5 L16.5 12"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12 7.5 V18.5"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

function SendButton({ disabled = false }) {
  return (
    <button
      type="submit"
      aria-label="Send"
      disabled={disabled}
      className="absolute right-3 top-1/2 -translate-y-1/2 grid place-items-center h-10 w-10 rounded-full
                 bg-black text-white shadow-sm
                 focus:outline-none focus-visible:ring-4 focus-visible:ring-black/15
                 disabled:opacity-45 disabled:cursor-not-allowed"
    >
      <UpArrowIcon />
    </button>
  );
}

/* ----------------------------- Small UI atoms ----------------------------- */
function Pill({ children, onClick, active, ariaLabel }) {
  return (
    <button
      aria-label={ariaLabel}
      onClick={onClick}
      className={[
        "inline-flex items-center justify-center rounded-xl",
        "px-4 py-3 text-sm sm:text-base font-semibold transition-all duration-200",
        active
          ? "bg-[#04193b] text-white shadow-sm"
          : "bg-white text-[#04193b] border border-gray-200 hover:border-[#04193b] hover:shadow-sm",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function CardButton({ title, icon, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex flex-col items-center justify-center gap-3",
        "p-5 rounded-2xl border transition-all duration-200",
        active
          ? "border-[#04193b] ring-2 ring-[#04193b]"
          : "border-gray-200 hover:shadow-sm hover:border-[#04193b]/50",
        "bg-white",
      ].join(" ")}
    >
      {icon ? (
        <img src={icon} alt={title} className="h-14 w-14 object-contain" />
      ) : null}
      <span className="text-[#04193b] font-semibold">{title}</span>
    </button>
  );
}

/* ---------------------- Calendly-like Date/Time Picker --------------------- */
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
                    setMonth(
                      new Date(month.getFullYear(), month.getMonth() - 1, 1)
                    )
                  }
                  disabled={!canGoPrev}
                >
                  ‹
                </button>
                <div className="font-semibold text-[#04193b]">
                  {month.toLocaleString(undefined, {
                    month: "long",
                    year: "numeric",
                  })}
                </div>
                <button
                  className="px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50"
                  onClick={() =>
                    setMonth(
                      new Date(month.getFullYear(), month.getMonth() + 1, 1)
                    )
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
                {step === "date" && (
                  <motion.div
                    key="pick-date"
                    initial={{ x: 20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: -20, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <div className="text-sm text-gray-600">
                      Pick a date to see available times.
                    </div>
                  </motion.div>
                )}

                {step === "time" && (
                  <motion.div
                    key="pick-time"
                    initial={{ x: 20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: -20, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="space-y-3"
                  >
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
                      {times.map(({ h, m, label }) => {
                        const thisVal = `${pad(h)}:${pad(m)}`;
                        const highlighted =
                          preselectedTime && thisVal === preselectedTime;
                        return (
                          <button
                            key={`${h}-${m}`}
                            onClick={() => selectTime(h, m)}
                            className={[
                              "w-full h-12 rounded-xl border bg-white font-medium transition-all",
                              highlighted
                                ? "border-[#04193b] ring-2 ring-[#04193b]"
                                : "border-gray-200 hover:border-[#04193b] hover:shadow-sm",
                            ].join(" ")}
                            aria-pressed={highlighted ? "true" : "false"}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
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

/* ----------------------- Phone formatting helpers (US) --------------------- */
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

/* --------------------------- Main Chat component --------------------------- */
export default function Chat({ onRightRail }) {
  const { sessionId: routeSessionId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const hasSeedInit = !!(
    location.state?.seedFirstMessage || location.state?.seedBooking
  );

  // try to synchronously restore from snapshot if we are on /c/:id and not seeded
  const initialSnapshot =
    !hasSeedInit && routeSessionId
      ? (() => {
          try {
            const raw = localStorage.getItem(snapshotKeyFor(routeSessionId));
            if (raw) return JSON.parse(raw);
          } catch (e) {
            // ignore
          }
          return null;
        })()
      : null;

  // Prefer session id from the URL; fall back to local
  const [sessionId, setSessionId] = useState(
    routeSessionId || getOrCreateSessionId()
  );
  useEffect(() => {
    if (routeSessionId && routeSessionId !== sessionId) {
      setSessionId(routeSessionId);
      localStorage.setItem("bm_session_id", routeSessionId);
    }
  }, [routeSessionId, sessionId]);

  const { user, getIdToken } = useAuth();

  const uid = "demo-user-1";

  // START: initialize from snapshot if we had one
  const [messages, setMessages] = useState(
    initialSnapshot?.messages ?? []
  );
  const [chips, setChips] = useState(initialSnapshot?.chips ?? []);
  const [chipset, setChipset] = useState(initialSnapshot?.chipset ?? []);
  const [picker, setPicker] = useState(initialSnapshot?.picker ?? null);
  const [pickerValue, setPickerValue] = useState(
    initialSnapshot?.pickerValue ?? ""
  );
  const [state, setState] = useState(initialSnapshot?.state ?? null);
  const [quoteCard, setQuoteCard] = useState(
    initialSnapshot?.quoteCard ?? null
  );
  const [ui, setUi] = useState(
    initialSnapshot?.ui ?? {
      rail_update: false,
      sticky_total: null,
      current_step: "service_type",
    }
  );
  // NEW: store breadcrumbs so we can rehydrate right rail
  const [breadcrumbs, setBreadcrumbs] = useState(
    initialSnapshot?.breadcrumbs ?? []
  );

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState(false);

  const isLanding = messages.length === 0;
  const [landingInput, setLandingInput] = useState("");
  const [headline, setHeadline] = useState(
    initialSnapshot?.headline ??
      LANDING_HEADLINES[Math.floor(Math.random() * LANDING_HEADLINES.length)]
  );

  const threadRef = useRef(null);
  const [scrollEl, setScrollEl] = useState(null);

  const activeTurnRef = useRef(null);
  const userBubbleRef = useRef(null);
  const [userH, setUserH] = useState(0);
  const progressRef = useRef(null);

  // always-up-to-date local snapshot of booking slots
  const draftRef = useRef(initialSnapshot?.draft ?? {});

  // remember last chat path (Account page "Back" will rely on this)
  useEffect(() => {
    if (routeSessionId) {
      sessionStorage.setItem("last.chat.path", location.pathname);
    }
  }, [routeSessionId, location.pathname]);

  useEffect(() => setScrollEl(threadRef.current), []);

  useEffect(() => {
    if (!userBubbleRef.current) return;
    const ro = new ResizeObserver(() => {
      const h = userBubbleRef.current?.getBoundingClientRect?.().height || 0;
      setUserH(h);
    });
    ro.observe(userBubbleRef.current);
    return () => ro.disconnect();
  }, [messages.length]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.who === "user") {
      requestAnimationFrame(() => {
        activeTurnRef.current?.scrollIntoView({
          block: "start",
          behavior: "smooth",
        });
      });
    }
  }, [messages.length]);

  // Hide/show right rail before paint to prevent a flash on the landing screen
  useLayoutEffect(() => {
    onRightRail?.({ show: !isLanding });
  }, [isLanding, onRightRail]);

  function appendAssistant(text) {
    if (!text) return;
    setMessages((m) => [...m, { who: "assistant", text }]);
  }

  // ---- Similar booking tip (robust) ----
  useEffect(() => {
    const showTip = (detail) => {
      const tip =
        `**Make a similar booking** – ` +
        `We’ve kept your **address**, **service**, **crew**, **tools**, and **notes**.\n\n` +
        `**How it works**\n\n` +
        `1. View **Booking Details** on the right.\n` +
        `2. Change **Date & time** (✏️) — and adjust anything else if needed.\n` +
        `3. Tap **Book** to create another job.\n\n`;

      setMessages((m) => [...m, { who: "assistant", text: tip }]);
    };

    const onTip = (e) => showTip(e?.detail);

    window.addEventListener("booking:similar:tip", onTip);
    window.addEventListener("booking:success:similar", onTip);

    try {
      const raw = localStorage.getItem("pending_similar_tip");
      if (raw) {
        localStorage.removeItem("pending_similar_tip");
        const detail = JSON.parse(raw);
        showTip(detail);
      }
    } catch {}

    return () => {
      window.removeEventListener("booking:similar:tip", onTip);
      window.removeEventListener("booking:success:similar", onTip);
    };
  }, []);

  /* -------- On first navigation to /c/:id, seed the first message optimistically -------- */
  const seededFirstHandled = useRef(false);
  useEffect(() => {
    const seed = location.state?.seedFirstMessage;
    if (!routeSessionId || !seed || seededFirstHandled.current) return;
    seededFirstHandled.current = true;

    setMessages((m) => [...m, { who: "user", text: seed }]);
    setWaiting(true);

    (async () => {
      try {
        const res = await brainTurn({
          sessionId: routeSessionId,
          type: "user_message",
          value: { text: seed },
          uid,
        });
        applyTurn(res);
      } catch (e) {
        appendAssistant(`Sorry—something went wrong: ${String(e)}`);
      } finally {
        setWaiting(false);
        navigate(location.pathname, { replace: true, state: {} });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSessionId, location.state]);

  /* -------------------- Calendar → Chat seeded booking flow -------------------- */
  const seedHandled = useRef(false);
  useEffect(() => {
    const seed = location.state?.seedBooking;
    if (!routeSessionId || !seed || seedHandled.current) return;

    seedHandled.current = true;

    const seedText = `Set date & time to ${seed.date} @ ${seed.start_time}`;
    setMessages((m) => [...m, { who: "user", text: seedText }]);

    appendAssistant(
      "**Let’s finalize your booking.** I’ve saved your date and time and will guide you to the next step…"
    );

    (async () => {
      try {
        setWaiting(true);
        const r1 = await brainTurn({
          sessionId: routeSessionId,
          type: "user_pick",
          value: {
            field: "date_time",
            value: { date: seed.date, time: seed.start_time },
          },
          uid,
        });
        applyTurn(r1);

        const r2 = await brainTurn({
          sessionId: routeSessionId,
          type: "user_message",
          value: { text: "continue booking" },
          uid,
        });
        applyTurn(r2);
      } catch (e) {
        appendAssistant(
          `Sorry—something went wrong setting your date/time: ${String(e)}`
        );
      } finally {
        setWaiting(false);
        navigate(location.pathname, { replace: true, state: {} });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSessionId, location.state]);

  // send user message (wrapped so we can use it in markdown buttons too)
  const sendUserMessage = useCallback(
    async (text, overrideSessionId = null) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;

      setPicker(null);
      setPickerValue("");
      setUi((u) =>
        u && ["notes", "tools_details", "onsite_manager_phone"].includes(u.current_step)
          ? { ...u, current_step: null }
          : u
      );

      setMessages((m) => [...m, { who: "user", text: trimmed }]);
      setInput("");
      setSending(true);
      setWaiting(true);
      try {
        const sid = overrideSessionId ?? sessionId;
        const res = await brainTurn({
          sessionId: sid,
          type: "user_message",
          value: { text: trimmed },
          uid,
        });
        applyTurn(res);
      } catch (e) {
        appendAssistant(`Sorry—something went wrong: ${String(e)}`);
      } finally {
        setSending(false);
        setWaiting(false);
      }
    },
    [sending, sessionId, uid]
  );

  // Landing submit → create server session, then navigate carrying the first message
  const submitLanding = useCallback(
    async (e) => {
      e.preventDefault();
      const v = landingInput.trim();
      if (!v) return;
      setLandingInput("");

      setPicker(null);
      setPickerValue("");
      setUi((u) =>
        u && ["notes", "tools_details", "onsite_manager_phone"].includes(u.current_step)
          ? { ...u, current_step: null }
          : u
      );

      try {
        const { session_id } = await createChatSession({ uid });
        setSessionId(session_id);
        localStorage.setItem("bm_session_id", session_id);
        navigate(`/c/${session_id}`, { state: { seedFirstMessage: v } });
      } catch (err) {
        appendAssistant(`Couldn’t start a new chat: ${String(err)}`);
      }
    },
    [landingInput, navigate, uid]
  );

  async function onLegacyChipClick(label) {
    const asked = Array.isArray(state?.next_needed) && state.next_needed[0];
    if (!asked) return sendUserMessage(label);
    setWaiting(true);
    const res = await brainTurn({
      sessionId,
      type: "user_select",
      value: { field: asked, value: label },
      uid,
    });
    applyTurn(res);
    setWaiting(false);
  }

  async function onStructuredChipClick(chip) {
    setWaiting(true);
    const { event } = chip;

    const res = await brainTurn({
      sessionId,
      type: event.event_type,
      value: event.value,
      uid,
    });
    applyTurn(res);
    setWaiting(false);
  }

  const openEditorForField = useCallback(
    (field) => {
      setChips([]);
      setChipset([]);

      if (field === "date_time") {
        setPicker({
          type: "date_time",
          initialDate: state?.slots?.date ?? null,
          initialTime: state?.slots?.start_time ?? null,
        });
        return;
      }
      if (field === "address") {
        setPicker({ type: "address" });
        return;
      }
      if (field === "notes") {
        setPicker({ type: "notes" });
        return;
      }
      if (field === "tools_details") {
        setPicker({ type: "tools_details" });
        return;
      }
      if (
        field === "onsite_manager_phone" ||
        field === "contact_phone" ||
        field === "phone"
      ) {
        setPicker({ type: "onsite_manager_phone" });
        return;
      }
      if (field === "service_type") {
        setPicker(null);
        setChipset([]
          .concat([
            {
              label: "Moving",
              event: {
                event_type: "user_select",
                value: { field: "service_type", value: "moving" },
              },
            },
            {
              label: "Cleaning",
              event: {
                event_type: "user_select",
                value: { field: "service_type", value: "cleaning" },
              },
            },
            {
              label: "Other",
              event: {
                event_type: "user_select",
                value: { field: "service_type", value: "other" },
              },
            },
          ])
        );
        return;
      }
      if (field === "workers") {
        setPicker(null);
        setChipset(
          Array.from({ length: 10 }, (_, i) => ({
            label: String(i + 1),
            event: {
              event_type: "user_select",
              value: { field: "workers", value: i + 1 },
            },
          }))
        );
        return;
      }
      if (field === "duration_hours") {
        setPicker(null);
        setChipset([
          {
            label: "2 hours or less",
            event: {
              event_type: "user_select",
              value: { field: "duration_hours", value: 2 },
            },
          },
          {
            label: "5 hours or less",
            event: {
              event_type: "user_select",
              value: { field: "duration_hours", value: 5 },
            },
          },
          {
            label: "8 hours or less",
            event: {
              event_type: "user_select",
              value: { field: "duration_hours", value: 8 },
            },
          },
        ]);
        return;
      }
      if (field === "tools") {
        setPicker(null);
        setChipset([
          {
            label: "Yes",
            event: {
              event_type: "user_select",
              value: { field: "tools", value: true },
            },
          },
          {
            label: "No",
            event: {
              event_type: "user_select",
              value: { field: "tools", value: false },
            },
          },
        ]);
        return;
      }
    },
    [state?.slots]
  );

  async function submitPicker() {
    if (!picker) return;

    const latestVal =
      document.querySelector("#address-autocomplete-input")?.value?.trim() ||
      pickerValue.trim();

    if (!latestVal) return;

    draftRef.current = {
      ...(draftRef.current || state?.slots || {}),
      [picker.type]: latestVal,
    };

    setWaiting(true);
    try {
      const res = await brainTurn({
        sessionId,
        type: "user_pick",
        value: { field: picker.type, value: latestVal },
        uid,
      });
      applyTurn(res);
    } catch (e) {
      console.error("Submit picker failed:", e);
    } finally {
      setPicker(null);
      setPickerValue("");
      setWaiting(false);
    }
  }

  // 🔁 REPLACE the whole onConfirm function with this:
  async function onConfirm(opts = {}) {
    const booking =
      draftRef.current && Object.keys(draftRef.current).length
        ? draftRef.current
        : state?.slots ?? {};
    const quote = quoteCard
      ? { items: quoteCard.items || [], total: quoteCard.total ?? 0 }
      : {};

    // ✅ NEW: accept coupon from RightRail
    const couponCode = (opts && opts.couponCode) ? String(opts.couponCode).trim().toUpperCase() : null;

    try {
      const status = await getAccountStatus(getIdToken);

      const canProceed =
        Boolean(status?.logged_in) &&
        Boolean(status?.profile_ok) &&
        Boolean(status?.payment_on_file);

      if (canProceed) {
        appendAssistant("Placing your booking…");
        const uidNow = auth.currentUser?.uid || user?.uid;
        if (!uidNow) {
          appendAssistant("Still finishing sign-in. Please try Confirm again in a moment.");
          return;
        }

        // ✅ NEW: pass coupon_code through
        const created = await provisionalJob(
          { uid: uidNow, booking, quote, coupon_code: couponCode || undefined },
          getIdToken
        );

        const display = created?.job_id || created?.display_id || "your booking";
        const slots = { ...(state?.slots || {}), ...(draftRef.current || {}) };
        const success = {
          booking_id: created?.job_id || created?.booking_id || "unknown",
          display_id: display,
          date: slots.date || null,
          start_time: slots.start_time || null,
          address: slots.address || "",
          workers: slots.workers || null,
          duration_hours: slots.duration_hours || null,
          service_type: slots.service_type || null,
        };

        appendAssistant(
          `✅ Booking created: **${display}** — ${success.date || "—"} @ ${success.start_time || "—"}. I’ve saved the details below.`
        );

        window.dispatchEvent(new CustomEvent("booking:success", { detail: success }));

        try { localStorage.setItem("last_booking", JSON.stringify({ ...success, at: Date.now() })); } catch {}
        try { const sid = sessionId; localStorage.removeItem(`pending_draft_${sid}`); } catch {}

        window.dispatchEvent(new CustomEvent("right-rail:lock", { detail: { display_id: display } }));
        return;
      }

      const session_id = sessionId;
      const anon_id = sessionId;
      await savePendingDraft({ session_id, anon_id, booking, quote });

      localStorage.setItem(
        `pending_draft_${session_id}`,
        JSON.stringify({ booking, quote, at: Date.now() })
      );

      let msg = "Please sign in, complete your profile, and add a card to finish your booking. I saved your draft.";
      if (status?.logged_in && status?.profile_ok && !status?.payment_on_file) {
        msg = "You're logged in, but there’s no card on file for your company. Add a payment method to finish your booking. I saved your draft.";
      } else if (status?.logged_in && !status?.profile_ok) {
        msg = "Please complete your profile and add a card to finish your booking. I saved your draft.";
      }

      setMessages((m) => [...m, { who: "assistant", text: msg }]);
      openAuthSheet({ allowWhenAuthed: true });
    } catch (e) {
      appendAssistant(`Could not proceed: ${String(e?.message || e)}`);
    }
  }


  // New chat → new id, clear old snapshot
  async function onNewChat() {
    const oldId = sessionId;
    if (oldId) {
      localStorage.removeItem(snapshotKeyFor(oldId));
    }

    const newId = crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    localStorage.setItem("bm_session_id", newId);
    navigate(`/c/${newId}`);

    setMessages([]);
    setChips([]);
    setChipset([]);
    setPicker(null);
    setPickerValue("");
    setState(null);
    setQuoteCard(null);
    setUi({
      rail_update: false,
      sticky_total: null,
      current_step: "service_type",
    });
    setBreadcrumbs([]);
    setInput("");
    setHeadline(
      LANDING_HEADLINES[Math.floor(Math.random() * LANDING_HEADLINES.length)]
    );

    onRightRail?.({ show: false });
  }

  function applyTurn(res) {
    appendAssistant(res.say || "");
    setChips(res.chips ?? []);
    setChipset(res.chipset ?? []);

    const nextPicker =
      res.picker?.type === "date_time"
        ? {
            ...res.picker,
            initialDate: res.state?.slots?.date ?? null,
            initialTime: res.state?.slots?.start_time ?? null,
          }
        : res.picker ?? null;
    setPicker(nextPicker);

    setQuoteCard(res.quote_card ?? null);
    setUi(
      res.ui ?? {
        rail_update: false,
        sticky_total: null,
        current_step: "service_type",
      }
    );
    setState(res.state ?? null);
    setBreadcrumbs(res.breadcrumbs ?? []);

    draftRef.current = { ...(res.state?.slots || {}) };

    // 🔴 send summary up so right rail can rehydrate immediately
    onRightRail?.({
      summary: res.state?.slots ?? {},
      quoteCard: res.quote_card ?? null,
      breadcrumbs: res.breadcrumbs ?? [],
      ui:
        res.ui ??
        {
          rail_update: false,
          sticky_total: null,
          current_step: "service_type",
        },
      ready: (res.state?.next_needed?.length ?? 1) === 0,
      onConfirm,
      onEdit: openEditorForField,
      show: true,
    });
  }

  /* ------------------------ POC: rehydrate on mount (deferred) ------------------------ */
  useEffect(() => {
    // only try to restore if we navigated to a specific session and we weren't
    // explicitly seeded by Calendar / first message
    const hasSeed =
      location.state?.seedFirstMessage || location.state?.seedBooking;
    if (!routeSessionId || hasSeed) return;

    // 🔁 always look up snapshot (even if we already used initialSnapshot)
    const raw = localStorage.getItem(snapshotKeyFor(routeSessionId));
    if (!raw) return;

    try {
      const snap = JSON.parse(raw);
      setMessages(snap.messages ?? []);
      setChips(snap.chips ?? []);
      setChipset(snap.chipset ?? []);
      setPicker(snap.picker ?? null);
      setPickerValue(snap.pickerValue ?? "");
      setState(snap.state ?? null);
      setQuoteCard(snap.quoteCard ?? null);
      setUi(
        snap.ui ?? {
          rail_update: false,
          sticky_total: null,
          current_step: "service_type",
        }
      );
      setBreadcrumbs(snap.breadcrumbs ?? []);
      draftRef.current = snap.draft ?? {};

      // re-show right rail exactly how it was — now with summary
      onRightRail?.({
        summary: snap.state?.slots ?? {},
        quoteCard: snap.quoteCard ?? null,
        breadcrumbs: snap.breadcrumbs ?? [],
        ui:
          snap.ui ?? {
            rail_update: false,
            sticky_total: null,
            current_step: "service_type",
          },
        ready: (snap.state?.next_needed?.length ?? 1) === 0,
        onConfirm,
        onEdit: openEditorForField,
        show: (snap.messages ?? []).length > 0,
      });
    } catch (e) {
      console.warn("Could not rehydrate chat snapshot:", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSessionId]);

  /* ---------------------- POC: keep snapshot up to date -------------------- */
  useEffect(() => {
    if (!sessionId) return;
    const payload = {
      messages,
      chips,
      chipset,
      picker,
      pickerValue,
      state,
      quoteCard,
      ui,
      draft: draftRef.current,
      breadcrumbs,
      headline,
      landingInput,
      at: Date.now(),
    };
    try {
      localStorage.setItem(
        snapshotKeyFor(sessionId),
        JSON.stringify(payload)
      );
    } catch (e) {
      // ignore quota errors
    }
  }, [
    sessionId,
    messages,
    chips,
    chipset,
    picker,
    pickerValue,
    state,
    quoteCard,
    ui,
    breadcrumbs,
    headline,
    landingInput,
  ]);

  /* ----------------------- Smart Chips (big/modern UI) ---------------------- */
  function SmartChips() {
    const items =
      chipset?.length
        ? chipset
        : chips?.map((c) => ({ label: c, event: null })) || [];
    if (!items.length) return null;

    const field = items[0]?.event?.value?.field;

    if (field === "service_type") {
      const def = [
        { title: "Moving", icon: movingIcon, value: "moving" },
        { title: "Cleaning", icon: cleaningIcon, value: "cleaning" },
        { title: "Other", icon: otherIcon, value: "other" },
      ];
      return (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {def.map((s, i) => (
            <CardButton
              key={i}
              title={s.title}
              icon={s.icon}
              onClick={() =>
                onStructuredChipClick({
                  event: {
                    event_type: "user_select",
                    value: { field: "service_type", value: s.value },
                  },
                })
              }
            />
          ))}
        </div>
      );
    }

    if (field === "workers") {
      return (
        <div className="mt-4 grid grid-cols-5 sm:grid-cols-10 gap-2">
          {items.map((it, i) => (
            <Pill key={i} onClick={() => onStructuredChipClick(it)}>
              {it.label}
            </Pill>
          ))}
        </div>
      );
    }

    if (field === "duration_hours") {
      return (
        <div className="mt-4 grid grid-cols-3 gap-3">
          {items.map((it, i) => (
            <Pill key={i} onClick={() => onStructuredChipClick(it)}>
              {it.label}
            </Pill>
          ))}
        </div>
      );
    }

    if (field === "tools") {
      return (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {items.map((it, i) => (
            <Pill key={i} onClick={() => onStructuredChipClick(it)}>
              {it.label}
            </Pill>
          ))}
        </div>
      );
    }

    return (
      <div className="mt-4 flex flex-wrap gap-2.5">
        {items.map((c, i) => (
          <button
            key={i}
            onClick={() =>
              c.event ? onStructuredChipClick(c) : onLegacyChipClick(c.label)
            }
            className="inline-flex items-center justify-center px-4 py-2 rounded-2xl text-[15px] font-medium tracking-[-0.01em]
                      bg-white/90 border border-gray-200 text-[#04193b] shadow-sm
                      hover:border-[#04193b] hover:shadow-md active:scale-[0.99]
                      focus:outline-none focus-visible:ring-4 focus-visible:ring-[#04193b]/20
                      transition-all duration-200"
          >
            {c.label}
          </button>
        ))}
      </div>
    );
  }

  // markdown components WITH button wiring (so restored "Continue booking" works)
  const mdComponents = useMemo(() => {
    return {
      ...baseMdComponents,
      button: (p) => {
        const label = Array.isArray(p.children)
          ? p.children.join(" ")
          : typeof p.children === "string"
          ? p.children
          : "continue booking";
        return (
          <button
            onClick={() => sendUserMessage(label)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#04193b] text-white text-sm"
          >
            {p.children}
          </button>
        );
      },
    };
  }, [sendUserMessage]);

  /* --------------------------- Picker rendering ---------------------------- */
  const AddressPicker = () =>
    !picker ? null : (
      <div className="w-full flex justify-start">
        <div className="max-w-[760px] w-full">
          <div className="bg-white rounded-2xl px-4 py-4 sm:px-5 sm:py-5 text-[15px] leading-relaxed border border-gray-200 shadow-sm">
            <div className="font-medium mb-2">Enter address</div>
            <GooglePlacesAddressInput
              initialValue={pickerValue}
              onChangeText={(val) => setPickerValue(val)}
              onPlaceSelected={(formatted, components) => {
                const country = components?.find((c) =>
                  c.types?.includes("country")
                )?.short_name;
                if (country !== "US") {
                  setPickerValue("");
                  return;
                }
                setPickerValue(formatted);
              }}
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={submitPicker}
                className="rounded-xl px-4 py-2 border border-transparent bg-[#04193b] text-white hover:opacity-90 text-sm"
              >
                Set
              </button>
              <button
                onClick={() => {
                  setPicker(null);
                  setPickerValue("");
                }}
                className="rounded-xl px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );

  const TextFieldPicker = ({ label, placeholder, maxLen, field }) => {
    const [val, setVal] = useState("");
    const remaining = maxLen - val.length;
    return (
      <div className="w-full flex justify-start">
        <div className="max-w-[760px] w-full">
          <div className="bg-white rounded-2xl px-4 py-4 sm:px-5 sm:py-5 text-[15px] leading-relaxed border border-gray-200 shadow-sm">
            <div className="font-medium mb-2">{label}</div>
            <div className="flex gap-2 items-center">
              <input
                type="text"
                maxLength={maxLen}
                placeholder={placeholder}
                className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-3 outline-none focus:ring-2 focus:ring-[#04193b]/10"
                value={val}
                onChange={(e) => setVal(e.target.value)}
              />
            </div>
            <div className="mt-2 text-xs text-gray-500">
              {remaining} characters left
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={async () => {
                  if (!val.trim()) return;

                  draftRef.current = {
                    ...(draftRef.current || state?.slots || {}),
                    [field]: val.trim(),
                  };

                  setWaiting(true);
                  try {
                    const r = await brainTurn({
                      sessionId,
                      type: "user_pick",
                      value: { field, value: val.trim() },
                      uid,
                    });
                    applyTurn(r);
                  } finally {
                    setWaiting(false);
                  }
                }}
                className="rounded-xl px-4 py-2 border border-transparent bg-[#04193b] text-white hover:opacity-90 text-sm"
              >
                Set
              </button>
              <button
                onClick={() => {
                  setPicker(null);
                }}
                className="rounded-xl px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const OnsitePhonePicker = ({ initial }) => {
    const [val, setVal] = useState(e164ToPretty(initial || ""));
    const [touched, setTouched] = useState(false);

    const e164 = toE164US(val);
    const valid = Boolean(e164);

    return (
      <div className="w-full flex justify-start">
        <div className="max-w-[760px] w-full">
          <div className="bg-white rounded-2xl px-4 py-4 sm:px-5 sm:py-5 text-[15px] leading-relaxed border border-gray-200 shadow-sm">
            <div className="font-medium mb-2">On-site phone number</div>
            <div className="flex gap-2 items-center">
              <input
                type="tel"
                inputMode="tel"
                placeholder="(555) 123-4567"
                className={[
                  "flex-1 rounded-xl border bg-white px-3 py-3 outline-none focus:ring-2 focus:ring-[#04193b]/10",
                  touched && !valid ? "border-red-300" : "border-gray-200",
                ].join(" ")}
                value={val}
                onChange={(e) => setVal(prettyUS(e.target.value))}
                onBlur={() => setTouched(true)}
              />
            </div>
            <div className="mt-2 text-xs">
              {!touched || valid ? (
                <span className="text-gray-500">US numbers only</span>
              ) : (
                <span className="text-red-600">
                  Enter a valid US phone number.
                </span>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                disabled={!valid}
                onClick={async () => {
                  if (!valid) return;
                  draftRef.current = {
                    ...(draftRef.current || state?.slots || {}),
                    onsite_manager_phone: e164,
                  };

                  setWaiting(true);
                  try {
                    const r = await brainTurn({
                      sessionId,
                      type: "user_pick",
                      value: {
                        field: "onsite_manager_phone",
                        value: e164,
                      },
                      uid,
                    });
                    applyTurn(r);
                  } finally {
                    setWaiting(false);
                    setPicker(null);
                  }
                }}
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
                onClick={() => setPicker(null)}
                className="rounded-xl px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  /* ----------------------- Helpers for focus-mode view ---------------------- */
  const lastUserIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].who === "user") return i;
    }
    return -1;
  }, [messages]);

  const history = lastUserIdx > 0 ? messages.slice(0, lastUserIdx) : [];
  const activeUserMsg = lastUserIdx >= 0 ? messages[lastUserIdx] : null;

  const latestAssistantMsg = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].who === "assistant") return messages[i];
    }
    return null;
  }, [messages]);

  const thread = useMemo(
    () => (
      <div className="relative">
        {!isLanding && (
          <div ref={progressRef} className="sticky top-0 z-20">
            <div className="max-w-[760px] mx-auto px-4">
              <JobSummary state={state} quoteCard={quoteCard} />
            </div>
          </div>
        )}

        <div
          ref={threadRef}
          id="chat-thread"
          className={
            isLanding
              ? "h-[calc(100dvh-56px)] overflow-hidden px-4"
              : "h-[calc(100dvh-180px)] overflow-y-auto px-4"
          }
          style={{
            "--viewportH": isLanding
              ? "calc(100dvh - 56px)"
              : "calc(100dvh - 180px)",
          }}
        >
          <div className="max-w-[760px] mx-auto">
            {isLanding ? (
              <div className="w-full min-h-[calc(100dvh-340px)] flex flex-col items-center justify-center px-4 pt-25 sm:pt-0">
                <h1 className="text-[28px] sm:text-[32px] font-semibold text-center mb-6">
                  {headline}
                </h1>

                <form onSubmit={submitLanding} className="w-full max-w-[680px]">
                  <div className="relative rounded-xl border border-gray-200 bg-white shadow-sm">
                    <textarea
                      value={landingInput}
                      onChange={(e) => setLandingInput(e.target.value)}
                      placeholder="Ask anything…"
                      rows={1}
                      className="w-full resize-none outline-none text-[15px] placeholder:text-gray-400 p-4 pr-12 rounded-xl"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          submitLanding(e);
                        }
                      }}
                      autoFocus
                    />
                    <SendButton disabled={landingInput.trim().length === 0} />
                  </div>
                </form>
              </div>
            ) : (
              <>
                {/* History */}
                <div className="space-y-10">
                  {history.map((m, i) => {
                    if (m.who === "assistant") {
                      return (
                        <div key={`h-a-${i}`} className="w-full flex justify-start">
                          <div className="max-w-[760px] w-full">
                            <div className="bg-white rounded-2xl px-4 py-2 text-[16px] leading-relaxed border border-transparent">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={mdComponents}
                              >
                                {m.text}
                              </ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div key={`h-u-${i}`} className="w-full flex justify-end">
                        <div className="max-w-[760px]">
                          <div className="bg-gray-100 rounded-2xl px-4 py-3 text-[15px] leading-relaxed text-gray-900 border border-gray-200">
                            {m.text}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Active panel */}
                {activeUserMsg && (
                  <section
                    ref={activeTurnRef}
                    className="mt-4"
                    style={{ "--userH": `${userH}px` }}
                  >
                    <div ref={userBubbleRef} className="pt-2 z-10 xl:sticky xl:top-0">
                      <div className="w-full flex justify-end">
                        <div className="max-w-[760px]">
                          <div className="bg-gray-100 rounded-2xl px-4 py-3 mt-3 text-[15px] leading-relaxed text-gray-900 border border-gray-200">
                            {activeUserMsg.text}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="min-h-[calc(var(--viewportH)-var(--userH))] overflow-y-auto">
                      <div className="w-full flex justify-start">
                        <div className="max-w-[760px] w-full">
                          <div className="bg-white rounded-2xl px-4 py-10 text-[16px] sm:text-[17px] leading-relaxed border border-transparent">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={mdComponents}
                            >
                              {waiting ? "" : latestAssistantMsg?.text ?? ""}
                            </ReactMarkdown>

                            {!waiting && (chipset?.length || chips?.length) ? (
                              <SmartChips />
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {waiting && (
                        <div className="w-full flex justify-start px-4 mt-2">
                          <span className="inline-flex h-5 items-center">
                            <TypingDot />
                          </span>
                        </div>
                      )}

                      {picker?.type === "date_time" && (
                        <CalendarTimePicker
                          preselectedDate={
                            picker?.initialDate ?? state?.slots?.date
                          }
                          preselectedTime={
                            picker?.initialTime ?? state?.slots?.start_time
                          }
                          onPickDateAndTime={async (dateStr, timeStr) => {
                            draftRef.current = {
                              ...(draftRef.current || state?.slots || {}),
                              date: dateStr,
                              start_time: timeStr,
                            };

                            setWaiting(true);
                            try {
                              const res = await brainTurn({
                                sessionId,
                                type: "user_pick",
                                value: {
                                  field: "date_time",
                                  value: { date: dateStr, time: timeStr },
                                },
                                uid,
                              });
                              applyTurn(res);
                            } catch (e) {
                              console.error("date_time picker error:", e);
                            } finally {
                              setPicker(null);
                              setPickerValue("");
                              setWaiting(false);
                            }
                          }}
                          onCancel={() => {
                            setPicker(null);
                            setPickerValue("");
                          }}
                        />
                      )}

                      {picker &&
                        ["date", "start_time"].includes(picker.type) && (
                          <div className="w-full flex justify-start">
                            <div className="max-w-[760px] w-full">
                              <div className="bg-white rounded-2xl px-4 py-3 text-[15px] leading-relaxed border border-gray-200">
                                <div className="font-medium mb-2">
                                  {picker.type === "date"
                                    ? "Pick a date"
                                    : picker.type === "start_time"
                                    ? "Pick a time"
                                    : "Enter address"}
                                </div>
                                <div className="flex gap-2">
                                  <input
                                    type={
                                      picker.type === "date"
                                        ? "date"
                                        : picker.type === "start_time"
                                        ? "time"
                                        : "text"
                                    }
                                    className="flex-1 rounded-md border border-gray-200 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-black/5"
                                    value={pickerValue}
                                    onChange={(e) =>
                                      setPickerValue(e.target.value)
                                    }
                                  />
                                </div>
                                <div className="mt-2 flex gap-2">
                                  <button
                                    onClick={async () => {
                                      draftRef.current = {
                                        ...(draftRef.current || state?.slots || {}),
                                        [picker.type]: pickerValue,
                                      };

                                      setWaiting(true);
                                      try {
                                        const r = await brainTurn({
                                          sessionId,
                                          type: "user_pick",
                                          value: {
                                            field: picker.type,
                                            value: pickerValue,
                                          },
                                          uid,
                                        });
                                        applyTurn(r);
                                      } finally {
                                        setPicker(null);
                                        setPickerValue("");
                                        setWaiting(false);
                                      }
                                    }}
                                    className="rounded-md px-3 py-1.5 border border-gray-200 bg-white hover:bg-gray-50 text-sm"
                                  >
                                    Set
                                  </button>
                                  <button
                                    onClick={() => {
                                      setPicker(null);
                                      setPickerValue("");
                                    }}
                                    className="rounded-md px-3 py-1.5 hover:bg-gray-100 text-sm"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                      {picker && picker.type === "address" && <AddressPicker />}

                      {picker &&
                        (picker.type === "onsite_manager_phone" ||
                          picker.type === "contact_phone" ||
                          picker.type === "phone") && (
                          <OnsitePhonePicker
                            initial={state?.slots?.onsite_manager_phone || ""}
                          />
                        )}

                      {picker && picker?.type === "tools_details" && (
                        <TextFieldPicker
                          label="Which tools should we bring?"
                          placeholder="e.g., power drill, ladder, basic toolkit"
                          maxLen={120}
                          field="tools_details"
                        />
                      )}

                      {picker && picker?.type === "notes" && (
                        <TextFieldPicker
                          label="Worker notes"
                          placeholder="Brief notes for the crew (max 150 chars)…"
                          maxLen={150}
                          field="notes"
                        />
                      )}

                      <div className="h-8" />
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    ),
    [
      messages,
      chipset,
      chips,
      picker,
      waiting,
      state,
      quoteCard,
      ui?.current_step,
      isLanding,
      landingInput,
      userH,
      latestAssistantMsg,
      headline,
      mdComponents,
    ]
  );

  return (
    <div className="relative">
      {thread}

      {!isLanding && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-12 z-20 pointer-events-none">
          <ScrollToBottom container={scrollEl} className="pointer-events-auto" />
        </div>
      )}

      {!isLanding && (
        <form
          className="sticky bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white/90 to-transparent pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            sendUserMessage(input);
          }}
        >
          <div className="max-w-[760px] mx-auto px-4">
            <div>
              <div className="relative rounded-xl border border-gray-200 bg-white shadow-sm px-3 py-3 pr-14">
                <textarea
                  className="w-full resize-none bg-transparent outline-none text-[15px] leading-6 max-h-40"
                  rows={1}
                  placeholder="Ask anything…"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.currentTarget.style.height = "0px";
                    e.currentTarget.style.height =
                      e.currentTarget.scrollHeight + "px";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendUserMessage(input);
                    }
                  }}
                  disabled={sending}
                />
                <SendButton disabled={sending || input.trim().length === 0} />
              </div>
            </div>

            {/* Mobile: "View details" — Ghost with divider */}
            <div className="xl:hidden mt-3">
              <div className="mx-auto w-full max-w-[560px] border-t border-gray-200" />
              <div className="mt-2 flex justify-center">
                <button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(new Event("right-rail:open"))
                  }
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-gray-900 hover:bg-gray-100 active:bg-gray-200 transition"
                  aria-label="View booking details"
                >
                  <span>Confirm & Book</span>
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

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={onNewChat}
                className="hidden px-3 py-1.5 rounded-md border border-gray-200 bg-white shadow-sm hover:bg-gray-50 text-sm"
              >
                New chat
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

/* ---------------------- Google Places input (US-only) ---------------------- */
function GooglePlacesAddressInput({ initialValue, onChangeText, onPlaceSelected }) {
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    libraries: PLACES_LIBS,
  });

  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);

  const handleInput = useCallback(
    (e) => {
      onChangeText?.(e.target.value);
    },
    [onChangeText]
  );

  useEffect(() => {
    if (
      !isLoaded ||
      !window.google ||
      !inputRef.current ||
      autocompleteRef.current
    )
      return;

    const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
      types: ["address"],
      fields: ["address_components", "formatted_address"],
      componentRestrictions: { country: "us" },
    });

    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      const formatted = place?.formatted_address || "";
      const comps = place?.address_components || [];
      const country = comps
        .find((c) => c.types.includes("country"))
        ?.short_name;

      if (country !== "US") {
        if (inputRef.current) {
          inputRef.current.value = "";
          inputRef.current.placeholder = "US addresses only";
        }
        onChangeText?.("");
        return;
      }

      if (inputRef.current) inputRef.current.value = formatted;
      onChangeText?.(formatted);
      onPlaceSelected?.(formatted, comps);
    });

    autocompleteRef.current = ac;
  }, [isLoaded, onChangeText, onPlaceSelected]);

  return (
    <>
      <input
        id="address-autocomplete-input"
        ref={inputRef}
        defaultValue={initialValue}
        onInput={handleInput}
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
