import { useEffect, useState } from 'react';
import { QrCode, ScanFace } from 'lucide-react';
import { getRecentReadings, subscribeToChanges, timeAgo, type IdMethod, type Reading } from '../lib/api';

export const fmtTemp = (v: number | null | undefined, digits = 1) => (v == null ? '—' : `${v.toFixed(digits)}°C`);
export const fmtHumidity = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(0)}%`);

export function fmtWhen(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "via QR" / "fingerprint" / "manual" tag for a reading */
export function MethodBadge({ method, manual }: { method: IdMethod | null | undefined; manual?: boolean }) {
  if (method === 'qr') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-purple-100 px-2 py-0.5 text-base text-purple-800">
        <QrCode className="h-4 w-4" /> via QR
      </span>
    );
  }
  if (method === 'fingerprint') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-base text-gray-700">
        <ScanFace className="h-4 w-4" /> fingerprint
      </span>
    );
  }
  return manual ? <span className="rounded-md bg-gray-100 px-2 py-0.5 text-base text-gray-600">manual</span> : null;
}

/** The newest readings of one horse, live (new rows appear by themselves). */
export function useRecentReadings(horseId: string | null | undefined, limit = 20) {
  const [rows, setRows] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!horseId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    const load = () =>
      getRecentReadings(horseId, limit)
        .then((r) => !cancelled && setRows(r))
        .catch(() => !cancelled && setRows([]))
        .finally(() => !cancelled && setLoading(false));
    setLoading(true);
    load();
    const unsubscribe = subscribeToChanges('recent', ['temperature_readings'], () => load(), horseId);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [horseId, limit]);
  return { rows, loading };
}

const STATUS = {
  fever: 'text-red-600',
  warning: 'text-yellow-600',
  normal: 'text-green-700',
} as const;

/** Table: time, body, surface, air, humidity, method (newest first) */
export function RecentReadingsTable({ rows, loading }: { rows: Reading[]; loading: boolean }) {
  if (loading && rows.length === 0) return <p className="text-lg text-gray-600">Loading readings…</p>;
  if (rows.length === 0) return <p className="text-lg text-gray-600">No readings yet.</p>;
  const newest = [...rows].reverse();
  return (
    <div className="overflow-x-auto rounded-xl border-2 border-gray-200">
      <table className="w-full min-w-[640px] text-left">
        <thead className="bg-gray-100 text-lg">
          <tr>
            <th className="p-3">Time</th>
            <th className="p-3">Body</th>
            <th className="p-3">Surface</th>
            <th className="p-3">Air</th>
            <th className="p-3">Humidity</th>
            <th className="p-3">Named by</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 text-lg">
          {newest.map((r) => (
            <tr key={r.id}>
              <td className="p-3 text-gray-700" title={new Date(r.recorded_at).toLocaleString()}>
                {fmtWhen(r.recorded_at)} <span className="text-base text-gray-500">({timeAgo(r.recorded_at)})</span>
              </td>
              <td className={`p-3 text-xl tabular-nums ${STATUS[r.status] ?? ''}`}>{fmtTemp(r.body_temp)}</td>
              <td className="p-3 tabular-nums text-gray-700">{fmtTemp(r.surface_temp)}</td>
              <td className="p-3 tabular-nums text-blue-700">{fmtTemp(r.env_temp)}</td>
              <td className="p-3 tabular-nums text-cyan-700">{fmtHumidity(r.humidity)}</td>
              <td className="p-3">
                <MethodBadge method={r.id_method} manual={!r.device_id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
