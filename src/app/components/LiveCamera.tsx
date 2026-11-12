import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Maximize, RefreshCw } from 'lucide-react';

interface LiveCameraProps {
  /** MJPEG stream from the Raspberry Pi, e.g. https://horse-cam.tailnet.ts.net/stream.mjpg?key=... */
  url: string | null;
  /** Shown as an overlay on the video */
  label?: string;
  /** false = no LIVE/OFFLINE badge in the title bar (the Dashboard shows it in "In the stall now") */
  showStatus?: boolean;
  /** told whenever the picture goes live / connecting / offline */
  onStateChange?: (state: CameraState | 'not-set-up') => void;
}

export type CameraState = 'connecting' | 'live' | 'offline';

/** Adds a changing number so "Retry" really reconnects instead of reusing a cached image. */
function withRetryParam(url: string, attempt: number) {
  return `${url}${url.includes('?') ? '&' : '?'}t=${attempt}`;
}

export function LiveCamera({ url, label, showStatus = true, onStateChange }: LiveCameraProps) {
  const [state, setState] = useState<CameraState>('connecting');
  const [attempt, setAttempt] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // A secure (https) website is not allowed to show an http:// camera.
  const blockedByBrowser =
    !!url && url.startsWith('http://') && typeof window !== 'undefined' && window.location.protocol === 'https:';

  // Start (or restart) connecting whenever the address changes or Retry is pressed.
  useEffect(() => {
    if (!url || blockedByBrowser) return;
    setState('connecting');
    const timeout = window.setTimeout(() => {
      setState((current) => (current === 'connecting' ? 'offline' : current));
    }, 12000);
    return () => window.clearTimeout(timeout);
  }, [url, attempt, blockedByBrowser]);

  // Try to reconnect by itself every 20 seconds while offline (e.g. the Pi was restarted).
  useEffect(() => {
    if (state !== 'offline' || !url || blockedByBrowser) return;
    const timer = window.setTimeout(() => setAttempt((n) => n + 1), 20000);
    return () => window.clearTimeout(timer);
  }, [state, url, blockedByBrowser]);

  const retry = () => setAttempt((n) => n + 1);
  const fullscreen = () => containerRef.current?.requestFullscreen?.();

  const isLive = state === 'live' && !blockedByBrowser;

  useEffect(() => {
    onStateChange?.(!url || blockedByBrowser ? 'not-set-up' : state);
  }, [state, url, blockedByBrowser, onStateChange]);

  // The picture can't be right-clicked (save / copy address / open) or dragged out
  const noMenu = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border-4 border-gray-800 bg-gray-900">
      {/* Title bar */}
      <div className="flex items-center justify-between gap-2 bg-gray-800 px-3 py-2 text-white sm:gap-3 sm:px-5 sm:py-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Camera className="h-6 w-6 shrink-0 sm:h-7 sm:w-7" />
          <h2 className="truncate text-xl sm:text-2xl">Live Camera</h2>
          {showStatus && url && !blockedByBrowser && (
            <span
              className={`flex items-center gap-2 rounded-full px-3 py-1 text-base font-semibold ${
                isLive ? 'bg-red-600' : state === 'connecting' ? 'bg-yellow-600' : 'bg-gray-600'
              }`}
            >
              <span className={`h-2.5 w-2.5 rounded-full bg-white ${isLive ? 'animate-pulse' : ''}`} />
              {isLive ? 'LIVE' : state === 'connecting' ? 'CONNECTING' : 'OFFLINE'}
            </span>
          )}
        </div>

        {url && !blockedByBrowser && (
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={retry}
              title="Reconnect"
              className="flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-lg bg-gray-700 px-2.5 py-2 text-base hover:bg-gray-600 sm:px-3"
            >
              <RefreshCw className="h-5 w-5" />
              <span className="hidden sm:inline">Reconnect</span>
            </button>
            <button
              type="button"
              onClick={fullscreen}
              title="Full screen"
              className="flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-lg bg-gray-700 px-2.5 py-2 text-base hover:bg-gray-600 sm:px-3"
            >
              <Maximize className="h-5 w-5" />
              <span className="hidden sm:inline">Full screen</span>
            </button>
          </div>
        )}
      </div>

      {/* Video area */}
      <div
        ref={containerRef}
        onContextMenu={noMenu}
        className="relative flex aspect-video min-h-[13rem] w-full flex-1 select-none items-center justify-center bg-black"
      >
        {!url ? (
          <Message
            title="Camera not set up yet"
            text="Start the camera program on the Raspberry Pi, then an admin pastes its address in Settings → Live Camera."
          />
        ) : blockedByBrowser ? (
          <Message
            title="This camera address can't be shown here"
            text="The address starts with http://, which browsers block on a secure (https) website. Use the https://…ts.net Tailscale Funnel address instead (Settings → Live Camera)."
          />
        ) : (
          <>
            <img
              key={attempt}
              src={withRetryParam(url, attempt)}
              alt="Live camera feed from the Raspberry Pi"
              onLoad={() => setState('live')}
              onError={() => setState('offline')}
              onContextMenu={noMenu}
              onDragStart={noMenu}
              draggable={false}
              className={`pointer-events-none h-full w-full object-contain ${state === 'offline' ? 'invisible' : ''}`}
            />

            {state === 'connecting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
                <RefreshCw className="h-9 w-9 animate-spin opacity-80 sm:h-12 sm:w-12" />
                <p className="text-lg sm:text-xl">Connecting to the Raspberry Pi…</p>
              </div>
            )}

            {state === 'offline' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-white sm:gap-4 sm:px-6">
                <CameraOff className="h-9 w-9 opacity-80 sm:h-14 sm:w-14" />
                <p className="text-xl sm:text-2xl">Camera offline</p>
                <p className="hidden max-w-md text-lg text-gray-300 sm:block">
                  Check that the Raspberry Pi is on and the camera program and Tailscale are running. Retrying automatically…
                </p>
                <p className="text-sm text-gray-300 sm:hidden">Retrying automatically…</p>
                <button
                  type="button"
                  onClick={retry}
                  className="rounded-xl bg-white px-5 py-2 text-lg text-gray-900 hover:bg-gray-200 sm:px-6 sm:py-3 sm:text-xl"
                >
                  Try Again Now
                </button>
              </div>
            )}

            {isLive && label && (
              <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-black/60 px-3 py-1.5 text-lg text-white">
                {label}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-6 text-center text-white sm:gap-4 sm:px-6 sm:py-10">
      <CameraOff className="h-10 w-10 opacity-70 sm:h-14 sm:w-14" />
      <p className="text-xl sm:text-2xl">{title}</p>
      <p className="max-w-lg text-base text-gray-300 sm:text-lg">{text}</p>
    </div>
  );
}
