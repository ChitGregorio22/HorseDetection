import { useEffect, useState } from "react";
import { Activity, ArchiveRestore, Calendar, Pencil, Plus, Thermometer, Trash2, UserMinus } from "lucide-react";
import { QrPlate } from "./QrPlate";
import { ProfilePhotos } from "./ProfilePhotos";
import { fmtHumidity, fmtTemp, fmtWhen, MethodBadge, RecentReadingsTable, useRecentReadings } from "./ReadingBits";
import type { HorseRecord } from "../App";
import {
  classify,
  deleteHorsePermanently,
  getRemovedHorses,
  setHorseActive,
  updateHorse,
  type Settings,
} from "../lib/api";
import type { Permissions } from "../lib/permissions";

interface HorsesProps {
  horses: HorseRecord[];
  selectedHorseId: string | null;
  settings: Settings;
  can: Permissions;
  onSelectHorse: (horseId: string) => void;
  /** undefined when this role can't register horses */
  onRegister?: () => void;
  /** reload the horse list after an edit / removal */
  onChanged: () => Promise<void> | void;
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
  can,
  onSelectHorse,
  onRegister,
  onChanged,
}: HorsesProps) {
  const currentHorse = horses.find((horse) => horse.id === selectedHorseId) ?? null;
  const removedList = can.manageHorses ? <RemovedHorses can={can} onChanged={onChanged} refreshKey={horses.length} /> : null;

  if (horses.length === 0) {
    return (
      <div className="p-3 sm:p-6">
        <div className="flex min-h-[480px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-green-300 bg-green-50 px-6 text-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-green-600 text-3xl sm:text-4xl">🐎</div>
          <h1 className="text-3xl sm:text-4xl font-semibold text-gray-900">No horses registered</h1>
          <p className="mt-3 max-w-xl text-xl text-gray-600">
            {onRegister
              ? "Register a horse with the live camera to begin monitoring."
              : "No horses have been registered yet. An owner or admin can register them."}
          </p>
          {onRegister && (
            <button
              type="button"
              onClick={onRegister}
              className="mt-7 flex min-h-14 items-center gap-2 rounded-xl bg-green-600 px-7 py-3 text-xl font-semibold text-white hover:bg-green-700"
            >
              <Plus className="h-6 w-6" />
              Register Horse
            </button>
          )}
        </div>
        {removedList && <div className="mt-6">{removedList}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl sm:text-4xl">Horse Profiles</h1>
        {onRegister && (
          <button
            type="button"
            onClick={onRegister}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-lg font-semibold text-white hover:bg-green-700"
          >
            <Plus className="h-5 w-5" />
            Register Another Horse
          </button>
        )}
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
              <div className="grid grid-cols-[88px_1fr] sm:grid-cols-[120px_1fr]">
                <HorsePhoto src={horse.photo} name={horse.name} />
                <div className="min-w-0 space-y-2 p-3 sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="truncate text-2xl sm:text-3xl">🐎 {horse.name}</h2>
                    <Activity className={`${status.text} h-8 w-8 shrink-0`} />
                  </div>
                  <div className={`${status.text} text-3xl sm:text-4xl tabular-nums`}>
                    {horse.currentTemperature == null ? "—" : `${horse.currentTemperature.toFixed(1)}°C`}
                  </div>
                  {horse.currentTemperature != null && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-gray-700">
                      <span>Surface {fmtTemp(horse.surfaceTemperature)}</span>
                      <span className="text-blue-700">Air {fmtTemp(horse.envTemperature)}</span>
                      <span className="text-cyan-700">{fmtHumidity(horse.humidity)} RH</span>
                      <MethodBadge method={horse.idMethod} />
                      <span className="text-gray-500">{fmtWhen(horse.lastUpdated)}</span>
                    </div>
                  )}
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
        <div className="rounded-2xl border-2 border-gray-200 bg-white p-5 sm:p-8">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-3xl">Profile: {currentHorse.name}</h2>
            {can.manageHorses && <HorseActions key={currentHorse.id} horse={currentHorse} onChanged={onChanged} />}
          </div>
          {can.manageHorses && <EditHorseForm key={`edit-${currentHorse.id}`} horse={currentHorse} onChanged={onChanged} />}

          <ProfilePhotos
            key={`photos-${currentHorse.id}`}
            horseId={currentHorse.id}
            horseName={currentHorse.name}
            fallback={currentHorse.photo}
            canManage={can.manageHorses}
            cameraUrl={settings.camera_stream_url}
            onChanged={onChanged}
          />

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
              {currentHorse.openAlerts > 0 && (
                <p className="mt-4 text-xl font-semibold text-red-600">
                  {currentHorse.openAlerts} open fever alert{currentHorse.openAlerts === 1 ? "" : "s"}
                </p>
              )}
              <div className="mt-6 rounded-2xl border-2 border-dashed border-green-300 bg-[#f8fcf8] p-5">
                <QrPlate name={currentHorse.name} code={currentHorse.horseCode} />
              </div>
            </div>
          </div>

          <ProfileReadings horseId={currentHorse.id} />
        </div>
      )}

      {removedList}
    </div>
  );
}

