// src/components/ScrollToBottom.jsx
import { useEffect, useMemo, useState } from "react";

export default function ScrollToBottom({ container, hideThreshold = 48 }) {
  const [visible, setVisible] = useState(false);

  const onScroll = useMemo(() => {
    let ticking = false;
    return () => {
      if (!container || ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const dist =
          container.scrollHeight - container.scrollTop - container.clientHeight;
        setVisible(dist > hideThreshold);
        ticking = false;
      });
    };
  }, [container, hideThreshold]);

  useEffect(() => {
    if (!container) return;
    onScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [container, onScroll]);

  const scrollDown = () =>
    container?.scrollTo({ top: container.scrollHeight, behavior: "smooth" });

  return (
    <div
      aria-hidden={!visible}
      className={[
        "pointer-events-none fixed left-1/2 -translate-x-1/2 z-40",
        // moved up a bit
        "bottom-28 sm:bottom-26",
        "transition-all duration-200 ease-out",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={scrollDown}
        aria-label="Scroll to latest"
        className={[
          "pointer-events-auto inline-flex items-center gap-1.5",
          "rounded-full border border-[var(--border)] bg-white shadow-sm",
          "px-3 py-1.5 text-sm text-gray-700",
          "hover:bg-gray-50 active:bg-gray-100",
        ].join(" ")}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="translate-y-[1px]">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {/* Removed the "New message" text */}
      </button>
    </div>
  );
}
