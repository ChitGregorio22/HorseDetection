import { useEffect, useState } from 'react';
import { AlertTriangle, Camera, Droplets, Minus, ScanSearch, Thermometer, TrendingDown, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { HorseRecord } from '../App';
import { LiveCamera } from './LiveCamera';
import { classify, getRecentReadings, subscribeToChanges, timeAgo, type DeviceStatus, type LiveHorse, type Reading, type Settings } from '../lib/api';
import { fmtHumidity, fmtTemp, fmtWhen, MethodBadge } from './ReadingBits';
import { QrPlate } from './QrPlate';
import type { useLiveView } from './useLiveView';

interface DashboardProps {
  horse: HorseRecord | null;
  horses: HorseRecord[];
  settings: Settings;
  /** Pi heartbeat (air temperature + humidity every 30 s) */
  devices: DeviceStatus[] | null | undefined;
  live: ReturnType<typeof useLiveView>;
  followCamera: boolean;
  onFollowCameraChange: (on: boolean) => void;
  onSelectHorse: (id: string) => void;
  /** undefined when this user's role can't register horses */
  onRegister?: () => void;
}

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`;
};

type Level = 'normal' | 'warning' | 'fever';
const LEVEL_STYLE: Record<Level, { text: string; color: string; bg: string; border: string; hex: string }> = {
  fever: { text: 'FEVER', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-600', hex: '#dc2626' },
  warning: { text: 'WARNING', color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-600', hex: '#ca8a04' },
  normal: { text: 'NORMAL', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-600', hex: '#16a34a' },
};

export function Dashboard({
  horse,
  horses,
  settings,
  devices,
  live,
  followCamera,
  onFollowCameraChange,
  onSelectHorse,
  onRegister,
}: DashboardProps) {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(false);

  // Load the latest readings from the database, then listen for new ones in real time.
  useEffect(() => {
    if (!horse) {
      setReadings([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getRecentReadings(horse.id, 7)
      .then((rows) => !cancelled && setReadings(rows))
      .catch(() => !cancelled && setReadings([]))
      .finally(() => !cancelled && setLoading(false));

    const unsubscribe = subscribeToChanges('dashboard', ['temperature_readings'], (_table, row) => {
      if (!row.id) return;
      const reading: Reading = {
        id: Number(row.id),
        horse_id: String(row.horse_id),
        body_temp: Number(row.body_temp),
        env_temp: row.env_temp == null ? null : Number(row.env_temp),
        humidity: row.humidity == null ? null : Number(row.humidity),
        surface_temp: row.surface_temp == null ? null : Number(row.surface_temp),
        id_method: (row.id_method as Reading['id_method']) ?? null,
        device_id: (row.device_id as string) ?? null,
        status: row.status as Reading['status'],
        recorded_at: String(row.recorded_at),
      };
      setReadings((previous) =>
        previous.some((r) => r.id === reading.id) ? previous : [...previous.slice(-6), reading],
      );
    }, horse.id);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [horse?.id]);

  const recentData = readings.map((r) => ({ time: formatTime(r.recorded_at), temp: r.body_temp }));
  const latest = readings[readings.length - 1];
  const hasData = Boolean(latest) || horse?.currentTemperature != null;
  const currentTemp = latest?.body_temp ?? horse?.currentTemperature ?? 0;
  const normalTemp = horse?.normalTemperature ?? 37.2;
  // status from the value as shown (37.95 shows as 38.0, so it is judged as 38.0)
  const levelOf = (t: number): Level => classify(Math.round(t * 10) / 10, settings) as Level;
  const status = LEVEL_STYLE[levelOf(currentTemp)];

  // ---- the stall right now (from the Pi), falling back to the last stored reading
  const main = live.main;
  const mainRecord = main?.horse_code ? horses.find((h) => h.horseCode === main.horse_code) ?? null : null;
  const others = live.fresh && live.view ? live.view.horses.filter((h) => h !== main) : [];
  // Air temperature + humidity: live view (every 2 s) → Pi heartbeat (every 30 s) → last stored reading
  const beat = (devices ?? []).find(
    (d) => d.online && d.status && (d.status.air_temp != null || d.status.humidity != null),
  );
  const numOrNull = (v: unknown) => (v == null || v === '' ? null : Number(v));
  const env = live.fresh && live.view && (live.view.air_temp != null || live.view.humidity != null)
    ? { air: live.view.air_temp, rh: live.view.humidity, source: 'Live from the Pi (DHT22)' }
    : beat
      ? {
          air: numOrNull(beat.status.air_temp),
          rh: numOrNull(beat.status.humidity),
          source: `Pi DHT22 · ${beat.last_seen_at ? timeAgo(beat.last_seen_at) : 'now'}`,
        }
      : {
          air: latest?.env_temp ?? horse?.envTemperature ?? null,
          rh: latest?.humidity ?? horse?.humidity ?? null,
          source: latest || horse?.lastUpdated ? `At the last reading · ${fmtWhen(latest?.recorded_at ?? horse?.lastUpdated)}` : 'Pi offline',
        };
  const airTemp = env.air;
  const humidity = env.rh;

  const camera = (
    <LiveCamera
      url={settings.camera_stream_url}
      label={main?.status === 'identified' && main.name ? `In view: ${main.name}` : horse ? `Monitoring: ${horse.name}` : undefined}
    />
  );

  const stallPanel = (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border-2 border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xl text-gray-700">
            <Camera className="h-6 w-6" /> In the stall now
          </div>
          <LiveAge live={live} />
        </div>
        <StallHorse
          live={live}
          main={main}
          mainRecord={mainRecord}
          fallback={horse && hasData ? { name: horse.name, temp: currentTemp, at: latest?.recorded_at ?? horse.lastUpdated } : null}
          levelOf={levelOf}
          selectedId={horse?.id ?? null}
          onSelectHorse={onSelectHorse}
        />
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
          <div className="mt-2 text-4xl tabular-nums text-blue-700">{airTemp == null ? '—' : `${airTemp.toFixed(1)}°C`}</div>
        </div>
        <div className="rounded-2xl border-4 border-cyan-600 bg-cyan-50 p-4">
          <div className="flex items-center gap-2 text-lg text-cyan-700">
            <Droplets className="h-6 w-6" /> Humidity
          </div>
          <div className="mt-2 text-4xl tabular-nums text-cyan-700">{humidity == null ? '—' : `${humidity.toFixed(0)}%`}</div>
        </div>
        <div className="col-span-2 -mt-2 text-base text-gray-500">{env.source}</div>
      </div>

      {live.installed && (
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-lg">
          <input
            type="checkbox"
            className="h-6 w-6 accent-green-600"
            checked={followCamera}
            onChange={(e) => onFollowCameraChange(e.target.checked)}
          />
          <span>
            Follow the camera
            <span className="block text-base text-gray-500">Switch the Dashboard to the horse the camera identifies</span>
          </span>
        </label>
      )}
    </div>
  );

  const top = (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">{camera}</div>
      {stallPanel}
    </div>
  );

  if (!horse) {
    return (
      <div className="p-6 space-y-6">
        {top}
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-green-300 bg-green-50 px-6 py-10 text-center">
          <div className="mb-4 text-6xl">🐎</div>
          <h1 className="text-4xl">No horse to monitor yet</h1>
          <p className="mt-3 max-w-xl text-xl text-gray-600">
            {onRegister
              ? 'Register your first horse using the live camera. The new horse will appear here automatically.'
              : 'No horses have been registered yet. An owner or admin can register them.'}
          </p>
          {onRegister && (
            <button
              type="button"
              onClick={onRegister}
              className="mt-7 rounded-xl bg-green-600 px-8 py-4 text-2xl text-white hover:bg-green-700"
            >
              Register a Horse
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!loading && !hasData) {
    return (
      <div className="p-6 space-y-6">
        {top}
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-green-300 bg-green-50 px-6 py-10 text-center">
          <div className="mb-4 text-6xl">🌡️</div>
          <h1 className="text-4xl">Waiting for {horse.name}'s first stored reading</h1>
          <p className="mt-3 max-w-xl text-xl text-gray-600">
            When the camera identifies {horse.name}, the Pi stores one reading per minute. The trend and history appear
            here automatically.
          </p>
          <div className="mt-4 rounded-xl bg-white p-3">
            <QrPlate name={horse.name} code={horse.horseCode} compact />
          </div>
        </div>
      </div>
    );
  }

  // Calculate data analysis
  const avgTemp = recentData.length
    ? recentData.reduce((sum, d) => sum + d.temp, 0) / recentData.length
    : currentTemp;
  const tempDeviation = currentTemp - normalTemp;
  const tempTrend = recentData.length >= 2
    ? recentData[recentData.length - 1].temp - recentData[0].temp
    : 0;

  const getTrendIcon = () => {
    if (tempTrend > 0.3) return TrendingUp;
    if (tempTrend < -0.3) return TrendingDown;
    return Minus;
  };

  const getTrendText = () => {
    if (tempTrend > 0.3) return 'Rising';
    if (tempTrend < -0.3) return 'Falling';
    return 'Stable';
  };

  const getTrendColor = () => {
    if (tempTrend > 0.3) return 'text-red-600';
    if (tempTrend < -0.3) return 'text-blue-600';
    return 'text-gray-600';
  };

  const TrendIcon = getTrendIcon();

  return (
    <div className="p-6 space-y-6">
      {top}

      {/* Latest stored reading of the selected horse */}
      <div className={`rounded-2xl border-4 ${status.border} ${status.bg} p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-3xl">{horse.name} · latest reading</h2>
          <div className="flex items-center gap-2 text-lg text-gray-700">
            {fmtWhen(latest?.recorded_at ?? horse.lastUpdated)}
            <MethodBadge method={latest ? latest.id_method : horse.idMethod} manual={latest ? !latest.device_id : false} />
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <div className="text-lg text-gray-600">Body</div>
            <div className={`text-4xl tabular-nums ${status.color}`}>{currentTemp.toFixed(1)}°C</div>
            <div className={`text-lg ${status.color}`}>{status.text}</div>
          </div>
          <div>
            <div className="text-lg text-gray-600">Surface (coat)</div>
            <div className="text-3xl tabular-nums text-gray-800">{fmtTemp(latest ? latest.surface_temp : horse.surfaceTemperature)}</div>
          </div>
          <div>
            <div className="text-lg text-gray-600">Air</div>
            <div className="text-3xl tabular-nums text-blue-700">{fmtTemp(latest ? latest.env_temp : horse.envTemperature)}</div>
          </div>
          <div>
            <div className="text-lg text-gray-600">Humidity</div>
            <div className="text-3xl tabular-nums text-cyan-700">{fmtHumidity(latest ? latest.humidity : horse.humidity)}</div>
          </div>
        </div>
        <div className="shrink-0 self-center rounded-xl bg-white p-3">
          <QrPlate name={horse.name} code={horse.horseCode} compact />
        </div>
        </div>
      </div>

      {/* Data Analysis */}
      <div className="bg-white border-2 border-gray-200 rounded-2xl p-6">
        <h2 className="text-2xl mb-4">Data Analysis</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-purple-50 border-2 border-purple-600 rounded-xl p-4">
            <div className="text-lg text-purple-600 mb-2">Temperature Trend</div>
            <div className={`flex items-center gap-2 ${getTrendColor()}`}>
              <TrendIcon className="w-8 h-8" />
              <span className="text-3xl">{getTrendText()}</span>
            </div>
            <div className="text-lg text-gray-600 mt-2">
              {tempTrend > 0 ? '+' : ''}{tempTrend.toFixed(1)}°C change
            </div>
          </div>

          <div className="bg-indigo-50 border-2 border-indigo-600 rounded-xl p-4">
            <div className="text-lg text-indigo-600 mb-2">Average Temperature</div>
            <div className="text-3xl text-indigo-700 tabular-nums">{avgTemp.toFixed(1)}°C</div>
            <div className="text-lg text-gray-600 mt-2">Last {recentData.length} stored readings</div>
          </div>

          <div className="bg-orange-50 border-2 border-orange-600 rounded-xl p-4">
            <div className="text-lg text-orange-600 mb-2">Deviation from Normal</div>
            <div className={`text-3xl tabular-nums ${tempDeviation > 0.5 ? 'text-red-600' : tempDeviation < -0.5 ? 'text-blue-600' : 'text-green-600'}`}>
              {tempDeviation > 0 ? '+' : ''}{tempDeviation.toFixed(1)}°C
            </div>
            <div className="text-lg text-gray-600 mt-2">Normal: {normalTemp.toFixed(1)}°C</div>
          </div>

          <div className="bg-teal-50 border-2 border-teal-600 rounded-xl p-4">
            <div className="text-lg text-teal-600 mb-2">Monitoring Status</div>
            <div className="text-3xl text-teal-700">{live.fresh ? 'Live' : 'Not live'}</div>
            <div className="text-lg text-gray-600 mt-2">One reading per minute while in view</div>
          </div>
        </div>
      </div>

      {/* Live Graph */}
      <div className="bg-white border-2 border-gray-200 rounded-2xl p-6">
        <h2 className="text-2xl mb-4">Temperature Trend</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={recentData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 16 }}
              stroke="#6b7280"
            />
            <YAxis
              domain={[36.5, 39.0]}
              tick={{ fontSize: 16 }}
              stroke="#6b7280"
            />
            <Line
              type="monotone"
              dataKey="temp"
              stroke={status.hex}
              strokeWidth={3}
              dot={{ fill: status.hex, r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Status Information */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-green-50 border-2 border-green-600 rounded-xl p-6">
          <div className="text-green-600 text-xl mb-2">Normal Range</div>
          <div className="text-3xl">Below {settings.warning_threshold.toFixed(1)}°C</div>
        </div>

        <div className="bg-yellow-50 border-2 border-yellow-600 rounded-xl p-6">
          <div className="text-yellow-600 text-xl mb-2">Warning Range</div>
          <div className="text-3xl">{settings.warning_threshold.toFixed(1)} - {settings.fever_threshold.toFixed(1)}°C</div>
        </div>

        <div className="bg-red-50 border-2 border-red-600 rounded-xl p-6">
          <div className="text-red-600 text-xl mb-2">Fever Range</div>
          <div className="text-3xl">≥ {settings.fever_threshold.toFixed(1)}°C</div>
        </div>
      </div>
    </div>
  );
}