const inputClass =
  "min-h-12 w-full rounded-lg border-2 border-gray-300 px-4 py-2 text-xl focus:border-green-600 focus:outline-none";

/** Edit name / age / normal temperature (owner + admin). Hidden until "Edit" is clicked. */
function EditHorseForm({ horse, onChanged }: { horse: HorseRecord; onChanged: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(horse.name);
  const [age, setAge] = useState(horse.age == null ? "" : String(horse.age));
  const [normal, setNormal] = useState(horse.normalTemperature.toFixed(1));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(`edit-horse-${horse.id}`, show);
    return () => window.removeEventListener(`edit-horse-${horse.id}`, show);
  }, [horse.id]);

  if (!open) return null;

  const save = async () => {
    const ageNumber = age.trim() === "" ? null : Number(age);
    const normalNumber = Number(normal);
    if (!name.trim()) return setError("Enter the horse's name.");
    if (ageNumber !== null && (!Number.isInteger(ageNumber) || ageNumber < 1 || ageNumber > 40)) {
      return setError("Age must be a whole number from 1 to 40.");
    }
    if (Number.isNaN(normalNumber) || normalNumber < 35 || normalNumber > 40) {
      return setError("Normal temperature must be between 35.0 and 40.0°C.");
    }
    setSaving(true);
    setError("");
    try {
      await updateHorse(horse.id, { name: name.trim(), age: ageNumber, normal_temp: normalNumber });
      await onChanged();
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 rounded-xl border-2 border-blue-300 bg-blue-50 p-5">
      <h3 className="mb-4 text-2xl">Edit {horse.name}</h3>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-lg font-semibold">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-lg font-semibold">Age (years)</span>
          <input type="number" min={1} max={40} value={age} onChange={(e) => setAge(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-lg font-semibold">Normal temperature (°C)</span>
          <input type="number" step="0.1" min={35} max={40} value={normal} onChange={(e) => setNormal(e.target.value)} className={inputClass} />
        </label>
      </div>
      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-lg text-red-800">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-6 py-3 text-lg text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border-2 border-gray-300 bg-white px-6 py-3 text-lg hover:bg-gray-100">
          Cancel
        </button>
      </div>
      <p className="mt-3 text-base text-gray-600">
        The horse ID on the QR tag ({horse.horseCode}) stays the same, so the camera keeps recognising it.
      </p>
    </div>
  );
}

/** Edit / Remove-from-monitoring buttons with a confirm step (owner + admin). */
function HorseActions({ horse, onChanged }: { horse: HorseRecord; onChanged: () => Promise<void> | void }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const remove = async () => {
    try {
      await setHorseActive(horse.id, false);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(`edit-horse-${horse.id}`))}
          className="flex items-center gap-2 rounded-lg border-2 border-blue-300 px-4 py-2 text-lg text-blue-700 hover:bg-blue-50"
        >
          <Pencil className="h-5 w-5" /> Edit
        </button>
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex items-center gap-2 rounded-lg border-2 border-red-300 px-4 py-2 text-lg text-red-700 hover:bg-red-50"
          >
            <UserMinus className="h-5 w-5" /> Remove from monitoring
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2">
            <span className="text-lg">Remove {horse.name}? Its history is kept.</span>
            <button type="button" onClick={remove} className="rounded-lg bg-red-600 px-4 py-1.5 text-lg text-white hover:bg-red-700">
              Yes, remove
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded-lg bg-white px-4 py-1.5 text-lg hover:bg-gray-100">
              Cancel
            </button>
          </div>
        )}
      </div>
      {error && <p className="text-lg text-red-700">{error}</p>}
    </div>
  );
}

