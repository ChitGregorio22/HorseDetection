import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Camera, Droplets, QrCode, ScanFace, ScanSearch, Thermometer } from 'lucide-react';
import { classify, timeAgo, type DeviceStatus, type LiveHorse, type Settings } from '../lib/api';
import type { HorseRecord } from '../App';
import { LiveCamera, type CameraState } from './LiveCamera';
import type { useLiveView } from './useLiveView';

/**
 * Dashboard = what the stall camera sees right now. No horse is picked by hand: the horse in the stall
 * is the one the Pi identified (fingerprint or QR plate), from the Pi's 2-second live view when it sends
 * one, otherwise from its newest reading (one per horse per minute).
 */
const RECENT_READING_MS = 3 * 60 * 1000; // a reading this new = that horse is in the stall now

interface DashboardProps {
  horses: HorseRecord[];
  settings: Settings;
  /** Pi heartbeat (air temperature + humidity every 30 s) */
  devices: DeviceStatus[] | null | undefined;
  live: ReturnType<typeof useLiveView>;
}

type Level = 'normal' | 'warning' | 'fever';
const LEVEL_STYLE: Record<Level, { text: string; color: string; bg: string; border: string }> = {
  fever: { text: 'FEVER', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-600' },
  warning: { text: 'WARNING', color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-600' },
  normal: { text: 'NORMAL', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-600' },
};

/** The horse in the stall, whichever way the Pi told us */
type Stall =
  | { kind: 'identified'; name: string; code: string | null; known: boolean; body: number | null; surface: number | null;
      how: 'qr' | 'fingerprint' | null; confidence: number | null; at: string | null }
  | { kind: 'identifying'; body: number | null }
  | { kind: 'unknown'; body: number | null; guess: string | null }
  | { kind: 'registering'; name: string | null }
  | { kind: 'empty'; lastSeen: { name: string; at: string } | null }
  | { kind: 'no-data' };

export function Dashboard({ horses, settings, devices, live }: DashboardProps) {
  const [camState, setCamState] = useState<CameraState | 'not-set-up'>('connecting');
  const onCamState = useCallback((s: CameraState | 'not-set-up') => setCamState(s), []);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, []);

  // status from the value as shown (37.95 shows as 38.0, so it is judged as 38.0)
  const levelOf = (t: number): Level => classify(Math.round(t * 10) / 10, settings) as Level;
  const nameOf = (horseId: string) => horses.find((h) => h.id === horseId)?.name ?? 'Unknown horse';

  // ---- who is in the stall
  const reading = live.lastPiReading;
  const readingRecent = !!reading && now - new Date(reading.recorded_at).getTime() < RECENT_READING_MS;
  let stall: Stall;
  let others: LiveHorse[] = [];
  if (live.fresh && live.view) {
    const main = live.main;
    others = live.view.horses.filter((h) => h !== main);
    if (live.view.mode === 'registering') stall = { kind: 'registering', name: live.view.registering };
    else if (!main) stall = { kind: 'empty', lastSeen: null };
    else if (main.status === 'identifying') stall = { kind: 'identifying', body: main.body_temp };
    else if (main.status === 'unknown') stall = { kind: 'unknown', body: main.body_temp, guess: main.best_guess };
    else {
      const rec = main.horse_code ? horses.find((h) => h.horseCode === main.horse_code) : undefined;
      // a QR-named horse shows "via QR plate" when its newest reading says so
      const how = readingRecent && reading && rec && reading.horse_id === rec.id ? reading.id_method : 'fingerprint';
      stall = {
        kind: 'identified', name: main.name ?? rec?.name ?? 'Unknown', code: main.horse_code, known: !!rec,
        body: main.body_temp, surface: main.surface_temp, how, confidence: main.confidence, at: live.view.updated_at,
      };
    }
  } else if (readingRecent && reading) {
    const rec = horses.find((h) => h.id === reading.horse_id);
    stall = {
      kind: 'identified', name: nameOf(reading.horse_id), code: rec?.horseCode ?? null, known: true,
      body: reading.body_temp, surface: reading.surface_temp, how: reading.id_method, confidence: null, at: reading.recorded_at,
    };
  } else if (reading) {
    stall = { kind: 'empty', lastSeen: { name: nameOf(reading.horse_id), at: reading.recorded_at } };
  } else {
    stall = { kind: 'no-data' };
  }

  // ---- air temperature + humidity: live view (2 s) → Pi heartbeat (30 s) → newest reading (if recent)
  const beat = (devices ?? []).find((d) => d.online && d.status && (d.status.air_temp != null || d.status.humidity != null));
  const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number(v));
  const env =
    live.fresh && live.view && (live.view.air_temp != null || live.view.humidity != null)
      ? { air: live.view.air_temp, rh: live.view.humidity, source: 'Live from the Pi (DHT22)' }
      : beat
        ? { air: numOrNull(beat.status.air_temp), rh: numOrNull(beat.status.humidity),
            source: `Pi DHT22 · ${beat.last_seen_at ? timeAgo(beat.last_seen_at) : 'now'}` }
        : readingRecent && reading
          ? { air: reading.env_temp, rh: reading.humidity, source: `At the last reading · ${timeAgo(reading.recorded_at)}` }
          : { air: null, rh: null, source: 'No DHT22 reading: Raspberry Pi offline' };

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LiveCamera url={settings.camera_stream_url} showStatus={false} onStateChange={onCamState} />
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border-2 border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xl text-gray-700">
                <Camera className="h-6 w-6" /> In the stall now
              </div>
              <CameraBadge state={camState} />
            </div>

            <StallView stall={stall} levelOf={levelOf} />

            {others.length > 0 && (
              <div className="mt-4 border-t border-gray-200 pt-3 text-lg text-gray-700">
                Also in view:{' '}
                {others.map((h, i) => (
                  <span key={i}>
                    {i > 0 && ', '}
                    {h.status === 'identified' ? h.name : h.status === 'unknown' ? 'unknown horse' : 'identifying…'}
                    {h.body_temp != null && <span className="tabular-nums"> {h.body_temp.toFixed(1)}°C</span>}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl border-4 border-blue-600 bg-blue-50 p-4">
              <div className="flex items-center gap-2 text-lg text-blue-700">
                <Thermometer className="h-6 w-6" /> Air temp
              </div>
              <div className="mt-2 text-4xl tabular-nums text-blue-700">{env.air == null ? '—' : `${env.air.toFixed(1)}°C`}</div>
            </div>
            <div className="rounded-2xl border-4 border-cyan-600 bg-cyan-50 p-4">
              <div className="flex items-center gap-2 text-lg text-cyan-700">
                <Droplets className="h-6 w-6" /> Humidity
              </div>
              <div className="mt-2 text-4xl tabular-nums text-cyan-700">{env.rh == null ? '—' : `${env.rh.toFixed(0)}%`}</div>
            </div>
            <div className="col-span-2 -mt-2 text-base text-gray-500">{env.source}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The camera status, shown in "In the stall now" instead of on the video */
function CameraBadge({ state }: { state: CameraState | 'not-set-up' }) {
  const look = {
    live: { text: 'LIVE', cls: 'bg-red-600 text-white', dot: 'bg-white animate-pulse' },
    connecting: { text: 'CONNECTING', cls: 'bg-yellow-500 text-white', dot: 'bg-white' },
    offline: { text: 'CAMERA OFFLINE', cls: 'bg-gray-200 text-gray-700', dot: 'bg-gray-500' },
    'not-set-up': { text: 'NO CAMERA', cls: 'bg-gray-200 text-gray-700', dot: 'bg-gray-500' },
  }[state];
  return (
    <span className={`flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1 text-base font-semibold ${look.cls}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${look.dot}`} />
      {look.text}
    </span>
  );
}

function StallView({ stall, levelOf }: { stall: Stall; levelOf: (t: number) => Level }) {
  switch (stall.kind) {
    case 'no-data':
      return (
        <div className="mt-4">
          <div className="text-3xl text-gray-500">Waiting for the Pi</div>
          <p className="mt-2 text-lg text-gray-600">
            When the camera identifies a horse (fingerprint or its QR plate), it appears here with its temperature.
          </p>
        </div>
      );
    case 'empty':
      return (
        <div className="mt-4">
          <div className="text-3xl text-gray-500">No horse in view</div>
          {stall.lastSeen ? (
            <p className="mt-2 text-lg text-gray-600">
              Last seen: <strong>{stall.lastSeen.name}</strong>, {timeAgo(stall.lastSeen.at)}
            </p>
          ) : (
            <p className="mt-2 text-lg text-gray-600">The camera is watching the stall.</p>
          )}
        </div>
      );
    case 'registering':
      return (
        <div className="mt-4">
          <div className="text-3xl">Registering {stall.name ?? 'a horse'}…</div>
          <p className="mt-2 text-lg text-gray-600">Identification resumes when the registration ends.</p>
        </div>
      );
    case 'identifying':
      return (
        <div className="mt-4">
          <div className="flex items-center gap-2 text-3xl text-gray-700">
            <ScanSearch className="h-8 w-8 animate-pulse" /> Identifying…
          </div>
          {stall.body != null && <BigTemp temp={stall.body} level={levelOf(stall.body)} />}
          <p className="mt-2 text-lg text-gray-600">A horse is in view. The camera is checking who it is (fingerprint or QR plate).</p>
        </div>
      );
    case 'unknown':
      return (
        <div className="mt-4">
          <div className="text-3xl">Unknown horse</div>
          {stall.body != null && <BigTemp temp={stall.body} level={levelOf(stall.body)} />}
          <p className="mt-2 text-lg text-gray-600">
            Not a registered horse{stall.guess ? ` (closest: ${stall.guess}, not close enough)` : ''}. Its readings are not
            stored under any name.
          </p>
        </div>
      );
    case 'identified':
      return (
        <div className="mt-4">
          <div className="text-4xl">{stall.name}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-lg text-gray-600">
            {stall.how === 'qr' ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-purple-100 px-2 py-0.5 text-purple-800">
                <QrCode className="h-4 w-4" /> via QR plate
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-gray-700">
                <ScanFace className="h-4 w-4" /> fingerprint
                {stall.confidence != null ? ` · ${Math.round(stall.confidence * 100)}% match` : ''}
              </span>
            )}
            {stall.code && <span className="font-mono text-base">{stall.code}</span>}
          </div>
          {stall.body != null ? (
            <>
              <BigTemp temp={stall.body} level={levelOf(stall.body)} />
              <div className="mt-1 text-base text-gray-500">
                Body temperature (estimated){stall.surface != null ? ` · coat ${stall.surface.toFixed(1)}°C` : ''}
                {stall.at ? ` · ${timeAgo(stall.at)}` : ''}
              </div>
            </>
          ) : (
            <p className="mt-3 text-lg text-gray-600">No temperature: the horse is outside the thermal camera's view.</p>
          )}
          {!stall.known && (
            <p className="mt-3 rounded-lg bg-yellow-50 px-3 py-2 text-base text-yellow-800">
              {stall.name} isn't on the website yet. On the Pi: <code>python3 web_link.py --push-existing</code>
            </p>
          )}
        </div>
      );
  }
}

function BigTemp({ temp, level }: { temp: number; level: Level }) {
  const st = LEVEL_STYLE[level];
  return (
    <div className={`mt-3 rounded-xl border-4 ${st.border} ${st.bg} px-4 py-3`}>
      <div className={`text-6xl tabular-nums ${st.color}`}>{temp.toFixed(1)}°C</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`${st.color} text-2xl`}>{st.text}</span>
        {level !== 'normal' && (
          <span className={`${st.color} flex items-center gap-1 text-lg`}>
            <AlertTriangle className="h-5 w-5" /> {level === 'fever' ? 'Needs immediate attention' : 'Monitor closely'}
          </span>
        )}
      </div>
    </div>
  );
}
