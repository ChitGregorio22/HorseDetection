import { useCallback, useEffect, useState } from 'react';
import { NoPhoto } from './Brand';
import { AlertTriangle, Camera, CheckCircle2, Droplets, QrCode, ScanFace, ScanSearch, Thermometer } from 'lucide-react';
import { classify, timeAgo, type DeviceStatus, type LiveHorse, type LiveProgress, type Settings } from '../lib/api';
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
  /** opens a horse's profile (Horses page) */
  onOpenHorse: (horseId: string) => void;
}

type Level = 'normal' | 'warning' | 'fever';
const LEVEL_STYLE: Record<Level, { text: string; color: string; bg: string; border: string }> = {
  fever: { text: 'FEVER', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-600' },
  warning: { text: 'WARNING', color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-600' },
  normal: { text: 'NORMAL', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-600' },
};

/** A QR plate the camera reads right now, and the horse it belongs to (null = not a horse on the website) */
type QrSeen = { code: string; rec: HorseRecord | null } | null;

/** One horse in view, whichever way the Pi told us (live view or its newest reading) */
type HorseInView = {
  status: 'identifying' | 'identified' | 'unknown';
  name: string | null;
  code: string | null;
  rec: HorseRecord | null;
  body: number | null;
  surface: number | null;
  how: 'qr' | 'fingerprint' | null;
  confidence: number | null;
  qrCheck: LiveHorse['qr_check'];
  progress: LiveProgress | null;
  at: string | null;
};

type Stall =
  | { kind: 'horses'; horses: HorseInView[]; qr: QrSeen }
  | { kind: 'detected'; qr: QrSeen } // YOLO sees a horse, nothing more yet
  | { kind: 'empty'; qr: QrSeen; lastSeen: { name: string; at: string } | null }
  | { kind: 'registering'; name: string | null }
  | { kind: 'no-data' };

export function Dashboard({ horses, settings, devices, live, onOpenHorse }: DashboardProps) {
  const [camState, setCamState] = useState<CameraState | 'not-set-up'>('connecting');
  const onCamState = useCallback((s: CameraState | 'not-set-up') => setCamState(s), []);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, []);

  // status from the value as shown (37.95 shows as 38.0, so it is judged as 38.0)
  const levelOf = (t: number): Level => classify(Math.round(t * 10) / 10, settings) as Level;
  const byCode = (code: string | null | undefined) =>
    code ? horses.find((h) => h.horseCode.toUpperCase() === code.toUpperCase()) ?? null : null;
  const nameOf = (horseId: string) => horses.find((h) => h.id === horseId)?.name ?? 'Unknown horse';

  // ---- who is in the stall
  const reading = live.lastPiReading;
  const readingRecent = !!reading && now - new Date(reading.recorded_at).getTime() < RECENT_READING_MS;
  let stall: Stall;
  if (live.fresh && live.view) {
    const v = live.view;
    // a QR plate the camera can read right now (also with no horse: shows the QR reading works)
    const qr: QrSeen = v.qr[0] ? { code: v.qr[0], rec: byCode(v.qr[0]) } : null;
    const inView: HorseInView[] = v.horses
      .map((h) => {
        const rec = byCode(h.horse_code);
        // the Pi says how it named the horse; older Pi code: take it from the newest reading
        const how =
          h.method ?? (readingRecent && reading && rec && reading.horse_id === rec.id ? reading.id_method : 'fingerprint');
        return {
          status: h.status, name: h.name ?? rec?.name ?? null, code: h.horse_code, rec,
          body: h.body_temp, surface: h.surface_temp, how: h.status === 'identified' ? how : null,
          confidence: h.confidence, qrCheck: h.qr_check, progress: h.progress, at: v.updated_at,
        };
      })
      // identified first, then identifying, then unknown
      .sort((a, b) => ['identified', 'identifying', 'unknown'].indexOf(a.status) - ['identified', 'identifying', 'unknown'].indexOf(b.status));
    if (v.mode === 'registering') stall = { kind: 'registering', name: v.registering };
    else if (inView.length) stall = { kind: 'horses', horses: inView, qr };
    else if (v.present) stall = { kind: 'detected', qr };
    else stall = { kind: 'empty', qr, lastSeen: null };
  } else if (readingRecent && reading) {
    // no live view from the Pi: its newest reading (last 3 minutes) says who is there
    const rec = horses.find((h) => h.id === reading.horse_id) ?? null;
    stall = {
      kind: 'horses',
      qr: null,
      horses: [{
        status: 'identified', name: nameOf(reading.horse_id), code: rec?.horseCode ?? null, rec,
        body: reading.body_temp, surface: reading.surface_temp, how: reading.id_method, confidence: null,
        qrCheck: null, progress: null, at: reading.recorded_at,
      }],
    };
  } else if (reading) {
    stall = { kind: 'empty', qr: null, lastSeen: { name: nameOf(reading.horse_id), at: reading.recorded_at } };
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
    <div className="p-3 sm:p-6">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LiveCamera url={settings.camera_stream_url} showStatus={false} onStateChange={onCamState} />
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border-2 border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 whitespace-nowrap text-xl text-gray-700">
                <Camera className="h-6 w-6" /> In the stall now
              </div>
              <CameraBadge state={camState} />
            </div>

            <StallView stall={stall} levelOf={levelOf} onOpenHorse={onOpenHorse} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-2xl border-4 border-blue-600 bg-blue-50 p-4">
              <div className="flex items-center gap-2 text-lg text-blue-700">
                <Thermometer className="h-6 w-6" /> Air temp
              </div>
              <div className="mt-2 text-3xl sm:text-4xl tabular-nums text-blue-700">{env.air == null ? '—' : `${env.air.toFixed(1)}°C`}</div>
            </div>
            <div className="rounded-2xl border-4 border-cyan-600 bg-cyan-50 p-4">
              <div className="flex items-center gap-2 text-lg text-cyan-700">
                <Droplets className="h-6 w-6" /> Humidity
              </div>
              <div className="mt-2 text-3xl sm:text-4xl tabular-nums text-cyan-700">{env.rh == null ? '—' : `${env.rh.toFixed(0)}%`}</div>
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
    offline: { text: 'OFFLINE', cls: 'bg-gray-200 text-gray-700', dot: 'bg-gray-500' },
    'not-set-up': { text: 'NO CAMERA', cls: 'bg-gray-200 text-gray-700', dot: 'bg-gray-500' },
  }[state];
  return (
    <span className={`flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1 text-base font-semibold ${look.cls}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${look.dot}`} />
      {look.text}
    </span>
  );
}

function StallView({
  stall,
  levelOf,
  onOpenHorse,
}: {
  stall: Stall;
  levelOf: (t: number) => Level;
  onOpenHorse: (horseId: string) => void;
}) {
  switch (stall.kind) {
    case 'no-data':
      return (
        <div className="mt-4">
          <div className="text-2xl text-gray-500 sm:text-3xl">Waiting for the Pi</div>
          <p className="mt-2 text-lg text-gray-600">
            When the camera sees a horse, it appears here with its identification and temperature.
          </p>
        </div>
      );
    case 'registering':
      return (
        <div className="mt-4">
          <div className="text-2xl sm:text-3xl">Registering {stall.name ?? 'a horse'}…</div>
          <p className="mt-2 text-lg text-gray-600">Identification resumes when the registration ends.</p>
        </div>
      );
    case 'empty':
      return (
        <div className="mt-4">
          <div className="text-2xl text-gray-500 sm:text-3xl">Stall empty</div>
          {stall.qr ? (
            <QrCard qr={stall.qr} note={`QR plate seen: ${stall.qr.code}`} onOpenHorse={onOpenHorse} />
          ) : stall.lastSeen ? (
            <p className="mt-2 text-lg text-gray-600">
              Last seen: <strong>{stall.lastSeen.name}</strong>, {timeAgo(stall.lastSeen.at)}
            </p>
          ) : null}
        </div>
      );
    case 'detected':
      return (
        <div className="mt-4 space-y-3">
          <HorseBlock
            horse={{ status: 'identifying', name: null, code: null, rec: null, body: null, surface: null, how: null,
              confidence: null, qrCheck: null, progress: null, at: null }}
            levelOf={levelOf}
            onOpenHorse={onOpenHorse}
          />
          {stall.qr && <QrCard qr={stall.qr} note={`QR plate seen: ${stall.qr.code}`} onOpenHorse={onOpenHorse} />}
        </div>
      );
    case 'horses':
      return (
        <div className="mt-4 space-y-3">
          {stall.horses.map((h, i) => (
            <HorseBlock key={`${h.code ?? 'h'}-${i}`} horse={h} levelOf={levelOf} onOpenHorse={onOpenHorse} />
          ))}
          {/* a plate in view while nobody is named yet */}
          {stall.qr && !stall.horses.some((h) => h.status === 'identified') && (
            <QrCard qr={stall.qr} note={`QR plate seen: ${stall.qr.code}`} onOpenHorse={onOpenHorse} />
          )}
        </div>
      );
  }
}

const BLOCK = {
  identifying: 'border-amber-400 bg-amber-50',
  identified: 'border-green-500 bg-green-50',
  unknown: 'border-gray-300 bg-gray-50',
} as const;

/** One horse in view: identification status + temperature */
function HorseBlock({
  horse: h,
  levelOf,
  onOpenHorse,
}: {
  horse: HorseInView;
  levelOf: (t: number) => Level;
  onOpenHorse: (horseId: string) => void;
}) {
  return (
    <div className={`rounded-xl border-2 p-3 sm:p-4 ${BLOCK[h.status]}`}>
      {h.status === 'identifying' && (
        <>
          <div className="flex items-center gap-2 text-2xl text-amber-800">
            <ScanSearch className="h-6 w-6 animate-pulse" /> Identifying…
          </div>
          <IdProgress progress={h.progress} />
        </>
      )}

      {h.status === 'unknown' && (
        <div className="text-2xl text-gray-700">Not a registered horse</div>
      )}

      {h.status === 'identified' && (
        <>
          <MiniProfile rec={h.rec} name={h.name ?? 'Unknown'} code={h.code} onOpenHorse={onOpenHorse} />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-base sm:text-lg">
            {h.how === 'qr' ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-purple-100 px-2 py-0.5 text-purple-800">
                <QrCode className="h-4 w-4" /> Named by QR plate
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-gray-700">
                <ScanFace className="h-4 w-4" /> Fingerprint
                {h.confidence != null ? ` ${Math.round(h.confidence * 100)}%` : ''}
              </span>
            )}
            {h.how !== 'qr' && h.qrCheck === 'match' && (
              <span className="inline-flex items-center gap-1 rounded-md bg-green-100 px-2 py-0.5 text-green-800">
                <CheckCircle2 className="h-4 w-4" /> QR verified ✓
              </span>
            )}
            {h.how !== 'qr' && h.qrCheck === 'mismatch' && (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                <AlertTriangle className="h-4 w-4" /> QR plate disagrees
              </span>
            )}
          </div>
          {!h.rec && h.name && (
            <p className="mt-2 rounded-lg bg-yellow-50 px-3 py-2 text-base text-yellow-800">
              {h.name} isn't on the website yet. On the Pi: <code>python3 web_link.py --push-existing</code>
            </p>
          )}
        </>
      )}

      {h.body != null ? (
        <BigTemp temp={h.body} level={levelOf(h.body)} />
      ) : h.status !== 'identifying' ? (
        <p className="mt-2 text-base text-gray-600">No temperature: outside the thermal camera's view.</p>
      ) : null}
    </div>
  );
}

/** "Collecting photos 3/8" → "Checking 1/3" with a small bar; just "Identifying…" when the Pi sends no progress */
function IdProgress({ progress: p }: { progress: LiveProgress | null }) {
  if (!p) return null;
  const collecting = p.photos < p.photos_needed;
  const done = collecting ? p.photos : p.checks;
  const need = collecting ? p.photos_needed : p.checks_needed;
  if (!need) return null;
  const pct = Math.max(0, Math.min(100, (done / need) * 100));
  return (
    <div className="mt-2">
      <div className="text-base text-amber-900 sm:text-lg">
        {collecting ? 'Collecting photos' : 'Checking'} {done}/{need}
      </div>
      <div
        className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-amber-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={need}
        aria-valuenow={done}
      >
        <div className="h-full rounded-full bg-amber-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BigTemp({ temp, level }: { temp: number; level: Level }) {
  const st = LEVEL_STYLE[level];
  return (
    <div className={`mt-3 rounded-xl border-4 ${st.border} ${st.bg} px-4 py-3`}>
      <div className={`text-5xl sm:text-6xl tabular-nums ${st.color}`}>{temp.toFixed(1)}°C</div>
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

/** Small profile of the horse in the stall: photo, name (opens its profile), ID, age, normal temperature */
function MiniProfile({
  rec,
  name,
  code,
  onOpenHorse,
}: {
  rec: HorseRecord | null;
  name: string;
  code: string | null;
  onOpenHorse: (horseId: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 border-gray-200 bg-gray-100 sm:h-20 sm:w-20">
        {rec?.photo ? (
          <img src={rec.photo} alt={`Photo of ${name}`} draggable={false} className="h-full w-full object-cover" />
        ) : (
          <NoPhoto className="h-full w-full" />
        )}
      </div>
      <div className="min-w-0">
        {rec ? (
          <button
            type="button"
            onClick={() => onOpenHorse(rec.id)}
            title={`Open ${name}'s profile`}
            className="block max-w-full truncate text-left text-2xl leading-tight text-green-800 underline decoration-green-400 underline-offset-4 hover:decoration-green-700 sm:text-3xl"
          >
            {name}
          </button>
        ) : (
          <div className="truncate text-2xl leading-tight sm:text-3xl">{name}</div>
        )}
        {(code ?? rec?.horseCode) && <div className="font-mono text-base text-gray-600">{code ?? rec?.horseCode}</div>}
        {rec && (
          <div className="text-base text-gray-600">
            {rec.age != null ? `${rec.age} yr · ` : ''}normal {rec.normalTemperature.toFixed(1)}°C
          </div>
        )}
      </div>
    </div>
  );
}

/** A QR plate the camera reads, with the horse it belongs to */
function QrCard({ qr, note, onOpenHorse }: { qr: NonNullable<QrSeen>; note: string; onOpenHorse: (horseId: string) => void }) {
  return (
    <div className="mt-3 rounded-xl border-2 border-purple-200 bg-purple-50 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-base text-purple-800">
        <QrCode className="h-5 w-5" /> {note}
      </div>
      {qr.rec ? (
        <MiniProfile rec={qr.rec} name={qr.rec.name} code={qr.rec.horseCode} onOpenHorse={onOpenHorse} />
      ) : (
        <p className="text-lg text-gray-700">Not a horse on the website (old or wrong plate?).</p>
      )}
    </div>
  );
}
