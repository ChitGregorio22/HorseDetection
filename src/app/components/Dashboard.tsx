import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, CloudSun, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { HorseRecord } from '../App';

interface DashboardProps {
  horse: HorseRecord | null;
  onRegister: () => void;
}

export function Dashboard({ horse, onRegister }: DashboardProps) {
  const [envTemp, setEnvTemp] = useState(22.5);
  const [recentData, setRecentData] = useState<{ time: string; temp: number }[]>([]);

  const currentTemp = horse?.currentTemperature ?? 0;
  const normalTemp = horse?.normalTemperature ?? 37.2;

  // Environment data refreshes on the same three-minute monitoring cycle.
  useEffect(() => {
    const interval = setInterval(() => {
      const newEnvTemp = 20.0 + Math.random() * 5;
      setEnvTemp(Number(newEnvTemp.toFixed(1)));
    }, 3 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!horse) {
      setRecentData([]);
      return;
    }

    const updated = new Date(horse.lastUpdated);
    const time = `${updated.getHours()}:${updated.getMinutes().toString().padStart(2, '0')}`;
    setRecentData((previous) => {
      const latest = previous[previous.length - 1];
      if (latest?.time === time && latest.temp === horse.currentTemperature) return previous;
      return [...previous.slice(-6), { time, temp: horse.currentTemperature }];
    });
  }, [horse?.id, horse?.currentTemperature, horse?.lastUpdated]);

  if (!horse) {
    return (
      <div className="p-6">
        <div className="flex min-h-[520px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-green-300 bg-green-50 px-6 text-center">
          <div className="mb-5 text-7xl">🐎</div>
          <h1 className="text-4xl">No horse to monitor yet</h1>
          <p className="mt-3 max-w-xl text-xl text-gray-600">
            Register your first horse using the live camera. The new horse will appear here automatically.
          </p>
          <button
            type="button"
            onClick={onRegister}
            className="mt-7 rounded-xl bg-green-600 px-8 py-4 text-2xl text-white hover:bg-green-700"
          >
            Register a Horse
          </button>
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

  const getStatus = (temp: number) => {
    if (temp >= 38.0) return { text: 'FEVER', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-600' };
    if (temp >= 37.5) return { text: 'WARNING', color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-600' };
    return { text: 'NORMAL', color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-600' };
  };

  const status = getStatus(currentTemp);

  return (
    <div className="p-6 space-y-6">
      {/* Main Temperature Display */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`lg:col-span-2 ${status.bg} ${status.border} border-4 rounded-2xl p-8`}>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Activity className={`${status.color} w-10 h-10`} />
              <h1 className="text-4xl">Horse: {horse.name}</h1>
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline gap-4">
                <span className="text-7xl tabular-nums">{currentTemp}°C</span>
                <span className={`${status.color} text-4xl px-6 py-2 rounded-lg ${status.bg} border-2 ${status.border}`}>
                  {status.text}
                </span>
              </div>
            </div>

            {status.text !== 'NORMAL' && (
              <div className={`${status.color} flex items-center gap-2 text-2xl mt-4`}>
                <AlertTriangle className="w-8 h-8" />
                <span>
                  {status.text === 'FEVER' ? 'Needs Immediate Attention' : 'Monitor Closely'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Environment Temperature */}
        <div className="bg-blue-50 border-4 border-blue-600 rounded-2xl p-8">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <CloudSun className="text-blue-600 w-10 h-10" />
              <h2 className="text-2xl">Environment</h2>
            </div>
            <div className="text-6xl tabular-nums text-blue-600">{envTemp}°C</div>
            <div className="text-xl text-blue-700">Ambient Temperature</div>
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
            <div className="text-lg text-gray-600 mt-2">Latest 3-minute readings</div>
          </div>

          <div className="bg-orange-50 border-2 border-orange-600 rounded-xl p-4">
            <div className="text-lg text-orange-600 mb-2">Deviation from Normal</div>
            <div className={`text-3xl tabular-nums ${tempDeviation > 0.5 ? 'text-red-600' : tempDeviation < -0.5 ? 'text-blue-600' : 'text-green-600'}`}>
              {tempDeviation > 0 ? '+' : ''}{tempDeviation.toFixed(1)}°C
            </div>
            <div className="text-lg text-gray-600 mt-2">Normal: {normalTemp}°C</div>
          </div>

          <div className="bg-teal-50 border-2 border-teal-600 rounded-xl p-4">
            <div className="text-lg text-teal-600 mb-2">Monitoring Status</div>
            <div className="text-3xl text-teal-700">Active</div>
            <div className="text-lg text-gray-600 mt-2">Updates every 3 minutes</div>
          </div>
        </div>
      </div>

      {/* Live Graph */}
      <div className="bg-white border-2 border-gray-200 rounded-2xl p-6">
        <h2 className="text-2xl mb-4">Live Temperature Trend</h2>
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
              stroke={status.color === 'text-red-600' ? '#dc2626' : status.color === 'text-yellow-600' ? '#ca8a04' : '#16a34a'}
              strokeWidth={3}
              dot={{ fill: status.color === 'text-red-600' ? '#dc2626' : status.color === 'text-yellow-600' ? '#ca8a04' : '#16a34a', r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Status Information */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-green-50 border-2 border-green-600 rounded-xl p-6">
          <div className="text-green-600 text-xl mb-2">Normal Range</div>
          <div className="text-3xl">Below 37.5°C</div>
        </div>

        <div className="bg-yellow-50 border-2 border-yellow-600 rounded-xl p-6">
          <div className="text-yellow-600 text-xl mb-2">Warning Range</div>
          <div className="text-3xl">37.5 - 38.0°C</div>
        </div>

        <div className="bg-red-50 border-2 border-red-600 rounded-xl p-6">
          <div className="text-red-600 text-xl mb-2">Fever Range</div>
          <div className="text-3xl">≥ 38.0°C</div>
        </div>
      </div>
    </div>
  );
}
