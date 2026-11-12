import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  Loader2,
  PawPrint,
  RotateCw,
  ShieldCheck,
  Video,
  X,
} from "lucide-react";
import { QrPlate } from "./QrPlate";
import { LiveCamera } from "./LiveCamera";
import {
  cancelRegistration,
  getHorseBasic,
  getLatestRegistration,
  getRegistration,
  startRegistration,
  subscribeToChanges,
  type DeviceStatus,
  type RegistrationRequest,
  type Settings,
} from "../lib/api";

interface RegisterProps {
  settings: Settings;
  devices: DeviceStatus[] | null | undefined;
  onRegistered: (horse: { id: string }) => void;
  onViewDashboard: () => void;
}

type RegisteredHorse = NonNullable<Awaited<ReturnType<typeof getHorseBasic>>>;

const VIEW_LABELS: Record<string, string> = { angled: "Angled", side: "Side", "front-back": "Front / back" };

function formatRegistrationDate(date: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));
}

const inputClass =
  "min-h-14 w-full rounded-xl border-2 border-gray-300 bg-white px-4 py-3 text-xl outline-none focus:border-green-600 focus:ring-4 focus:ring-green-100";

/**
 * Register a horse with the Raspberry Pi's stall camera:
 * the website sends a request → horse_monitor.py (--web) takes 30 photos while the horse turns,
 * reporting progress here → when done it creates the horse (photo + horse ID) → QR code.
 */
