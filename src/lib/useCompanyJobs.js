// src/lib/useCompanyJobs.js
import { useEffect, useMemo, useState } from "react";
import {
  collection, query, where, orderBy, onSnapshot, Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { membershipsMe } from "./api";
import { useAuth } from "../context/AuthContext.jsx";

function normalizeJob(doc) {
  const data = doc.data() || {};
  const jd = data.job_details || {};
  const start =
    jd.job_start_timestamp?.toDate?.() ||
    (jd.job_start_iso ? new Date(jd.job_start_iso) : null);

  return {
    id: doc.id,
    start,
    timezone: jd.timezone || "UTC",
    service: (jd.services_requested?.[0] || "").toString(),
    status: data.status || jd.status || "scheduled",
    city: jd.address?.city || "",
    raw: data,
  };
}

/**
 * Stream company jobs in an optional date range.
 * Pass { enabled:false } to defer attaching the listener (e.g., until account/membership is ready).
 */
export function useCompanyJobs({ from, to, enabled = true } = {}) {
  const { user, getIdToken } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const dep = useMemo(
    () => [from?.getTime?.() || 0, to?.getTime?.() || 0],
    [from, to]
  );

  useEffect(() => {
    let unsub = () => {};

    // Gate: do not even attempt to subscribe until explicitly enabled.
    if (!enabled) {
      setLoading(true);   // keep showing skeleton while gated
      setError(null);     // suppress pre-attach errors
      setJobs([]);        // empty while gated
      return () => unsub();
    }

    (async () => {
      setLoading(true);
      setError(null);
      setJobs([]);
      if (!user) { setLoading(false); return; }

      try {
        const me = await membershipsMe(getIdToken);
        const companyId = me?.customer_id ?? me?.data?.customer_id;
        if (!companyId) { setLoading(false); return; }

        const col = collection(db, "jobs");
        const clauses = [
          where("client_info.customer_id", "==", companyId),
          orderBy("job_details.job_start_timestamp", "asc"),
        ];
        if (from) clauses.splice(1, 0,
          where("job_details.job_start_timestamp", ">=", Timestamp.fromDate(from))
        );
        if (to) clauses.push(
          where("job_details.job_start_timestamp", "<=", Timestamp.fromDate(to))
        );

        const q = query(col, ...clauses);
        unsub = onSnapshot(q, (snap) => {
          setJobs(snap.docs.map(normalizeJob));
          setLoading(false);
        }, (e) => {
          setError(e);
          setLoading(false);
        });
      } catch (e) {
        setError(e);
        setLoading(false);
      }
    })();

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, getIdToken, enabled, ...dep]);

  return { jobs, loading, error };
}

/** Helper: range for a calendar month (0-indexed month). */
export function monthRange(year, month) {
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end   = new Date(year, month + 1, 0, 23, 59, 59, 999);
  return { start, end };
}
