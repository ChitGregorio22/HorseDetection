import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BellOff, Check } from "lucide-react";
import { getAlerts, setAlertStatus, subscribeToChanges, type Alert, type Settings } from "../lib/api";

interface AlertsProps {
  selectedHorse: string;
  settings: Settings;
  /** false = this role can only view alerts */
  canHandle: boolean;
}

const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export function Alerts({ selectedHorse, settings, canHandle }: AlertsProps) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setAlerts(await getAlerts());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Alerts are created by the database when a fever reading arrives; listen for them live.
  useEffect(() => {
    load();
    return subscribeToChanges("alerts", ["alerts"], () => load());
  }, [load]);

  const changeStatus = async (alert: Alert, status: "acknowledged" | "resolved") => {
    setBusyId(alert.id);
    try {
      await setAlertStatus(alert.id, status);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const activeAlert = alerts.find((a) => a.status === "active");
  const activeCount = alerts.filter((a) => a.status === "active").length;

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      {/* Active Alert Banner */}
      {activeAlert && (
        <div className="rounded-2xl border-4 border-red-700 bg-red-600 p-5 sm:p-8 text-white">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <AlertTriangle className="h-16 w-16 animate-pulse" />
              <h2 className="text-4xl sm:text-5xl">ALERT!</h2>
            </div>
            <div className="space-y-2">
              <p className="text-3xl">Horse: {activeAlert.horses?.name ?? "Unknown"}</p>
              <p className="text-3xl sm:text-4xl">Temperature: {activeAlert.temperature.toFixed(1)}°C</p>
              <p className="text-2xl">Time: {formatDateTime(activeAlert.created_at)}</p>
            </div>
            {canHandle && (
              <div className="mt-6 flex flex-wrap gap-4">
                <button
                  type="button"
                  onClick={() => changeStatus(activeAlert, "acknowledged")}
                  disabled={busyId === activeAlert.id}
                  className="flex items-center gap-3 rounded-xl bg-white px-8 py-4 text-2xl text-red-700 hover:bg-red-50 disabled:opacity-70"
                >
                  <Check className="h-6 w-6" />
                  Acknowledge
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <h1 className="text-3xl sm:text-4xl">Alert History</h1>
        <p className="mt-2 text-xl text-gray-600">
          {selectedHorse
            ? `All horses · ${activeCount} active alert${activeCount === 1 ? "" : "s"}`
            : "No horse registered"}
        </p>
      </div>

      {error && (
        <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-lg text-red-800">{error}</div>
      )}

      {loading ? (
        <p className="text-2xl text-gray-600">Loading alerts…</p>
      ) : alerts.length === 0 ? (
        <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border-2 border-gray-200 bg-white px-6 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <BellOff className="h-8 w-8 text-green-700" />
          </div>
          <h2 className="text-3xl">No alerts yet</h2>
          <p className="mt-2 max-w-lg text-xl text-gray-600">
            {selectedHorse
              ? `Fever alerts will appear here automatically when a reading reaches ${settings.fever_threshold.toFixed(1)}°C.`
              : "Register a horse to begin temperature monitoring."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => {
            const isActive = alert.status === "active";
            const isAcknowledged = alert.status === "acknowledged";
            const panel = isActive
              ? "border-red-600 bg-red-50"
              : isAcknowledged
                ? "border-yellow-600 bg-yellow-50"
                : "border-gray-300 bg-white";

            return (
              <div key={alert.id} className={`${panel} rounded-xl border-2 p-4 sm:p-6`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      {isActive && <AlertTriangle className="h-6 w-6 text-red-600" />}
                      <span className="text-2xl">Horse: {alert.horses?.name ?? "Unknown"}</span>
                    </div>
                    <div className="text-3xl text-red-600 tabular-nums">
                      Temperature: {alert.temperature.toFixed(1)}°C
                    </div>
                    <div className="text-xl text-gray-600">{formatDateTime(alert.created_at)}</div>
                    {alert.notes && <div className="text-lg text-gray-700">Notes: {alert.notes}</div>}
                  </div>

                  <div className="flex flex-col items-end gap-3">
                    <span
                      className={`inline-block rounded-lg px-4 py-2 text-xl text-white ${
                        isActive ? "bg-red-600" : isAcknowledged ? "bg-yellow-600" : "bg-gray-600"
                      }`}
                    >
                      {alert.status.toUpperCase()}
                    </span>
                    {isAcknowledged && canHandle && (
                      <button
                        type="button"
                        onClick={() => changeStatus(alert, "resolved")}
                        disabled={busyId === alert.id}
                        className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-lg text-white hover:bg-green-700 disabled:opacity-70"
                      >
                        <Check className="h-5 w-5" /> Mark Resolved
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-xl border-2 border-blue-600 bg-blue-50 p-4 sm:p-6">
        <h2 className="mb-3 text-2xl">Alert Settings</h2>
        <div className="space-y-2 text-xl">
          <p>🟡 Warning threshold: {settings.warning_threshold.toFixed(1)}°C</p>
          <p>🔴 Fever threshold: {settings.fever_threshold.toFixed(1)}°C</p>
          <p>🔔 Sound alerts: {settings.sound_alerts ? "On" : "Off"}</p>
        </div>
      </div>
    </div>
  );
}