/** Horses removed from monitoring: restore (owner + admin) or delete for good (admin). */
function RemovedHorses({
  can,
  onChanged,
  refreshKey,
}: {
  can: Permissions;
  onChanged: () => Promise<void> | void;
  refreshKey: number;
}) {
  const [list, setList] = useState<{ id: string; name: string; horse_code: string; updated_at: string }[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = () => getRemovedHorses().then(setList).catch(() => setList([]));
  useEffect(() => {
    load();
  }, [refreshKey]);

  if (list.length === 0) return null;

  const run = async (action: () => Promise<void>) => {
    setError("");
    try {
      await action();
      await load();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-gray-200 bg-white p-4 sm:p-6">
      <h2 className="mb-1 text-2xl">Removed from monitoring ({list.length})</h2>
      <p className="mb-4 text-lg text-gray-600">These horses are hidden from the dashboard. Their readings are kept for the records.</p>
      {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-lg text-red-800">{error}</p>}
      <div className="space-y-3">
        {list.map((horse) => (
          <div key={horse.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-gray-200 p-4">
            <div>
              <div className="text-xl">{horse.name}</div>
              <div className="font-mono text-base text-gray-500">{horse.horse_code}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => run(() => setHorseActive(horse.id, true))}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-lg text-white hover:bg-green-700"
              >
                <ArchiveRestore className="h-5 w-5" /> Restore
              </button>
              {can.deleteHorses &&
                (confirmDelete === horse.id ? (
                  <>
                    <span className="text-lg text-red-700">Deletes all its readings and alerts too.</span>
                    <button
                      type="button"
                      onClick={() => run(() => deleteHorsePermanently(horse.id))}
                      className="rounded-lg bg-red-600 px-4 py-2 text-lg text-white hover:bg-red-700"
                    >
                      Delete forever
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(null)} className="rounded-lg border-2 border-gray-300 px-4 py-2 text-lg hover:bg-gray-100">
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(horse.id)}
                    className="flex items-center gap-2 rounded-lg border-2 border-red-300 px-4 py-2 text-lg text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-5 w-5" /> Delete permanently
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horse photo, falling back to 🐎 when there is no photo or it fails to load. */
function HorsePhoto({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <div className="flex h-full min-h-48 w-full items-center justify-center bg-white/60 text-5xl sm:text-6xl">🐎</div>;
  }
  return <img src={src} alt={name} onError={() => setFailed(true)} className="h-full min-h-48 w-full object-cover" />;
}

/** Horse profile: the newest readings with surface, air, humidity and how the horse was named */
function ProfileReadings({ horseId }: { horseId: string }) {
  const { rows, loading } = useRecentReadings(horseId, 20);
  return (
    <div className="mt-8">
      <h3 className="mb-3 text-2xl">Recent readings</h3>
      <RecentReadingsTable rows={rows} loading={loading} />
    </div>
  );
}