export function Register({ settings, devices, onRegistered, onViewDashboard }: RegisterProps) {
  const [request, setRequest] = useState<RegistrationRequest | null>(null);
  const [installed, setInstalled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [normalTemp, setNormalTemp] = useState("37.2");
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [horse, setHorse] = useState<RegisteredHorse | null>(null);
  const [showResult, setShowResult] = useState(false); // only show "done"/"failed" for requests made in this visit
  const reportedDone = useRef<number | null>(null);

  const active = request && (request.status === "pending" || request.status === "running");

  // Load the newest request (so a registration in progress shows after a page reload)
  useEffect(() => {
    getLatestRegistration()
      .then((r) => {
        if (r === undefined) {
          setInstalled(false);
          return;
        }
        if (r && (r.status === "pending" || r.status === "running")) {
          setRequest(r);
          setShowResult(true);
        }
      })
      .catch((e) => setFormError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  // Follow the active request: live updates + a 2-second check as a fallback
  const requestId = request?.id;
  const refresh = useCallback(async () => {
    if (!requestId) return;
    const r = await getRegistration(requestId).catch(() => null);
    if (r) setRequest(r);
  }, [requestId]);

  useEffect(() => {
    if (!requestId || !active) return;
    const unsubscribe = subscribeToChanges("registration", ["registration_requests"], (_t, row) => {
      if (Number(row.id) === requestId) refresh();
    });
    const timer = window.setInterval(refresh, 2000);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [requestId, active, refresh]);

  // Done → load the new horse and make its QR code
  useEffect(() => {
    if (!request || request.status !== "done" || !request.horse_id || reportedDone.current === request.id) return;
    reportedDone.current = request.id;
    getHorseBasic(request.horse_id).then((h) => {
      if (!h) return;
      setHorse(h);
      onRegistered({ id: h.id });
    });
  }, [request, onRegistered]);

  const start = async (event?: FormEvent, force = false, from?: RegistrationRequest) => {
    event?.preventDefault();
    const n = (from?.name ?? name).trim();
    const a = from ? from.age : age.trim() === "" ? null : Number(age);
    const t = from ? from.normal_temp : Number(normalTemp);
    if (!n) return setFormError("Enter the horse's name.");
    if (a !== null && (!Number.isInteger(a) || a < 1 || a > 40)) return setFormError("Age must be a whole number from 1 to 40.");
    if (Number.isNaN(t) || t < 35 || t > 40) return setFormError("Normal temperature must be between 35.0 and 40.0°C.");
    setBusy(true);
    setFormError("");
    try {
      const r = await startRegistration({ name: n, age: a, normal_temp: t, force });
      setRequest(r);
      setShowResult(true);
      setHorse(null);
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!request) return;
    setBusy(true);
    try {
      await cancelRegistration(request.id);
      await refresh();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setRequest(null);
    setShowResult(false);
    setHorse(null);
    setName("");
    setAge("");
    setNormalTemp("37.2");
    setFormError("");
  };

  // ------------------------------------------------------------ finished: horse card + QR
  if (horse && request?.status === "done") {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-2xl border-2 border-green-200 bg-white">
          <div className="flex flex-col gap-4 bg-green-600 px-6 py-6 text-white sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20">
                <Check className="h-8 w-8" strokeWidth={3} />
              </div>
              <div>
                <p className="text-lg font-semibold text-green-50">Registration complete</p>
                <h1 className="text-3xl font-semibold sm:text-4xl">{horse.name} is registered</h1>
              </div>
            </div>
            <div className="rounded-lg bg-green-800/40 px-4 py-2 font-mono text-lg">{horse.horseCode}</div>
          </div>

          <div className="grid gap-5 sm:gap-8 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-8">
            <div className="space-y-6">
              <div className="flex items-center justify-center overflow-hidden rounded-2xl border-2 border-gray-200 bg-black">
                {horse.photo ? (
                  <img src={horse.photo} alt={`Photo of ${horse.name} from the stall camera`} className="max-h-[420px] w-auto object-contain" />
                ) : (
                  <div className="py-24 text-7xl">🐎</div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-green-50 p-4">
                  <p className="text-sm font-semibold uppercase tracking-wide text-green-800">Age</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">{horse.age ?? "—"} years</p>
                </div>
                <div className="rounded-xl bg-green-50 p-4">
                  <p className="text-sm font-semibold uppercase tracking-wide text-green-800">Normal temp</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-900">{horse.normalTemperature.toFixed(1)}°C</p>
                </div>
                <div className="col-span-2 rounded-xl bg-green-50 p-4 sm:col-span-1">
                  <p className="text-sm font-semibold uppercase tracking-wide text-green-800">Registered</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">{formatRegistrationDate(horse.registeredAt)}</p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-xl border-2 border-green-200 bg-green-50 p-4 text-green-900">
                <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0" />
                <p className="text-lg">
                  The Raspberry Pi now recognises {horse.name} from {request.progress.photos ?? "its"} fingerprint photos. The QR
                  code is the backup ID for the stall plate.
                </p>
              </div>
            </div>

            <aside className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-green-300 bg-[#f8fcf8] p-4 sm:p-6 text-center">
              <QrPlate name={horse.name} code={horse.horseCode} />
              <div className="mt-3 grid w-full gap-3">
                <button
                  type="button"
                  onClick={onViewDashboard}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-green-800 px-5 py-3 text-lg font-semibold text-white hover:bg-green-900"
                >
                  View on Dashboard
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="mt-2 text-lg font-semibold text-green-700 underline decoration-2 underline-offset-4 hover:text-green-900"
                >
                  Register another horse
                </button>
              </div>
            </aside>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ camera + form / progress
  const device = devices?.[0];
  const piOnline = devices === undefined || devices === null ? null : devices.some((d) => d.online);
  const piHasWeb = Boolean(device && typeof device.status?.app === "string" && String(device.status.app).includes("--web"));
  const p = request?.progress ?? {};
  const photos = p.photos ?? 0;
  const needed = p.needed ?? 30;
  const percent = Math.min(100, Math.round((photos / Math.max(needed, 1)) * 100));
  const waitingLong = request?.status === "pending" && Date.now() - new Date(request.created_at).getTime() > 20000;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2 font-semibold uppercase tracking-wider text-green-700">
          <PawPrint className="h-5 w-5" />
          Horse profile manager
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold text-gray-900">Register a horse</h1>
        <p className="mt-2 text-xl text-gray-600">
          Uses the stall camera: the Raspberry Pi takes about 30 photos while the horse turns, so it can recognise it later.
        </p>
      </div>

      {!installed && (
        <div className="mb-6 rounded-xl border-2 border-yellow-400 bg-yellow-50 p-4 text-lg text-yellow-900">
          Registration through the stall camera isn't installed in the database yet. Run{" "}
          <span className="font-mono">supabase/07_remote_registration.sql</span> in the Supabase SQL Editor.
        </div>
      )}

      {installed && piOnline === false && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-lg text-red-900">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />
          <span>
            The Raspberry Pi is <strong>offline</strong>. You can still start; the registration begins when the Pi is back online
            and <span className="font-mono">thesisv2.py --web</span> is running.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          <LiveCamera url={settings.camera_stream_url} label={request && active ? `Registering: ${request.name}` : "Stall camera"} />
          <div className="mt-4 rounded-xl border-2 border-gray-200 bg-white p-4 text-lg text-gray-700">
            <div className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
              <Video className="h-5 w-5" /> How to register
            </div>
            <ol className="list-decimal space-y-1 pl-6">
              <li>Bring <strong>one horse</strong> into the stall, whole body visible in the camera.</li>
              <li>Enter its details and press <strong>Start registration</strong>.</li>
              <li>
                Turn the horse <strong>slowly all the way round</strong>: angled, both sides, front and back. The checklist on the
                right fills up.
              </li>
              <li>It finishes by itself (usually 1–3 minutes) and shows the horse's QR code.</li>
            </ol>
          </div>
        </div>

        <div className="space-y-4">
          {loading ? (
            <div className="rounded-2xl border-2 border-gray-200 bg-white p-4 sm:p-6 text-xl text-gray-600">Loading…</div>
          ) : active && request ? (
            /* -------------------- in progress -------------------- */
            <div className="rounded-2xl border-2 border-green-300 bg-white p-4 sm:p-6">
              <div className="flex items-center gap-3">
                <Loader2 className="h-7 w-7 animate-spin text-green-700" />
                <h2 className="text-2xl">
                  {request.status === "pending" ? "Waiting for the Pi…" : `Registering ${request.name}`}
                </h2>
              </div>

              {request.status === "pending" ? (
                <p className="mt-3 text-lg text-gray-600">
                  The request was sent. The Raspberry Pi starts within a few seconds.
                  {waitingLong && (
                    <span className="mt-2 block rounded-lg bg-yellow-50 p-3 text-yellow-900">
                      Still waiting. Check that the Pi is online and <span className="font-mono">thesisv2.py</span> runs
                      with <span className="font-mono">--web</span>.
                    </span>
                  )}
                </p>
              ) : (
                <>
                  <div className="mt-5">
                    <div className="mb-1 flex justify-between text-lg">
                      <span>Photos</span>
                      <span className="font-semibold tabular-nums">
                        {photos} / {needed}
                      </span>
                    </div>
                    <div className="h-5 w-full overflow-hidden rounded-full bg-gray-200" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                      <div className="h-full rounded-full bg-green-600 transition-all" style={{ width: `${percent}%` }} />
                    </div>
                  </div>

                  <div className="mt-5 space-y-2">
                    <div className="text-lg font-semibold">Views needed</div>
                    {Object.entries(p.need_views ?? { angled: 10, side: 4, "front-back": 2 })
                      .filter(([, need]) => need > 0)
                      .map(([view, need]) => {
                        const have = p.views?.[view] ?? 0;
                        const ok = have >= need;
                        return (
                          <div key={view} className={`flex items-center justify-between rounded-lg px-3 py-2 text-lg ${ok ? "bg-green-50" : "bg-gray-50"}`}>
                            <span className="flex items-center gap-2">
                              {ok ? <CheckCircle2 className="h-5 w-5 text-green-600" /> : <Circle className="h-5 w-5 text-gray-400" />}
                              {VIEW_LABELS[view] ?? view}
                            </span>
                            <span className="tabular-nums">
                              {Math.min(have, need)} / {need}
                            </span>
                          </div>
                        );
                      })}
                  </div>

                  {(p.note || (p.horses_in_view != null && p.horses_in_view !== 1)) && (
                    <div className="mt-4 flex items-start gap-2 rounded-lg border-2 border-yellow-300 bg-yellow-50 p-3 text-lg text-yellow-900">
                      <RotateCw className="mt-0.5 h-5 w-5 shrink-0" />
                      <span>
                        {p.horses_in_view === 0
                          ? "No horse in view: bring the horse in front of the camera."
                          : p.horses_in_view != null && p.horses_in_view > 1
                            ? `${p.horses_in_view} horses in view: only one horse may be in the stall.`
                            : p.note}
                      </span>
                    </div>
                  )}
                </>
              )}

              <button
                type="button"
                onClick={cancel}
                disabled={busy}
                className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-red-300 px-5 text-lg text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                <X className="h-5 w-5" /> Cancel registration
              </button>
            </div>
          ) : (
            <>
              {/* -------------------- result of the last attempt -------------------- */}
              {showResult && request && (request.status === "failed" || request.status === "cancelled") && (
                <div className={`rounded-2xl border-2 p-5 ${request.status === "failed" ? "border-red-300 bg-red-50" : "border-gray-300 bg-gray-50"}`}>
                  <h2 className="text-2xl">
                    {request.status === "failed" ? `${request.name} was not registered` : "Registration cancelled"}
                  </h2>
                  {request.message && <p className="mt-2 text-lg text-gray-800">{request.message}</p>}
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => start(undefined, false, request)}
                      disabled={busy}
                      className="flex min-h-12 items-center gap-2 rounded-xl bg-green-600 px-5 text-lg text-white hover:bg-green-700 disabled:opacity-60"
                    >
                      <RotateCw className="h-5 w-5" /> Try again
                    </button>
                    {request.status === "failed" && /looks like/i.test(request.message ?? "") && (
                      <button
                        type="button"
                        onClick={() => start(undefined, true, request)}
                        disabled={busy}
                        className="flex min-h-12 items-center gap-2 rounded-xl border-2 border-red-400 bg-white px-5 text-lg text-red-700 hover:bg-red-50 disabled:opacity-60"
                      >
                        Register anyway
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* -------------------- form -------------------- */}
              <form onSubmit={(e) => start(e)} className="space-y-5 rounded-2xl border-2 border-gray-200 bg-white p-4 sm:p-6">
                <h2 className="text-2xl">Horse details</h2>
                <div>
                  <label htmlFor="horseName" className="mb-2 block text-lg font-semibold">Horse name</label>
                  <input id="horseName" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required className={inputClass} placeholder="e.g. Jafar" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="horseAge" className="mb-2 block text-lg font-semibold">Age (years)</label>
                    <input id="horseAge" type="number" min={1} max={40} value={age} onChange={(e) => setAge(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="normalTemperature" className="mb-2 block text-lg font-semibold">Normal temp (°C)</label>
                    <input id="normalTemperature" type="number" step="0.1" min={35} max={40} value={normalTemp} onChange={(e) => setNormalTemp(e.target.value)} className={inputClass} />
                  </div>
                </div>

                {formError && (
                  <div role="alert" className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-lg font-semibold text-red-800">
                    {formError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy || !installed}
                  className="flex min-h-16 w-full items-center justify-center gap-3 rounded-xl bg-green-600 px-6 py-4 text-xl font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Video className="h-7 w-7" />
                  {busy ? "Sending…" : "Start registration"}
                </button>
                {piOnline && !piHasWeb && device?.status?.app != null && (
                  <p className="text-base text-gray-600">
                    The Pi is online. Make sure <span className="font-mono">thesisv2.py</span> is running with{" "}
                    <span className="font-mono">--web</span>, otherwise the request waits.
                  </p>
                )}
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
