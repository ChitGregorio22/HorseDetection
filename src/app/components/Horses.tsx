import { Activity, Calendar, Plus, Thermometer } from "lucide-react";
import type { HorseRecord } from "../App";
import { classify, type Settings } from "../lib/api";

interface HorsesProps {
  horses: HorseRecord[];
  selectedHorseId: string | null;
  settings: Settings;
  onSelectHorse: (horseId: string) => void;
  onRegister: () => void;
}

function getStatus(temperature: number | null, settings: Settings) {
  const level = temperature == null ? "normal" : classify(temperature, settings);
  if (level === "fever") {
    return {
      label: "FEVER",
      panel: "border-red-600 bg-red-50",
      text: "text-red-600",
    };
  }
  if (level === "warning") {
    return {
      label: "WARNING",
      panel: "border-yellow-600 bg-yellow-50",
      text: "text-yellow-700",
    };
  }
  return {
    label: "NORMAL",
    panel: "border-green-600 bg-green-50",
    text: "text-green-700",
  };
}

function formatLastUpdated(date: string | null) {
  if (!date) return "Waiting for first reading";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

export function Horses({
  horses,
  selectedHorseId,
  settings,
  onSelectHorse,
  onRegister,
}: HorsesProps) {
  const currentHorse = horses.find((horse) => horse.id === selectedHorseId) ?? null;

  if (horses.length === 0) {
    return (
      <div className="p-6">
        <div className="flex min-h-[480px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-green-300 bg-green-50 px-6 text-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-green-600 text-4xl">🐎</div>
          <h1 className="text-4xl font-semibold text-gray-900">No horses registered</h1>
          <p className="mt-3 max-w-xl text-xl text-gray-600">
            Register a horse with the live camera to begin monitoring.
          </p>
          <button
            type="button"
            onClick={onRegister}
            className="mt-7 flex min-h-14 items-center gap-2 rounded-xl bg-green-600 px-7 py-3 text-xl font-semibold text-white hover:bg-green-700"
          >
            <Plus className="h-6 w-6" />
            Register Horse
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-4xl">Horse Profiles</h1>
        <button
          type="button"
          onClick={onRegister}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-lg font-semibold text-white hover:bg-green-700"
        >
          <Plus className="h-5 w-5" />
          Register Another Horse
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {horses.map((horse) => {
          const status = getStatus(horse.currentTemperature, settings);

          return (
            <button
              key={horse.id}
              type="button"
              onClick={() => onSelectHorse(horse.id)}
              className={`${status.panel} overflow-hidden rounded-2xl border-4 text-left transition-transform hover:scale-[1.02] ${
                selectedHorseId === horse.id ? "ring-4 ring-blue-500" : ""
              }`}
            >
              <div className="grid grid-cols-[120px_1fr]">
                {horse.photo ? (
                  <img
                    src={horse.photo}
                    alt={horse.name}
                    className="h-full min-h-48 w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full min-h-48 w-full items-center justify-center bg-white/60 text-6xl">🐎</div>
                )}
                <div className="space-y-2 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-3xl">🐎 {horse.name}</h2>
                    <Activity className={`${status.text} h-8 w-8 shrink-0`} />
                  </div>
                  <div className={`${status.text} text-4xl tabular-nums`}>
                    {horse.currentTemperature == null ? "—" : `${horse.currentTemperature.toFixed(1)}°C`}
                  </div>
                  <div className="text-xl text-gray-600">Age: {horse.age ?? "—"} years</div>
                  <div className={`${status.text} inline-block rounded-lg text-xl font-semibold`}>
                    {status.label}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {currentHorse && (
        <div className="rounded-2xl border-2 border-gray-200 bg-white p-8">
          <h2 className="mb-6 text-3xl">Profile: {currentHorse.name}</h2>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Calendar className="h-6 w-6 text-gray-600" />
                <div>
                  <div className="text-lg text-gray-600">Age</div>
                  <div className="text-2xl">{currentHorse.age ?? "—"} years</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Thermometer className="h-6 w-6 text-gray-600" />
                <div>
                  <div className="text-lg text-gray-600">Normal Temperature</div>
                  <div className="text-2xl">{currentHorse.normalTemperature.toFixed(1)}°C</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Activity className="h-6 w-6 text-gray-600" />
                <div>
                  <div className="text-lg text-gray-600">Current Temperature</div>
                  <div className="text-2xl">
                    {currentHorse.currentTemperature == null ? "No readings yet" : `${currentHorse.currentTemperature.toFixed(1)}°C`}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div className="text-lg text-gray-600">Last temperature update</div>
              <div className="mt-1 text-2xl">{formatLastUpdated(currentHorse.lastUpdated)}</div>
              <p className="mt-4 text-lg text-green-700">Automatic update every 3 minutes</p>
              <div className="mt-6 text-lg text-gray-600">Horse ID (QR tag)</div>
              <div className="mt-1 font-mono text-2xl">{currentHorse.horseCode}</div>
              {currentHorse.openAlerts > 0 && (
                <p className="mt-4 text-xl font-semibold text-red-600">
                  {currentHorse.openAlerts} open fever alert{currentHorse.openAlerts === 1 ? "" : "s"}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
