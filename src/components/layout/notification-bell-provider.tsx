/**
 * NotificationBellProvider — shell-level state for the topbar bell.
 *
 * Every page renders its own TopBar (and so its own NotificationBell),
 * which means the bell remounted on each cross-section navigation:
 * the badge blinked off, and each remount fired a fresh fetch. The
 * state now lives here, in AppShell (the dashboard layout persists
 * across navigations), and the bell just reads it.
 *
 * Reads go through `GET /api/notifications/bell`, NOT a Server Action:
 * Next dispatches Server Actions one at a time per client, so a polled
 * Server Action would queue ahead of the user's real mutations. The
 * poll only runs while the tab is visible and refetches the moment it
 * becomes visible again.
 *
 * Mark-read mutations stay Server Actions. They update the badge
 * optimistically, and the provider reconciles with the server once
 * every in-flight mutation has settled. A fetch that started before a
 * mutation (or that lands while one is pending) is discarded so it
 * can't resurrect rows the user just cleared. A mutation that throws
 * (deploy skew, DB error) or returns `{ ok: false }` surfaces an
 * inline error instead of bubbling into an error boundary.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { markAllNotificationsRead, markNotificationRead } from "@/app/actions/notifications";
import type { NotificationRow, NotificationsBell } from "@/lib/queries/notifications";

const POLL_MS = 60_000;
export const BELL_ENDPOINT = "/api/notifications/bell";
export const BELL_MUTATION_ERROR = "Couldn't update notifications. Please try again.";

type BellWire = {
  unreadCount: number;
  recent: Array<Omit<NotificationRow, "createdAt"> & { createdAt: string }>;
};

async function fetchBell(): Promise<NotificationsBell> {
  const res = await fetch(BELL_ENDPOINT, { cache: "no-store" });
  if (!res.ok) throw new Error(`bell fetch failed (${res.status})`);
  const json = (await res.json()) as BellWire;
  return {
    unreadCount: json.unreadCount,
    recent: json.recent.map((r) => ({
      ...r,
      createdAt: new Date(r.createdAt),
    })),
  };
}

export type BellContextValue = {
  /** null until the first fetch lands (badge hidden). */
  state: NotificationsBell | null;
  /** Inline error from the last failed mark-read, cleared on the next try. */
  error: string | null;
  /** Fetch the latest state now (dropdown open, etc.). */
  refresh: () => Promise<void>;
  markOne: (row: NotificationRow) => void;
  markAll: () => void;
};

// Inert default so a TopBar rendered outside the shell (isolated
// tests) shows an empty bell instead of throwing.
const INERT: BellContextValue = {
  state: null,
  error: null,
  refresh: async () => {},
  markOne: () => {},
  markAll: () => {},
};

const Ctx = createContext<BellContextValue>(INERT);

export function NotificationBellProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NotificationsBell | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Bumped on every optimistic mutation: a fetch captured before the
  // bump is stale. `latestFetch` drops out-of-order responses.
  // `pending` counts mutations still awaiting their action.
  const mutationSeq = useRef(0);
  const latestFetch = useRef(0);
  const pending = useRef(0);

  const refresh = useCallback(async () => {
    const seqAtStart = mutationSeq.current;
    const mine = ++latestFetch.current;
    try {
      const next = await fetchBell();
      if (
        mutationSeq.current !== seqAtStart ||
        pending.current > 0 ||
        latestFetch.current !== mine
      ) {
        return;
      }
      setState(next);
    } catch (err) {
      // Bell fetch failures are non-blocking — the user's primary
      // work doesn't depend on it.
      console.warn("[notification-bell] fetch failed", err);
    }
  }, []);

  // Initial fetch + visible-only poll + refetch on tab re-focus.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  const mutate = useCallback(
    (
      optimistic: (prev: NotificationsBell | null) => NotificationsBell | null,
      action: () => Promise<{ ok: boolean }>,
    ) => {
      mutationSeq.current++;
      pending.current++;
      setError(null);
      setState(optimistic);
      startTransition(async () => {
        try {
          const res = await action();
          if (!res.ok) throw new Error("action returned ok:false");
        } catch (err) {
          console.warn("[notification-bell] mark-read failed", err);
          setError(BELL_MUTATION_ERROR);
        } finally {
          pending.current--;
          // Reconcile with the server (also rolls the optimistic
          // change back when the action failed).
          if (pending.current === 0) await refresh();
        }
      });
    },
    [refresh],
  );

  const markOne = useCallback(
    (row: NotificationRow) => {
      if (row.isRead) return;
      mutate(
        (prev) =>
          prev
            ? {
                unreadCount: Math.max(0, prev.unreadCount - 1),
                recent: prev.recent.map((r) => (r.id === row.id ? { ...r, isRead: true } : r)),
              }
            : prev,
        () => markNotificationRead(row.id),
      );
    },
    [mutate],
  );

  const markAll = useCallback(() => {
    mutate(
      (prev) =>
        prev
          ? {
              unreadCount: 0,
              recent: prev.recent.map((r) => ({ ...r, isRead: true })),
            }
          : prev,
      () => markAllNotificationsRead(),
    );
  }, [mutate]);

  const value = useMemo<BellContextValue>(
    () => ({ state, error, refresh, markOne, markAll }),
    [state, error, refresh, markOne, markAll],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNotificationBell(): BellContextValue {
  return useContext(Ctx);
}
