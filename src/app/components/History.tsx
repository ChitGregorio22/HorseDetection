import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, CartesianGrid, Tooltip, Legend } from 'recharts';
import { TrendingUp, TrendingDown, Minus, CloudSun, Download, Droplets } from 'lucide-react';
import type { HorseRecord } from '../App';
import { downloadReadingsCsv, getDailySummary, getReadingsSince, subscribeToChanges, type DailySummary, type Reading, type Settings } from '../lib/api';

interface HistoryProps {
  horse: HorseRecord | null;
  settings: Settings;
}

export function History({ horse, settings }: HistoryProps) {
  const [days, setDays] = useState<DailySummary[]>([]);
  const [loading, setLoading] = useState(false);

  // Daily summaries (last 7 days) from the database; refreshes when new readings arrive.
  useEffect(() => {
    if (!horse) {
      setDays([]);
      return;
    }
    let cancelled = false;
    const load = () =>
      getDailySummary(horse.id, 7)
        .then((rows) => !cancelled && setDays(rows))
        .catch(() => !cancelled && setDays([]))
        .finally(() => !cancelled && setLoading(false));
    setLoading(true);
    load();
    const unsubscribe = subscribeToChanges('history', ['temperature_readings'], () => load(), horse.id);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [horse?.id]);

  if (!horse || (!loading && days.length === 0)) {
    return (
      <div className="p-6">
        <div className="flex min-h-[480px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-green-300 bg-green-50 px-6 text-center">
          <div className="mb-5 text-7xl">🐎</div>
          <h1 className="text-4xl">No temperature history</h1>
          <p className="mt-3 text-xl text-gray-600">
            {horse
              ? `No readings recorded for ${horse.name} yet. History builds up as the thermal camera sends readings.`
              : 'Register a horse first. History builds up as the thermal camera sends readings.'}
          </p>
        </div>
      </div>
    );
  }

  if (loading && days.length === 0) {
    return <div className="p-6 text-2xl text-gray-600">Loading history…</div>;
  }

  const selectedHorse = horse.name;
  const { warning_threshold: warnAt, fever_threshold: feverAt } = settings;

  // One row per day: average body temperature (chart/table), peak decides the day's status
  const historicalData = days.map((d) => ({
    date: new Date(`${d.day}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }),
    temp: d.avg_body_temp,
    peak: d.peak_body_temp,
    envTemp: d.avg_env_temp,
    humidity: d.avg_humidity,
    time: new Date(d.peak_time).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }),
    status: d.status,
  }));

  const normalTemp = horse.normalTemperature;

  // Calculate data analysis
  const avgTemp = historicalData.reduce((sum, d) => sum + d.temp, 0) / historicalData.length;
  const mean = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const avgEnvTemp = mean(historicalData.map((d) => d.envTemp));
  const avgHumidity = mean(historicalData.map((d) => d.humidity));
  const maxTemp = Math.max(...historicalData.map(d => d.peak));
  const minTemp = Math.min(...days.map(d => d.min_body_temp));
  const tempTrend = historicalData.length >= 2
    ? historicalData[historicalData.length - 1].temp - historicalData[0].temp
    : 0;
  const feverDays = historicalData.filter(d => d.status === 'fever').length;
  const latestAvg = historicalData[historicalData.length - 1].temp;

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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl mb-2">Temperature History</h1>
          <p className="text-xl text-gray-600">Horse: {selectedHorse}</p>
        </div>
        <CsvDownload horse={horse} />
      </div>

      {/* Data Analysis */}
      <div className="bg-white border-2 border-gray-200 rounded-2xl p-6">
        <h2 className="text-2xl mb-4">{historicalData.length}-Day Data Analysis</h2>
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
            <div className="text-lg text-indigo-600 mb-2">Average Body Temp</div>
            <div className="text-3xl text-indigo-700 tabular-nums">{avgTemp.toFixed(1)}°C</div>
            <div className="text-lg text-gray-600 mt-2">{historicalData.length}-day average</div>
          </div>

          <div className="bg-teal-50 border-2 border-teal-600 rounded-xl p-4">
            <div className="text-lg text-teal-600 mb-2">Avg Air Temperature</div>
            <div className="text-3xl text-teal-700 tabular-nums">{avgEnvTemp == null ? '—' : `${avgEnvTemp.toFixed(1)}°C`}</div>
            <div className="text-lg text-gray-600 mt-2">
              Humidity {avgHumidity == null ? '—' : `${avgHumidity.toFixed(0)}%`} · DHT22
            </div>
          </div>

          <div className="bg-orange-50 border-2 border-orange-600 rounded-xl p-4">
            <div className="text-lg text-orange-600 mb-2">Temperature Range</div>
            <div className="text-2xl text-orange-700 tabular-nums">
              {minTemp.toFixed(1)} - {maxTemp.toFixed(1)}°C
            </div>
            <div className="text-lg text-gray-600 mt-2">Min to Max</div>
          </div>

          <div className="bg-red-50 border-2 border-red-600 rounded-xl p-4">
            <div className="text-lg text-red-600 mb-2">Fever Days</div>
            <div className="text-3xl text-red-700">{feverDays} days</div>
            <div className="text-lg text-gray-600 mt-2">Peak ≥ {feverAt.toFixed(1)}°C</div>
          </div>

          <div className="bg-yellow-50 border-2 border-yellow-600 rounded-xl p-4">
            <div className="text-lg text-yellow-600 mb-2">Warning Days</div>
            <div className="text-3xl text-yellow-700">
              {historicalData.filter(d => d.status === 'warning').length} days
            </div>
            <div className="text-lg text-gray-600 mt-2">Peak {warnAt.toFixed(1)} - {feverAt.toFixed(1)}°C</div>
          </div>

          <div className="bg-green-50 border-2 border-green-600 rounded-xl p-4">
            <div className="text-lg text-green-600 mb-2">Normal Days</div>
            <div className="text-3xl text-green-700">
              {historicalData.filter(d => d.status === 'normal').length} days
            </div>
            <div className="text-lg text-gray-600 mt-2">Peak below {warnAt.toFixed(1)}°C</div>
          </div>

          <div className="bg-blue-50 border-2 border-blue-600 rounded-xl p-4">
            <div className="text-lg text-blue-600 mb-2">Current Deviation</div>
            <div className={`text-3xl tabular-nums ${
              latestAvg - normalTemp > 0.5 ? 'text-red-600' :
              latestAvg - normalTemp < -0.5 ? 'text-blue-600' :
              'text-green-600'
            }`}>
              {latestAvg - normalTemp > 0 ? '+' : ''}
              {(latestAvg - normalTemp).toFixed(1)}°C
            </div>
            <div className="text-lg text-gray-600 mt-2">From normal {normalTemp.toFixed(1)}°C</div>
          </div>
        </div>
      </div>

      {/* Large Chart */}
      <div className="bg-white border-2 border-gray-200 rounded-2xl p-6">
        <h2 className="text-2xl mb-4">{historicalData.length}-Day Trend (daily averages)</h2>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={historicalData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 16 }}
              stroke="#6b7280"
            />
            <YAxis
              yAxisId="left"
              domain={[36.5, 39.0]}
              tick={{ fontSize: 16 }}
              stroke="#6b7280"
              label={{ value: 'Body Temperature (°C)', angle: -90, position: 'insideLeft', style: { fontSize: 16 } }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[15, 40]}
              tick={{ fontSize: 16 }}
              stroke="#6b7280"
              label={{ value: 'Air (°C)', angle: 90, position: 'insideRight', style: { fontSize: 16 } }}
            />
            <Tooltip
              contentStyle={{ fontSize: 16, padding: 12 }}
              formatter={(value: number, name: string) => [
                `${value}°C`,
                name === 'temp' ? 'Avg Body Temperature' : 'Avg Air Temperature'
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: 16 }}
              formatter={(value) => value === 'temp' ? 'Avg Body Temperature' : 'Avg Air Temperature'}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="temp"
              stroke="#4CAF50"
              strokeWidth={4}
              dot={{ fill: '#4CAF50', r: 6 }}
              name="temp"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="envTemp"
              stroke="#3B82F6"
              strokeWidth={3}
              dot={{ fill: '#3B82F6', r: 5 }}
              strokeDasharray="5 5"
              name="envTemp"
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <ReadingsChart horseId={horse.id} settings={settings} />

      {/* Data Table */}
      <div className="bg-white border-2 border-gray-200 rounded-2xl overflow-hidden">
        <div className="bg-gray-50 p-4 border-b-2 border-gray-200">
          <h2 className="text-2xl">Daily Records</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-100 border-b-2 border-gray-200">
              <tr>
                <th className="text-left p-4 text-xl">Date</th>
                <th className="text-left p-4 text-xl">Peak Time</th>
                <th className="text-left p-4 text-xl">Avg Body</th>
                <th className="text-left p-4 text-xl">Peak Body</th>
                <th className="text-left p-4 text-xl">Air Temp</th>
                <th className="text-left p-4 text-xl">Humidity</th>
                <th className="text-left p-4 text-xl">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-gray-200">
              {historicalData.map((record) => {
                const status = record.status;
                const statusColor = status === 'fever' ? 'text-red-600' : status === 'warning' ? 'text-yellow-600' : 'text-green-600';
                const statusBg = status === 'fever' ? 'bg-red-50' : status === 'warning' ? 'bg-yellow-50' : 'bg-green-50';
                const statusText = status === 'fever' ? 'FEVER' : status === 'warning' ? 'WARNING' : 'NORMAL';

                return (
                  <tr key={record.date} className="hover:bg-gray-50">
                    <td className="p-4 text-2xl">{record.date}</td>
                    <td className="p-4 text-xl text-gray-600">{record.time}</td>
                    <td className="p-4 text-3xl tabular-nums">{record.temp.toFixed(1)}°C</td>
                    <td className="p-4 text-3xl tabular-nums">{record.peak.toFixed(1)}°C</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <CloudSun className="w-5 h-5 text-blue-600" />
                        <span className="text-2xl tabular-nums text-blue-600">
                          {record.envTemp == null ? '—' : `${record.envTemp.toFixed(1)}°C`}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Droplets className="w-5 h-5 text-cyan-600" />
                        <span className="text-2xl tabular-nums text-cyan-700">
                          {record.humidity == null ? '—' : `${record.humidity.toFixed(0)}%`}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`${statusColor} ${statusBg} text-xl px-4 py-2 rounded-lg inline-block`}>
                        {statusText}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** "Download CSV" — every reading (date/time, body, raw, environment, humidity, status) for Excel / Chapter 4. */
function CsvDownload({ horse }: { horse: HorseRecord }) {
  const [range, setRange] = useState('7');
  const [scope, setScope] = useState<'horse' | 'all'>('horse');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const download = async () => {
    setBusy(true);
    setMessage('');
    try {
      const count = await downloadReadingsCsv(
        scope === 'horse' ? { id: horse.id, name: horse.name } : null,
        range === 'all' ? null : Number(range),
      );
      setMessage(count === 0 ? 'No readings in that range.' : `Downloaded ${count.toLocaleString()} readings.`);
    } catch (e) {
      setMessage(`Download failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const select = 'min-h-12 rounded-lg border-2 border-gray-300 bg-white px-3 text-lg';
  return (
    <div className="rounded-xl border-2 border-gray-200 bg-white p-4">
      <div className="mb-2 text-lg font-semibold">Download readings (CSV for Excel)</div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={scope} onChange={(e) => setScope(e.target.value as 'horse' | 'all')} className={select} aria-label="Which horses">
          <option value="horse">{horse.name} only</option>
          <option value="all">All horses</option>
        </select>
        <select value={range} onChange={(e) => setRange(e.target.value)} className={select} aria-label="Time range">
          <option value="1">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="all">All time</option>
        </select>
        <button
          type="button"
          onClick={download}
          disabled={busy}
          className="flex min-h-12 items-center gap-2 rounded-lg bg-green-600 px-5 text-lg text-white hover:bg-green-700 disabled:opacity-60"
        >
          <Download className="h-5 w-5" /> {busy ? 'Preparing…' : 'Download'}
        </button>
      </div>
      {message && <p className="mt-2 text-base text-gray-600">{message}</p>}
    </div>
  );
}

/** Every stored reading: body temperature against air temperature (top) and humidity (bottom). */
function ReadingsChart({ horseId, settings }: { horseId: string; settings: Settings }) {
  const [range, setRange] = useState(1);
  const [rows, setRows] = useState<Reading[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getReadingsSince(horseId, range)
        .then((r) => !cancelled && setRows(r))
        .catch(() => !cancelled && setRows([]))
        .finally(() => !cancelled && setLoading(false));
    setLoading(true);
    load();
    const unsubscribe = subscribeToChanges('history-readings', ['temperature_readings'], () => load(), horseId);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [horseId, range]);

  const data = rows.map((r) => ({
    t: new Date(r.recorded_at).getTime(),
    body: r.body_temp,
    air: r.env_temp,
    rh: r.humidity ?? null,
  }));
  const tick = (t: number) =>
    new Date(t).toLocaleString('en-PH', range > 1 ? { month: 'short', day: 'numeric', hour: 'numeric' } : { hour: 'numeric', minute: '2-digit' });
  const full = (t: number) => new Date(t).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const bodies = data.map((d) => d.body);
  const lo = Math.min(36.5, ...bodies) - 0.2;
  const hi = Math.max(39, settings.fever_threshold + 0.5, ...bodies) + 0.2;

  return (
    <div className="bg-white border-2 border-gray-200 rounded-2xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl">Every reading: body vs air temperature and humidity</h2>
        <div className="flex gap-2">
          {[
            { d: 1, label: '24 hours' },
            { d: 7, label: '7 days' },
          ].map((o) => (
            <button
              key={o.d}
              type="button"
              onClick={() => setRange(o.d)}
              className={`rounded-lg px-4 py-2 text-lg ${range === o.d ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <p className="text-lg text-gray-600">{loading ? 'Loading readings…' : 'No readings in this period.'}</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={data} syncId="readings">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tick} tick={{ fontSize: 14 }} stroke="#6b7280" />
              <YAxis yAxisId="body" domain={[Math.floor(lo * 2) / 2, Math.ceil(hi * 2) / 2]} tick={{ fontSize: 14 }} stroke="#16a34a"
                label={{ value: 'Body (°C)', angle: -90, position: 'insideLeft', style: { fontSize: 14 } }} />
              <YAxis yAxisId="air" orientation="right" domain={['dataMin - 2', 'dataMax + 2']} allowDecimals={false} tick={{ fontSize: 14 }} stroke="#2563eb"
                label={{ value: 'Air (°C)', angle: 90, position: 'insideRight', style: { fontSize: 14 } }} />
              <Tooltip
                contentStyle={{ fontSize: 15, padding: 10 }}
                labelFormatter={(t) => full(Number(t))}
                formatter={(v: number, n: string) => [`${Number(v).toFixed(1)}°C`, n === 'body' ? 'Body' : 'Air']}
              />
              <Legend wrapperStyle={{ fontSize: 15 }} formatter={(v) => (v === 'body' ? 'Body temperature' : 'Air temperature (DHT22)')} />
              <Line yAxisId="body" type="monotone" dataKey="body" name="body" stroke="#16a34a" strokeWidth={3}
                dot={data.length < 80 ? { r: 3, fill: '#16a34a' } : false} isAnimationActive={false} />
              <Line yAxisId="air" type="monotone" dataKey="air" name="air" stroke="#2563eb" strokeWidth={2}
                strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={data} syncId="readings">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tick} tick={{ fontSize: 14 }} stroke="#6b7280" />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 14 }} stroke="#0891b2"
                label={{ value: 'Humidity (%)', angle: -90, position: 'insideLeft', style: { fontSize: 14 } }} />
              <Tooltip contentStyle={{ fontSize: 15, padding: 10 }} labelFormatter={(t) => full(Number(t))}
                formatter={(v: number) => [`${Number(v).toFixed(0)}%`, 'Humidity']} />
              <Line type="monotone" dataKey="rh" name="rh" stroke="#0891b2" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <p className="mt-2 text-base text-gray-500">{data.length} readings. Body temperature is already compensated on the Pi for air temperature and humidity.</p>
        </>
      )}
    </div>
  );
}
