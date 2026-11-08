import { BellOff } from "lucide-react";

interface AlertsProps {
  selectedHorse: string;
}

export function Alerts({ selectedHorse }: AlertsProps) {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-4xl">Alert History</h1>
        <p className="mt-2 text-xl text-gray-600">
          {selectedHorse ? `Horse: ${selectedHorse}` : "No horse registered"}
        </p>
      </div>

      <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border-2 border-gray-200 bg-white px-6 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <BellOff className="h-8 w-8 text-green-700" />
        </div>
        <h2 className="text-3xl">No alerts yet</h2>
        <p className="mt-2 max-w-lg text-xl text-gray-600">
          {selectedHorse
            ? `Temperature alerts for ${selectedHorse} will appear here after monitoring begins.`
            : "Register a horse to begin temperature monitoring."}
        </p>
      </div>

      <div className="rounded-xl border-2 border-blue-600 bg-blue-50 p-6">
        <h2 className="mb-3 text-2xl">Alert Settings</h2>
        <div className="space-y-2 text-xl">
          <p>🟡 Warning threshold: 37.5°C</p>
          <p>🔴 Fever threshold: 38.0°C</p>
          <p>⏰ Temperature update interval: Every 3 minutes</p>
        </div>
      </div>
    </div>
  );
}
