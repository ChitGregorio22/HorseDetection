import { useCallback, useEffect, useState } from 'react';
import { getLatestPiReading, getLiveView, subscribeToChanges, toLiveView, type LiveHorse, type LiveView, type PiReading } from '../lib/api';

const POLL_MS = 2000; // fallback if realtime is down: realtime pushes changes at once
/** The Pi sends every ~2 s. Older than this = the monitor stopped or lost internet. */
export const LIVE_STALE_MS = 15000;

/**
 * What the stall camera sees right now (which horse, its temperature, air temperature, humidity).
 * view: undefined = loading or 08_live_view.sql not installed, null = the Pi hasn't sent anything yet.
 */
export function useLiveView(enabled: boolean) {
  const [view, setView] = useState<LiveView | null | undefined>(undefined);
  const [installed, setInstalled] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [lastPiReading, setLastPiReading] = useState<PiReading | null>(null);

  const refresh = useCallback(async () => {
    try {
      const v = await getLiveView();
      if (v === undefined) {
        setInstalled(false);
        setView(undefined);
      } else {
        setInstalled(true);
        setView(v);
      }
    } catch {
      /* network hiccup: keep the last view, it turns "stale" by itself */
    }
    const r = await getLatestPiReading();
    if (r) setLastPiReading((prev) => (prev?.id === r.id ? prev : r));
    setNow(Date.now());
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    const unsubscribe = subscribeToChanges('live', ['live_view'], (_table, row) => {
      if (!row.device_id || !row.state) return;
      setView(toLiveView(String(row.device_id), row.state as Record<string, unknown>, String(row.updated_at)));
      setNow(Date.now());
    });
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [enabled, refresh]);

  const ageMs = view ? Math.max(0, now - new Date(view.updated_at).getTime()) : null;
  const fresh = ageMs !== null && ageMs < LIVE_STALE_MS;
  const main = fresh && view ? pickMainHorse(view.horses) : null;
  return { view, installed, fresh, ageMs, main, lastPiReading, refresh };
}

/** The horse the Dashboard follows: an identified one first, otherwise whoever is in view. */
export function pickMainHorse(horses: LiveHorse[]): LiveHorse | null {
  return horses.find((h) => h.status === 'identified') ?? horses[0] ?? null;
}
