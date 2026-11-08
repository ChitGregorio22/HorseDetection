import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, CartesianGrid, Tooltip, Legend } from 'recharts';
import { TrendingUp, TrendingDown, Minus, CloudSun } from 'lucide-react';

interface HistoryProps {
  selectedHorse: string;
}

const historicalData = [
  { date: 'Apr 6', temp: 37.2, envTemp: 21.5, time: '09:00 AM', status: 'normal' },
  { date: 'Apr 7', temp: 37.4, envTemp: 22.0, time: '09:15 AM', status: 'normal' },
  { date: 'Apr 8', temp: 37.6, envTemp: 23.5, time: '09:30 AM', status: 'warning' },
  { date: 'Apr 9', temp: 37.8, envTemp: 24.0, time: '09:45 AM', status: 'warning' },
  { date: 'Apr 10', temp: 38.1, envTemp: 25.0, time: '10:00 AM', status: 'fever' },
  { date: 'Apr 11', temp: 38.3, envTemp: 24.5, time: '10:15 AM', status: 'fever' },
  { date: 'Apr 12', temp: 37.9, envTemp: 23.0, time: '10:30 AM', status: 'warning' },
];

export function History({ selectedHorse }: HistoryProps) {
  if (!selectedHorse) {
    return (
      <div className="p-6">
        <div className="flex min-h-[480px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-green-300 bg-green-50 px-6 text-center">
          <div className="mb-5 text-7xl">🐎</div>
          <h1 className="text-4xl">No temperature history</h1>
          <p className="mt-3 text-xl text-gray-600">
            Register a horse first. New readings will be recorded every 3 minutes.
          </p>
        </div>
      </div>
    );
  }

  const normalTemp = 37.2;

  // Calculate data analysis
  const avgTemp = historicalData.reduce((sum, d) => sum + d.temp, 0) / historicalData.length;
  const avgEnvTemp = historicalData.reduce((sum, d) => sum + d.envTemp, 0) / historicalData.length;
  const maxTemp = Math.max(...historicalData.map(d => d.temp));
  const minTemp = Math.min(...historicalData.map(d => d.temp));
  const tempTrend = historicalData.length >= 2
    ? historicalData[historicalData.length - 1].temp - historicalData[0].temp
    : 0;
  const feverDays = historicalData.filter(d => d.temp >= 38.0).length;

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
      <div>
        <h1 className="text-4xl mb-2">Temperature History</h1>
        <p className="text-xl text-gray-600">Horse: {selectedHorse}</p>
      </div>

      {/* Data Analysis */}
      <div className="bg-white border-2 border-gray-200 rounded-2xl p-6">
        <h2 className="text-2xl mb-4">7-Day Data Analysis</h2>
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
            <div className="text-lg text-gray-600 mt-2">7-day average</div>
          </div>

          <div className="bg-teal-50 border-2 border-teal-600 rounded-xl p-4">
            <div className="text-lg text-teal-600 mb-2">Avg Environment</div>
            <div className="text-3xl text-teal-700 tabular-nums">{avgEnvTemp.toFixed(1)}°C</div>
            <div className="text-lg text-gray-600 mt-2">7-day average</div>
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
            <div className="text-lg text-gray-600 mt-2">Above 38.0°C</div>
          </div>

          <div className="bg-yellow-50 border-2 border-yellow-600 rounded-xl p-4">
            <div className="text-lg text-yellow-600 mb-2">Warning Days</div>
            <div className="text-3xl text-yellow-700">
              {historicalData.filter(d => d.temp >= 37.5 && d.temp < 38.0).length} days
            </div>
            <div className="text-lg text-gray-600 mt-2">37.5 - 38.0°C</div>
          </div>

          <div className="bg-green-50 border-2 border-green-600 rounded-xl p-4">
            <div className="text-lg text-green-600 mb-2">Normal Days</div>
            <div className="text-3xl text-green-700">
              {historicalData.filter(d => d.temp < 37.5).length} days
            </div>
            <div className="text-lg text-gray-600 mt-2">Below 37.5°C</div>
          </div>

          <div className="bg-blue-50 border-2 border-blue-600 rounded-xl p-4">
            <div className="text-lg text-blue-600 mb-2">Current Deviation</div>
            <div className={`text-3xl tabular-nums ${
              historicalData[historicalData.length - 1].temp - normalTemp > 0.5 ? 'text-red-600' :
              historicalData[historicalData.length - 1].temp - normalTemp < -0.5 ? 'text-blue-600' :
              'text-green-600'
            }`}>
              {historicalData[historicalData.length - 1].temp - normalTemp > 0 ? '+' : ''}
              {(historicalData[historicalData.length - 1].temp - normalTemp).toFixed(1)}°C
            </div>
            <div className="text-lg text-gray-600 mt-2">From normal {normalTemp}°C</div>
          </div>
        </div>
      </div>

      {/* Large Chart */}
      <div className="bg-white border-2 border-gray-200 rounded-2xl p-6">
        <h2 className="text-2xl mb-4">7-Day Temperature Trend</h2>
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
              domain={[15, 30]}
              tick={{ fontSize: 16 }}
              stroke="#6b7280"
              label={{ value: 'Environment (°C)', angle: 90, position: 'insideRight', style: { fontSize: 16 } }}
            />
            <Tooltip
              contentStyle={{ fontSize: 16, padding: 12 }}
              formatter={(value: number, name: string) => [
                `${value}°C`,
                name === 'temp' ? 'Body Temperature' : 'Environment'
              ]}
            />
            <Legend
              wrapperStyle={{ fontSize: 16 }}
              formatter={(value) => value === 'temp' ? 'Body Temperature' : 'Environment Temperature'}
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
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

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
                <th className="text-left p-4 text-xl">Time</th>
                <th className="text-left p-4 text-xl">Body Temp</th>
                <th className="text-left p-4 text-xl">Environment</th>
                <th className="text-left p-4 text-xl">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-gray-200">
              {historicalData.map((record, index) => {
                const status = record.temp >= 38.0 ? 'fever' : record.temp >= 37.5 ? 'warning' : 'normal';
                const statusColor = status === 'fever' ? 'text-red-600' : status === 'warning' ? 'text-yellow-600' : 'text-green-600';
                const statusBg = status === 'fever' ? 'bg-red-50' : status === 'warning' ? 'bg-yellow-50' : 'bg-green-50';
                const statusText = status === 'fever' ? 'FEVER' : status === 'warning' ? 'WARNING' : 'NORMAL';

                return (
                  <tr key={index} className="hover:bg-gray-50">
                    <td className="p-4 text-2xl">{record.date}</td>
                    <td className="p-4 text-xl text-gray-600">{record.time}</td>
                    <td className="p-4 text-3xl tabular-nums">{record.temp}°C</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <CloudSun className="w-5 h-5 text-blue-600" />
                        <span className="text-2xl tabular-nums text-blue-600">{record.envTemp}°C</span>
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