function LiveAge({ live }: { live: ReturnType<typeof useLiveView> }) {
  if (!live.installed || live.view === undefined) return null;
  if (live.fresh) {
    const s = Math.round((live.ageMs ?? 0) / 1000);
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-base text-green-800">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-green-600" />
        Live{s >= 3 ? ` · ${s}s ago` : ''}
      </span>
    );
  }
  return <span className="rounded-full bg-gray-100 px-3 py-1 text-base text-gray-600">Not live</span>;
}

function StallHorse({
  live,
  main,
  mainRecord,
  fallback,
  levelOf,
  selectedId,
  onSelectHorse,
}: {
  live: ReturnType<typeof useLiveView>;
  main: LiveHorse | null;
  mainRecord: HorseRecord | null;
  fallback: { name: string; temp: number; at: string | null } | null;
  levelOf: (t: number) => Level;
  selectedId: string | null;
  onSelectHorse: (id: string) => void;
}) {
  // Not live: the Pi isn't sending (old version, stopped, or 08 not installed) → show the last stored reading
  if (!live.fresh) {
    return (
      <div className="mt-4">
        {fallback ? (
          <>
            <div className="text-3xl">{fallback.name}</div>
            <BigTemp temp={fallback.temp} level={levelOf(fallback.temp)} />
            <div className="mt-2 text-lg text-gray-600">Last stored reading{fallback.at ? `, ${new Date(fallback.at).toLocaleString()}` : ''}</div>
          </>
        ) : (
          <div className="text-2xl text-gray-500">No reading yet</div>
        )}
        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-base text-gray-600">
          {!live.installed
            ? 'Live identification needs the database update 08_live_view.sql.'
            : live.view === null
              ? 'Showing the last stored reading. The Dashboard switches to each horse when the Pi sends its reading.'
              : 'The Pi stopped sending live data (monitor stopped or no internet). Showing the last stored reading.'}
        </p>
      </div>
    );
  }

  if (live.view?.mode === 'registering') {
    return (
      <div className="mt-4">
        <div className="text-3xl">Registering {live.view.registering ?? 'a horse'}…</div>
        <p className="mt-2 text-lg text-gray-600">Identification resumes when the registration ends.</p>
      </div>
    );
  }

  if (!main) {
    return (
      <div className="mt-4">
        <div className="text-3xl text-gray-500">No horse in view</div>
        <p className="mt-2 text-lg text-gray-600">The camera is watching the stall.</p>
      </div>
    );
  }

  if (main.status === 'identifying') {
    return (
      <div className="mt-4">
        <div className="flex items-center gap-2 text-3xl text-gray-700">
          <ScanSearch className="h-8 w-8 animate-pulse" /> Identifying…
        </div>
        {main.body_temp != null && <BigTemp temp={main.body_temp} level={levelOf(main.body_temp)} />}
        <p className="mt-2 text-lg text-gray-600">A horse is in view. The camera is checking who it is.</p>
      </div>
    );
  }

  if (main.status === 'unknown') {
    return (
      <div className="mt-4">
        <div className="text-3xl">Unknown horse</div>
        {main.body_temp != null && <BigTemp temp={main.body_temp} level={levelOf(main.body_temp)} />}
        <p className="mt-2 text-lg text-gray-600">
          Not a registered horse{main.best_guess ? ` (closest: ${main.best_guess}, not close enough)` : ''}. Its
          readings are not stored under any name.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="text-4xl">{main.name}</div>
      <div className="mt-1 text-lg text-gray-600">
        Identified{main.confidence != null ? ` · ${Math.round(main.confidence * 100)}% match` : ''}
        {mainRecord ? ` · ${mainRecord.horseCode}` : ''}
      </div>
      {main.body_temp != null ? (
        <>
          <BigTemp temp={main.body_temp} level={levelOf(main.body_temp)} />
          <div className="mt-1 text-base text-gray-500">
            Body temperature (estimated){main.surface_temp != null ? ` · surface ${main.surface_temp.toFixed(1)}°C` : ''}
          </div>
        </>
      ) : (
        <p className="mt-3 text-lg text-gray-600">No temperature: the horse is outside the thermal camera's view.</p>
      )}
      {!mainRecord && (
        <p className="mt-3 rounded-lg bg-yellow-50 px-3 py-2 text-base text-yellow-800">
          {main.name} isn't on the website yet. On the Pi: <code>python3 web_link.py --push-existing</code>
        </p>
      )}
      {mainRecord && mainRecord.id !== selectedId && (
        <button
          type="button"
          onClick={() => onSelectHorse(mainRecord.id)}
          className="mt-3 rounded-lg border-2 border-green-600 px-4 py-2 text-lg text-green-700 hover:bg-green-50"
        >
          Show {main.name}'s readings
        </button>
      )}
    </div>
  );
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
