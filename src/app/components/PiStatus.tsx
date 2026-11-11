import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Cpu, HelpCircle, RefreshCw, XCircle } from 'lucide-react';
import { getDeviceStatus, timeAgo, type DeviceStatus } from '../lib/api';

const POLL_MS = 15000;

/**
 * Asks the database every 15 s which Raspberry Pis have checked in recently.
 * devices === null  → the database update (04_device_status.sql) isn't installed yet.
 */
export function useDeviceStatus(enabled: boolean) {
  const [devices, setDevices] = useState<DeviceStatus[] | null | undefined>(undefined);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setDevices(await getDeviceStatus());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  return { devices, error, refresh };
}

/** Small pill for the header: "Raspberry Pi · Online" */
export function PiStatusBadge({ devices, onClick }: { devices: DeviceStatus[] | null | undefined; onClick: () => void }) {
  let dot = 'bg-gray-300';
  let text = 'Checking…';

  if (devices === null) {
    text = 'Not set up';
  } else if (devices && devices.length === 0) {
    text = 'No device';
  } else if (devices) {
    const online = devices.filter((d) => d.online).length;
    if (online === devices.length) {
      dot = 'bg-lime-300 animate-pulse';
      text = 'Online';
    } else if (online > 0) {
      dot = 'bg-yellow-300';
      text = `${online}/${devices.length} online`;
    } else {
      dot = 'bg-red-400';
      text = 'Offline';
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title="Raspberry Pi connection — click for details"
      className="inline-flex items-center gap-2 rounded-full border-2 border-white/40 bg-green-700/60 px-4 py-1.5 text-base hover:bg-green-800"
    >
      <span className={`h-3 w-3 rounded-full ${dot}`} />
      <Cpu className="h-4 w-4" />
      <span>Raspberry Pi: {text}</span>
    </button>
  );
}

function Check({ label, value, detail }: { label: string; value: unknown; detail?: string }) {
  const known = typeof value === 'boolean';
  return (
    <div className="flex items-center gap-2 text-lg">
      {!known ? (
        <HelpCircle className="h-6 w-6 text-gray-400" />
      ) : value ? (
        <CheckCircle2 className="h-6 w-6 text-green-600" />
      ) : (
        <XCircle className="h-6 w-6 text-red-600" />
      )}
      <span>{label}</span>
      <span className="text-gray-500">
        {!known ? 'not reported' : value ? detail ?? 'working' : 'not working'}
      </span>
    </div>
  );
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : null);

function formatUptime(seconds: number | null) {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** Detailed card (Settings): one row per Pi with its last report. */
export function PiStatusPanel({
  devices,
  error,
  onRefresh,
}: {
  devices: DeviceStatus[] | null | undefined;
  error: string;
  onRefresh: () => void;
}) {
  return (
    <div className="bg-white border-2 border-gray-200 rounded-2xl p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Cpu className="h-7 w-7 text-gray-700" />
          <h2 className="text-2xl">Raspberry Pi Connection</h2>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-lg hover:bg-gray-200"
        >
          <RefreshCw className="h-5 w-5" /> Check now
        </button>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 p-3 text-lg text-red-800">{error}</p>}

      {devices === undefined && <p className="text-xl text-gray-600">Checking…</p>}

      {devices === null && (
        <p className="rounded-lg border-2 border-yellow-400 bg-yellow-50 p-4 text-lg text-yellow-900">
          The connection indicator isn't installed in the database yet. Run <span className="font-mono">supabase/04_device_status.sql</span> in the Supabase SQL Editor.
        </p>
      )}

      {devices && devices.length === 0 && (
        <p className="text-xl text-gray-600">
          No Raspberry Pi registered. Add one in Supabase → Table Editor → devices, then put its device_key in the Pi's heartbeat program.
        </p>
      )}

      <div className="space-y-4">
        {devices?.map((device) => {
          const s = device.status ?? {};
          const cpu = num(s.cpu_temp);
          const air = num(s.air_temp);
          const humidity = num(s.humidity);
          return (
            <div
              key={device.id}
              className={`rounded-xl border-2 p-5 ${device.online ? 'border-green-600 bg-green-50' : 'border-red-400 bg-red-50'}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-2xl">{device.name}</div>
                  {device.location && <div className="text-lg text-gray-600">{device.location}</div>}
                </div>
                <div className="text-right">
                  <span
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-xl text-white ${
                      device.online ? 'bg-green-600' : 'bg-red-600'
                    }`}
                  >
                    <span className={`h-3 w-3 rounded-full bg-white ${device.online ? 'animate-pulse' : ''}`} />
                    {device.online ? 'ONLINE' : 'OFFLINE'}
                  </span>
                  <div className="mt-1 text-lg text-gray-600">
                    Last check-in: {device.last_seen_at ? timeAgo(device.last_seen_at) : 'never'}
                  </div>
                </div>
              </div>

              {device.last_seen_at ? (
                <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
                  <Check label="Camera" value={s.camera} />
                  <Check label="Thermal sensor (MLX90640)" value={s.thermal} />
                  <Check
                    label="Ambient sensor (DHT22)"
                    value={s.dht}
                    detail={air != null ? `${air.toFixed(1)}°C${humidity != null ? ` · ${humidity.toFixed(0)}% RH` : ''}` : undefined}
                  />
                  <Check label="Detection program" value={s.monitor} detail={typeof s.monitor_detail === 'string' ? s.monitor_detail : undefined} />
                  <div className="text-lg text-gray-700">
                    CPU temperature:{' '}
                    <span className={cpu != null && cpu >= 75 ? 'font-semibold text-red-600' : ''}>
                      {cpu != null ? `${cpu.toFixed(1)}°C` : '—'}
                    </span>
                    {cpu != null && cpu >= 75 && ' (hot)'}
                  </div>
                  <div className="text-lg text-gray-700">Running for: {formatUptime(num(s.uptime_s))}</div>
                  {typeof s.ip === 'string' && <div className="text-lg text-gray-700">Local IP: <span className="font-mono">{s.ip}</span></div>}
                  {typeof s.app === 'string' && <div className="text-lg text-gray-700">Program: {s.app}</div>}
                </div>
              ) : (
                <p className="mt-3 text-lg text-gray-700">This Pi has never checked in. Start the heartbeat program on it.</p>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-base text-gray-500">
        A Pi counts as online if it checked in within the last 90 seconds. This page re-checks every 15 seconds.
      </p>
    </div>
  );
}
