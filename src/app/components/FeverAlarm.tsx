import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Volume2, VolumeX, X } from 'lucide-react';
import { subscribeToChanges, type HorseRecord } from '../lib/api';

interface NewAlert {
  id: number;
  horseName: string;
  temperature: number;
}

/** Plays a short two-tone alarm (no sound file needed). */
function playAlarm(context: AudioContext) {
  const start = context.currentTime + 0.05;
  for (let i = 0; i < 3; i++) {
    for (const [offset, frequency] of [[0, 880], [0.22, 660]] as const) {
      const t = start + i * 0.6 + offset;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'square';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(gain).connect(context.destination);
      osc.start(t);
      osc.stop(t + 0.21);
    }
  }
}

/**
 * Listens for NEW fever alerts on every page. Shows a red banner and,
 * if "Enable sound alerts" is on in Settings, plays an alarm.
 */
export function FeverAlarm({
  enabled,
  soundOn,
  horses,
  onOpenAlerts,
}: {
  enabled: boolean;
  soundOn: boolean;
  horses: HorseRecord[];
  onOpenAlerts: () => void;
}) {
  const [alerts, setAlerts] = useState<NewAlert[]>([]);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const horsesRef = useRef(horses);
  const soundRef = useRef(soundOn);
  horsesRef.current = horses;
  soundRef.current = soundOn;

  const getAudio = useCallback(() => {
    if (!audio.current) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      audio.current = new Ctx();
    }
    return audio.current;
  }, []);

  // Browsers only allow sound after the user has clicked the page once.
  useEffect(() => {
    if (!enabled || !soundOn) return;
    const unlock = () => {
      const ctx = getAudio();
      ctx?.resume().then(() => setSoundBlocked(false)).catch(() => undefined);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [enabled, soundOn, getAudio]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeToChanges('fever-alarm', ['alerts'], (_table, row, event) => {
      if (event !== 'INSERT' || row.status !== 'active') return;
      const horse = horsesRef.current.find((h) => h.id === row.horse_id);
      const alert: NewAlert = {
        id: Number(row.id),
        horseName: horse?.name ?? 'A horse',
        temperature: Number(row.temperature),
      };
      setAlerts((current) => (current.some((a) => a.id === alert.id) ? current : [alert, ...current].slice(0, 3)));

      if (soundRef.current) {
        const ctx = getAudio();
        if (!ctx) return;
        if (ctx.state === 'running') {
          playAlarm(ctx);
        } else {
          ctx.resume().then(() => playAlarm(ctx)).catch(() => setSoundBlocked(true));
          window.setTimeout(() => ctx.state !== 'running' && setSoundBlocked(true), 500);
        }
      }
    });
  }, [enabled, getAudio]);

  if (alerts.length === 0) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 p-3" role="alert" aria-live="assertive">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="flex w-full max-w-2xl items-center gap-4 rounded-2xl border-4 border-red-800 bg-red-600 px-5 py-4 text-white shadow-2xl"
        >
          <AlertTriangle className="h-10 w-10 flex-shrink-0 animate-pulse" />
          <div className="flex-1">
            <div className="text-2xl font-semibold">Fever alert: {alert.horseName}</div>
            <div className="text-xl">{alert.temperature.toFixed(1)}°C · just now</div>
            {soundOn && soundBlocked && (
              <div className="mt-1 flex items-center gap-1 text-base text-red-100">
                <VolumeX className="h-4 w-4" /> Sound was blocked by the browser. Click anywhere on the page once to allow alarm sounds.
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              setAlerts([]);
              onOpenAlerts();
            }}
            className="rounded-xl bg-white px-4 py-2 text-lg font-semibold text-red-700 hover:bg-red-50"
          >
            View
          </button>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setAlerts((current) => current.filter((a) => a.id !== alert.id))}
            className="rounded-lg p-1 hover:bg-red-700"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Small "test the alarm" button for Settings. */
export function TestAlarmButton() {
  return (
    <button
      type="button"
      onClick={() => {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        playAlarm(ctx);
        window.setTimeout(() => ctx.close(), 2500);
      }}
      className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-lg hover:bg-gray-200"
    >
      <Volume2 className="h-5 w-5" /> Test sound
    </button>
  );
}
