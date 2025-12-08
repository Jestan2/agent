// src/App.jsx
import { useState, useCallback, useEffect } from "react";
import {
  Routes,
  Route,
  useNavigate,
  useLocation,
  useParams,
  Navigate,
} from "react-router-dom";
import Chat from "./components/Chat";
import Sidebar from "./components/Sidebar";
import RightRail from "./components/RightRail";
import CalendarView from "./components/CalendarView";
import CalendarRightRail from "./components/CalendarRightRail";
import { createChatSession } from "./lib/api";
import BookingSuccess from "./components/BookingSuccess.jsx";

// Auth sheet
import AuthSheet from "./components/AuthSheet";

// Account page
import Account from "./pages/Account.jsx";

// Accept Invite page
import AcceptInvite from "./pages/AcceptInvite.jsx";

// NEW: Job activity page (read-only activity feed)
import JobActivity from "./components/JobActivity";

// Firebase auth observer (for gating /account and suppressing sheet for authed users)
import { observeAuthState } from "./lib/firebase";

/* ---------------- Shells ---------------- */
function ChatRouteShell({
  sidebarOpen,
  setSidebarOpen,
  sidebarCollapsed,
  setSidebarCollapsed,
  rail,
  handleRightRail,
}) {
  const { sessionId } = useParams(); // undefined on "/"
  const navigate = useNavigate();
  const chatKey = sessionId ?? "landing";

  // If we land on "/", but we already have a saved chat snapshot, go to it
  useEffect(() => {
    if (sessionId) return; // already on /c/:id
    try {
      const storedId = window.localStorage.getItem("bm_session_id");
      if (!storedId) return;
      const snap = window.localStorage.getItem(`chat_snapshot_${storedId}`);
      if (!snap) return;
      navigate(`/c/${storedId}`, { replace: true });
    } catch {
      // ignore
    }
  }, [sessionId, navigate]);

  // Remember the last chat/landing route so the Account back button can return here.
  useEffect(() => {
    try {
      const path = sessionId ? `/c/${sessionId}` : "/";
      window.sessionStorage.setItem("last.chat.path", path);
    } catch {}
  }, [sessionId]);

  return (
    <div
      className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_360px] gap-x-6 overflow-hidden min-h-0"
      style={{ height: "calc(100vh - 56px)" }}
    >
      <Sidebar
        open={sidebarOpen}
        setOpen={setSidebarOpen}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />

      <main className="flex overflow-hidden">
        <div className="flex-1">
          <Chat key={chatKey} onRightRail={handleRightRail} />
        </div>
      </main>

      {rail.show && (
        <RightRail
          summary={rail.summary ?? null}
          quoteCard={rail.quoteCard}
          ui={rail.ui}
          ready={rail.ready}
          onConfirm={rail.onConfirm}
          onEdit={rail.onEdit}
          // IMPORTANT: default onApply fallback enables Workers/Duration/Notes Save flow to refresh the rail
          onApply={rail.onApply ?? rail._defaultOnApply}
          onEndEarly={rail.onEndEarly}
          onCancel={rail.onCancel}
          onExtend={rail.onExtend}
        />
      )}
    </div>
  );
}

/** NEW: Job route shell — renders JobActivity in the center and uses the same RightRail */
function JobRouteShell({
  sidebarOpen,
  setSidebarOpen,
  sidebarCollapsed,
  setSidebarCollapsed,
  rail,
  handleRightRail,
}) {
  const { jobId } = useParams();

  return (
    <div
      className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_360px] gap-x-6 overflow-hidden min-h-0"
      style={{ height: "calc(100vh - 56px)" }}
    >
      <Sidebar
        open={sidebarOpen}
        setOpen={setSidebarOpen}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
      />

      <main className="flex overflow-hidden">
        <div className="flex-1">
          {/* JobActivity will fetch job + activity and call onRightRail(...) */}
          <JobActivity jobId={jobId} onRightRail={handleRightRail} />
        </div>
      </main>

      {rail.show && (
        <RightRail
          summary={rail.summary ?? null}
          quoteCard={rail.quoteCard}
          ui={rail.ui}
          ready={rail.ready}
          onConfirm={rail.onConfirm}
          onEdit={rail.onEdit}
          // IMPORTANT: default onApply fallback enables Workers/Duration/Notes Save flow to refresh the rail
          onApply={rail.onApply ?? rail._defaultOnApply}
          onEndEarly={rail.onEndEarly}
          onCancel={rail.onCancel}
          onExtend={rail.onExtend}
        />
      )}
    </div>
  );
}

function CalendarRouteShell({
  calRail,
  openBookForDay,
  openViewForDay,
  closeCalRail,
  confirmCalendarTime,
}) {
  return (
    <div className="h-[calc(100vh-56px)] min-h-0 relative">
      {/* Grid:
         - base: 1 col
         - md–lg: small left spacer to keep calendar visually centered; NO right column width
         - xl+: 360 | calendar | 360 (desktop unchanged)
      */}
      <div className="
        h-full grid grid-cols-1
        md:grid-cols-[clamp(12px,6vw,72px)_minmax(0,1fr)]
        xl:grid-cols-[360px_minmax(0,1fr)_360px]
      ">
        {/* Left spacer (border only from md+) */}
        <div className="hidden md:block h-full border-r border-gray-200" aria-hidden="true" />

        {/* Calendar in the middle always */}
        <CalendarView
          onBookDay={openBookForDay}
          onViewDay={openViewForDay}
          selectedDate={calRail.date}
        />

        {/* DESKTOP (xl+): inline right rail in the third column */}
        {calRail.open ? (
          <div className="hidden xl:block">
            <CalendarRightRail
              open={calRail.open}
              mode={calRail.mode}
              date={calRail.date}
              onClose={closeCalRail}
              onPickTime={confirmCalendarTime}
            />
          </div>
        ) : (
          <div className="hidden xl:block" aria-hidden="true" />
        )}
      </div>

      {/* TABLET overlay (md–lg): floats above the grid so the middle column stays wide/centered */}
      {calRail.open && (
        <div className="md:block xl:hidden fixed right-0 top-[56px] bottom-0 z-40">
          {/* Sheet container width: max 420px, otherwise ~92vw on small tablets */}
          <div className="h-full w-[min(420px,92vw) border-l border-gray-200 shadow-2xl">
            <CalendarRightRail
              open={calRail.open}
              mode={calRail.mode}
              date={calRail.date}
              onClose={closeCalRail}
              onPickTime={confirmCalendarTime}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* -------- Gate: if unauthenticated on /account, open AuthSheet -------- */
function AccountGate({ children, onTriggerAuth }) {
  const [authed, setAuthed] = useState(null);

  useEffect(() => {
    const un = observeAuthState((u) => setAuthed(!!u));
    return () => un && un();
  }, []);

  useEffect(() => {
    if (authed === false) {
      // Defer one frame; only open if we are still on /account.
      const id = requestAnimationFrame(() => {
        if (window.location.pathname === "/account") {
          try {
            window.sessionStorage.setItem(
              "auth.intent",
              JSON.stringify({ type: "goto", path: "/account" })
            );
          } catch {}
          onTriggerAuth?.();
        }
      });
      return () => cancelAnimationFrame(id);
    }
  }, [authed, onTriggerAuth]);

  if (authed === null) return null; // quiet loading
  if (authed === false) return null; // sheet is open; keep page blank behind

  return children;
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Right rail state (shared by Chat + Job views)
  const [rail, setRail] = useState({
    summary: null,
    quoteCard: null,
    ui: {
      rail_update: false,
      sticky_total: null,
      current_step: "service_type",
    },
    ready: false,
    onConfirm: undefined,
    onEdit: undefined,
    onApply: undefined, // preserved if provided by Chat/Job
    onEndEarly: undefined,
    onCancel: undefined,
    onExtend: undefined,
    show: true,
    _defaultOnApply: undefined, // set in effect below
  });

  // --- NEW: helper to replace right-rail from JobOut after Save (Workers/Duration/Notes)
  const replaceRailFromJobOut = useCallback((jobOut) => {
    setRail((prev) => {
      const summary = jobOut?.booking ?? prev.summary ?? null;
      const quoteCard = jobOut?.quote ?? prev.quoteCard ?? null;

      // Push a 'job:updated' event so other components can refresh if they want.
      try {
        window.dispatchEvent(
          new CustomEvent("job:updated", { detail: { job: jobOut } })
        );
      } catch {}

      return {
        ...prev,
        summary,
        quoteCard,
        ready: true,
        ui: {
          ...prev.ui,
          rail_update: true,
          sticky_total:
            (quoteCard && (quoteCard.total ?? quoteCard?.grand_total)) ??
            prev.ui.sticky_total,
        },
      };
    });
  }, []);

  // --- NEW: default onApply the RightRail can call after a successful PATCH
  const handleDefaultOnApply = useCallback(
    (action) => {
      // Convention:
      // action = { kind: 'job.replace', jobOut }
      if (!action) return;

      if (action.kind === "job.replace" && action.jobOut) {
        replaceRailFromJobOut(action.jobOut);
        return;
      }

      // Fallback: allow direct jobOut
      if (action.jobOut) {
        replaceRailFromJobOut(action.jobOut);
      }
    },
    [replaceRailFromJobOut]
  );

  // Keep _defaultOnApply always present on rail
  useEffect(() => {
    setRail((r) => ({ ...r, _defaultOnApply: handleDefaultOnApply }));
  }, [handleDefaultOnApply]);

  const handleRightRail = useCallback((payload) => {
    setRail((prev) => {
      const next = {
        summary: payload?.summary ?? null,
        quoteCard: payload?.quoteCard ?? null,
        ui:
          payload?.ui ?? {
            rail_update: false,
            sticky_total: null,
            current_step: "service_type",
          },
        ready: !!payload?.ready,
        onConfirm: payload?.onConfirm,
        onEdit: payload?.onEdit,
        // Preserve caller onApply; fallback to our default in render
        onApply: payload?.onApply,
        onEndEarly: payload?.onEndEarly,
        onCancel: payload?.onCancel,
        onExtend: payload?.onExtend,
        show: payload?.show !== false,
        _defaultOnApply: prev._defaultOnApply,
      };

      // shallow-ish change detection to avoid pointless re-renders
      if (
        prev.summary === next.summary &&
        prev.quoteCard === next.quoteCard &&
        prev.ready === next.ready &&
        prev.onConfirm === next.onConfirm &&
        prev.onEdit === next.onEdit &&
        prev.onApply === next.onApply &&
        prev.onEndEarly === next.onEndEarly &&
        prev.onCancel === next.onCancel &&
        prev.onExtend === next.onExtend &&
        prev.show === next.show &&
        JSON.stringify(prev.ui) === JSON.stringify(next.ui)
      ) {
        return prev;
      }

      return next;
    });
  }, []);

  // Calendar rail
  const [calRail, setCalRail] = useState({
    open: false,
    mode: "book",
    date: null,
  });
  const openBookForDay = useCallback(
    (d) => setCalRail({ open: true, mode: "book", date: new Date(d) }),
    []
  );
  const openViewForDay = useCallback(
    (d) => setCalRail({ open: true, mode: "view", date: new Date(d) }),
    []
  );
  const closeCalRail = useCallback(
    () => setCalRail((r) => ({ ...r, open: false })),
    []
  );

  const confirmCalendarTime = useCallback(
    async (timeStr) => {
      if (!calRail.date) return;
      const yyyy = calRail.date.getFullYear();
      const mm = String(calRail.date.getMonth() + 1).padStart(2, "0");
      const dd = String(calRail.date.getDate()).padStart(2, "0");
      const dateStr = `${yyyy}-${mm}-${dd}`;

      const { session_id } = await createChatSession({ uid: "demo-user-1" });
      navigate(`/c/${session_id}`, {
        state: { seedBooking: { date: dateStr, start_time: timeStr } },
      });
      setCalRail((r) => ({ ...r, open: false }));
    },
    [calRail.date, navigate]
  );

  const isCalendar = location.pathname.startsWith("/calendar");
  const isAccount = location.pathname.startsWith("/account");
  const isBook = !isCalendar; // job pages count as "Book" tab selected

  /* -------------------- Global Auth Sheet wiring -------------------- */
  const [authOpen, setAuthOpen] = useState(false);
  const [authPayload, setAuthPayload] = useState({ resumeAction: null });

  // Track auth at top-level so we can suppress the sheet when already signed-in
  const [authed, setAuthed] = useState(null);
  useEffect(() => {
    const un = observeAuthState((u) => setAuthed(!!u));
    return () => un && un();
  }, []);

  const openAuthSheet = useCallback((payload) => {
    setAuthPayload(payload || { resumeAction: null });
    setAuthOpen(true);
  }, []);

  useEffect(() => {
    const onOpen = (e) => {
      const detail = e?.detail || {};

      // If already authenticated, do NOT flash the sheet.
      if (authed && !detail?.allowWhenAuthed) {
        // honor any stored intent and navigate, then clear it
        try {
          const raw = window.sessionStorage.getItem("auth.intent");
          if (raw) {
            const intent = JSON.parse(raw);
            window.sessionStorage.removeItem("auth.intent");
            if (intent?.path && location.pathname !== intent.path) {
              navigate(intent.path, { replace: true });
              return;
            }
          }
        } catch {}

        // If caller intended to go to /account (or we’re already there), just navigate (no sheet)
        if (
          detail?.resumeAction?.type === "goto" &&
          detail?.resumeAction?.path === "/account"
        ) {
          if (location.pathname !== "/account") navigate("/account");
          return;
        }
        // Otherwise do nothing—user is signed in.
        return;
      }

      // Open the sheet (either not authed, or explicitly allowed while authed)
      openAuthSheet(detail);
    };

    const onClose = () => setAuthOpen(false);

    window.addEventListener("auth:open", onOpen);
    window.addEventListener("auth:close", onClose);
    return () => {
      window.removeEventListener("auth:open", onOpen);
      window.removeEventListener("auth:close", onClose);
    };
  }, [authed, location.pathname, navigate, openAuthSheet]);

  const handleAuthComplete = useCallback(
    (payload) => {
      try {
        const raw = window.sessionStorage.getItem("auth.intent");
        if (raw) {
          const intent = JSON.parse(raw);
          window.sessionStorage.removeItem("auth.intent");
          if (intent?.path) {
            navigate(intent.path, { replace: true });
          }
        }
      } catch {}
      try {
        window.dispatchEvent(
          new CustomEvent("auth:done", { detail: payload || {} })
        );
      } catch {}
      setAuthOpen(false);
    },
    [navigate]
  );

  // Back button behavior for /account → last chat path or /c/<bm_session_id> or home
  const backToChatOrHome = useCallback(() => {
    let target = "/";
    try {
      // 1) preferred: explicit last chat path from the chat shell
      const stored = window.sessionStorage.getItem("last.chat.path");
      if (stored && typeof stored === "string" && stored.length > 0) {
        target = stored;
      } else {
        // 2) fallback: a persisted session id from localStorage (what Chat uses)
        const sid = window.localStorage.getItem("bm_session_id");
        if (sid && typeof sid === "string" && sid.length > 0) {
          target = `/c/${sid}`;
        }
      }
    } catch {
      // final fallback: try localStorage again
      try {
        const sid = window.localStorage.getItem("bm_session_id");
        if (sid) target = `/c/${sid}`;
      } catch {}
    }
    navigate(target, { replace: true });
  }, [navigate]);

  // Book button should also prefer the last chat / saved snapshot
  const goToBook = useCallback(() => {
    let target = "/";
    try {
      // 1) prefer the exact last chat path
      const stored = window.sessionStorage.getItem("last.chat.path");
      if (stored) {
        target = stored;
      } else {
        // 2) fall back to localStorage + snapshot
        const sid = window.localStorage.getItem("bm_session_id");
        if (sid) {
          const snap = window.localStorage.getItem(`chat_snapshot_${sid}`);
          if (snap) {
            target = `/c/${sid}`;
          }
        }
      }
    } catch {}
    navigate(target);
  }, [navigate]);

  /* ------------------------------------------------------------------ */

  return (
    <div className="min-h-screen bg-white text-[#111827]">
    {/* Top bar */}
    <header className="sticky top-0 z-50 h-12 border-b border-gray-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      {/* 84px | center | 84px grid keeps the middle perfectly centered */}
      <div className="h-full w-full grid grid-cols-[84px_1fr_84px] items-center px-2">
        {/* LEFT CELL -------------------------------------------------------- */}
        <div className="flex items-center">
          {isAccount ? (
            <button
              type="button"
              onClick={backToChatOrHome}
              className="inline-flex items-center h-9 px-3 rounded-full border border-gray-200 text-gray-800 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
              aria-label="Back"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M15 19l-7-7 7-7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="ml-1 text-sm hidden sm:inline">Back</span>
            </button>
          ) : (
            // Mobile-only sidebar trigger; the cell itself stays 84px wide
            !isCalendar && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="xl:hidden inline-flex items-center h-9 px-3 rounded-full border border-gray-200 text-gray-800 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
                aria-label="Open sidebar"
              >
                {/* “two lines” icon */}
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M4 13h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            )
          )}
        </div>

        {/* CENTER CELL ------------------------------------------------------ */}
        <nav role="tablist" aria-label="Primary" className="justify-self-center">
          <div className="relative flex items-center gap-2 p-1 rounded-full">
            <button
              type="button"
              role="tab"
              aria-selected={isBook}
              aria-current={isBook ? "page" : undefined}
              onClick={goToBook}
              className={`px-4 py-1.5 text-[15px] font-medium rounded-full transition-all
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300
                ${isBook ? "bg-gray-900 text-white shadow-sm" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"}`}
            >
              Book
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={isCalendar}
              aria-current={isCalendar ? "page" : undefined}
              onClick={() => navigate("/calendar")}
              className={`px-4 py-1.5 text-[15px] font-medium rounded-full transition-all
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300
                ${isCalendar ? "bg-gray-900 text-white shadow-sm" : "text-gray-500 hover:text-gray-900 hover:bg-gray-100"}`}
            >
              Calendar
            </button>
          </div>
        </nav>

        {/* RIGHT CELL (empty spacer to balance the grid) -------------------- */}
        <div />
      </div>
    </header>


      {/* Routes */}
      <Routes>
        <Route
          path="/"
          element={
            <ChatRouteShell
              sidebarOpen={sidebarOpen}
              setSidebarOpen={setSidebarOpen}
              sidebarCollapsed={sidebarCollapsed}
              setSidebarCollapsed={setSidebarCollapsed}
              rail={rail}
              handleRightRail={handleRightRail}
            />
          }
        />
        <Route
          path="/c/:sessionId"
          element={
            <ChatRouteShell
              sidebarOpen={sidebarOpen}
              setSidebarOpen={setSidebarOpen}
              sidebarCollapsed={sidebarCollapsed}
              setSidebarCollapsed={setSidebarCollapsed}
              rail={rail}
              handleRightRail={handleRightRail}
            />
          }
        />

        {/* NEW: job details + activity */}
        <Route
          path="/job/:jobId"
          element={
            <JobRouteShell
              sidebarOpen={sidebarOpen}
              setSidebarOpen={setSidebarOpen}
              sidebarCollapsed={sidebarCollapsed}
              setSidebarCollapsed={setSidebarCollapsed}
              rail={rail}
              handleRightRail={handleRightRail}
            />
          }
        />

        <Route
          path="/calendar"
          element={
            <CalendarRouteShell
              calRail={calRail}
              openBookForDay={openBookForDay}
              openViewForDay={openViewForDay}
              closeCalRail={closeCalRail}
              confirmCalendarTime={confirmCalendarTime}
            />
          }
        />
        {/* Account (guarded: opens AuthSheet if not logged in) */}
        <Route
          path="/account"
          element={
            <AccountGate
              onTriggerAuth={() =>
                window.dispatchEvent(
                  new CustomEvent("auth:open", {
                    detail: {
                      resumeAction: { type: "goto", path: "/account" },
                    },
                  })
                )
              }
            >
              <Account />
            </AccountGate>
          }
        />

        {/* Accept Invite */}
        <Route path="/accept" element={<AcceptInvite />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BookingSuccess />
      {/* Global Auth Sheet */}
      <AuthSheet
        open={authOpen}
        onClose={() => {
          // Close the sheet
          setAuthOpen(false);
          // Clear any pending "return" intent
          try {
            window.sessionStorage.removeItem("auth.intent");
          } catch {}
          // If user cancelled while on /account (and is unauthenticated), send them home
          if (location.pathname === "/account" && authed === false) {
            navigate("/", { replace: true });
          }
        }}
        resumeAction={authPayload?.resumeAction || null}
        onComplete={handleAuthComplete}
      />
    </div>
  );
}
