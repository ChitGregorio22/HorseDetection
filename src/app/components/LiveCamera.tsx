import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Maximize, RefreshCw } from 'lucide-react';
import type HlsType from 'hls.js';

interface LiveCameraProps {
  /** MJPEG stream from the Raspberry Pi, e.g. https://horse-cam.tailnet.ts.net/stream.mjpg?key=...
   *  (saved in Settings → Live Camera). The H.264 (HLS) address is worked out from it. */
  url: string | null;
  /** Shown as an overlay on the video */
  label?: string;
  /** false = no LIVE/OFFLINE badge in the title bar (the Dashboard shows it in "In the stall now") */
  showStatus?: boolean;
  /** told whenever the picture goes live / connecting / offline */
  onStateChange?: (state: CameraState | 'not-set-up') => void;
}

export type CameraState = 'connecting' | 'live' | 'offline';

/**
 * H.264 low-latency HLS from MediaMTX on the Pi, built from the saved MJPEG address:
 *   https://<pi>.ts.net/stream.mjpg?key=K  →  https://<pi>.ts.net:8443/cam_K/index.m3u8
 * (same host and stream key; nothing is hard-coded here).
 */
export function hlsUrlFrom(mjpegUrl: string | null): string | null {
  if (!mjpegUrl) return null;
  try {
    const u = new URL(mjpegUrl);
    const key = u.searchParams.get('key');
    if (!key) return null;
    return `${u.protocol}//${u.hostname}:8443/cam_${encodeURIComponent(key)}/index.m3u8`;
  } catch {
    return null;
  }
}

const HLS_RETRY_MS = 5000; // after a failed HLS try
const HLS_FAILS_BEFORE_JPEG = 3; // in a row, then show the MJPEG picture
const HLS_RETRY_ON_JPEG_MS = 60000; // while MJPEG works, try HLS again this often
const OFFLINE_RETRY_MS = 10000; // both fail (Pi offline): one try of each this often
const START_TIMEOUT_MS = 15000; // a stream that hasn't shown a picture by then counts as failed
const FROZEN_MS = 15000; // HLS picture not moving for this long counts as failed

/** Adds a changing number so a retry really reconnects instead of reusing a cached image. */
function withRetryParam(url: string, attempt: number) {
  return `${url}${url.includes('?') ? '&' : '?'}t=${attempt}`;
}

export function LiveCamera({ url, label, showStatus = true, onStateChange }: LiveCameraProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // A secure (https) website is not allowed to show an http:// camera.
  const blockedByBrowser =
    !!url && url.startsWith('http://') && typeof window !== 'undefined' && window.location.protocol === 'https:';
  const hlsUrl = blockedByBrowser ? null : hlsUrlFrom(url);

  const [hlsAttempt, setHlsAttempt] = useState(0);
  const [hlsPlaying, setHlsPlaying] = useState(false);
  const hlsFails = useRef(0);

  const [jpegWanted, setJpegWanted] = useState(false);
  const [jpegAttempt, setJpegAttempt] = useState(0);
  const [jpegPlaying, setJpegPlaying] = useState(false);
  const [jpegFailed, setJpegFailed] = useState(false);
  const jpegPlayingRef = useRef(false);
  jpegPlayingRef.current = jpegPlaying;

  // No HLS address (old saved address without ?key=): MJPEG only, as before.
  useEffect(() => {
    hlsFails.current = 0;
    setHlsPlaying(false);
    setJpegPlaying(false);
    setJpegFailed(false);
    setJpegWanted(!!url && !blockedByBrowser && !hlsUrl);
  }, [url, hlsUrl, blockedByBrowser]);

  // ---------------------------------------------------------------- HLS (one try per hlsAttempt)
  useEffect(() => {
    const video = videoRef.current;
    if (!hlsUrl || !video) return;
    let finished = false;
    let hls: HlsType | null = null;
    let retryTimer = 0;
    let startTimer = 0;
    let frozenTimer = 0;
    let lastTime = -1;
    let lastMove = Date.now();

    const stopPlayer = () => {
      window.clearTimeout(startTimer);
      window.clearInterval(frozenTimer);
      if (hls) {
        hls.destroy();
        hls = null;
      }
      video.removeAttribute('src');
      try {
        video.load();
      } catch {
        /* nothing loaded */
      }
    };

    const fail = () => {
      if (finished) return;
      finished = true;
      stopPlayer();
      setHlsPlaying(false);
      hlsFails.current += 1;
      if (hlsFails.current < HLS_FAILS_BEFORE_JPEG) {
        retryTimer = window.setTimeout(() => setHlsAttempt((n) => n + 1), HLS_RETRY_MS);
        return;
      }
      setJpegWanted(true); // show the MJPEG picture meanwhile
      // next HLS try: in 60 s while the MJPEG picture works, every 10 s while nothing works
      const failedAt = Date.now();
      const tick = () => {
        if (jpegPlayingRef.current && Date.now() - failedAt < HLS_RETRY_ON_JPEG_MS) {
          retryTimer = window.setTimeout(tick, OFFLINE_RETRY_MS);
        } else {
          setHlsAttempt((n) => n + 1);
        }
      };
      retryTimer = window.setTimeout(tick, OFFLINE_RETRY_MS);
    };

    const playing = () => {
      if (finished) return;
      window.clearTimeout(startTimer);
      hlsFails.current = 0;
      setHlsPlaying(true);
      setJpegWanted(false); // HLS works: close the MJPEG connection (saves the Pi and data)
      setJpegPlaying(false);
      setJpegFailed(false);
      lastMove = Date.now();
      // a picture that stops moving without an error also counts as a failure
      window.clearInterval(frozenTimer);
      frozenTimer = window.setInterval(() => {
        if (document.hidden) {
          lastMove = Date.now();
          return;
        }
        if (video.currentTime !== lastTime) {
          lastTime = video.currentTime;
          lastMove = Date.now();
        } else if (Date.now() - lastMove > FROZEN_MS) {
          fail();
        }
      }, 3000);
    };

    const onVisibility = () => {
      if (!hls) return;
      if (document.hidden) hls.stopLoad(); // background tab: stop downloading
      else {
        hls.startLoad(-1);
        lastMove = Date.now();
      }
    };

    video.addEventListener('playing', playing);
    video.addEventListener('error', fail);
    document.addEventListener('visibilitychange', onVisibility);
    startTimer = window.setTimeout(fail, START_TIMEOUT_MS);

    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '';
    (async () => {
      // after 3 failures: one light request to see if the Pi's HLS is back before starting the player
      if (hlsFails.current >= HLS_FAILS_BEFORE_JPEG) {
        const probe = await fetch(hlsUrl, { cache: 'no-store' }).catch(() => null);
        if (finished) return;
        if (!probe || !probe.ok) {
          fail();
          return;
        }
      }
      const { default: Hls } = await import('hls.js');
      if (finished) return;
      if (Hls.isSupported()) {
        hls = new Hls({
          lowLatencyMode: true,
          liveSyncDuration: 1,
          liveMaxLatencyDuration: 5,
          maxLiveSyncPlaybackRate: 1.5, // catch up after a stall instead of drifting behind
          backBufferLength: 10,
          manifestLoadingMaxRetry: 1, // our own retry rules decide, not endless hls.js retries
          levelLoadingMaxRetry: 2,
          fragLoadingMaxRetry: 2,
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) fail();
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
        });
        hls.loadSource(hlsUrl);
        hls.attachMedia(video);
      } else if (nativeHls) {
        video.src = hlsUrl; // Safari / iPhone play HLS themselves
        video.play().catch(() => {});
      } else {
        // this browser can't play HLS at all: MJPEG only, no more HLS tries
        finished = true;
        window.clearTimeout(startTimer);
        hlsFails.current = HLS_FAILS_BEFORE_JPEG;
        setJpegWanted(true);
      }
    })().catch(fail);

    return () => {
      finished = true;
      window.clearTimeout(retryTimer);
      video.removeEventListener('playing', playing);
      video.removeEventListener('error', fail);
      document.removeEventListener('visibilitychange', onVisibility);
      stopPlayer();
    };
  }, [hlsUrl, hlsAttempt]);

  // ---------------------------------------------------------------- MJPEG fallback
  useEffect(() => {
    if (!jpegWanted || !url || blockedByBrowser) return;
    setJpegPlaying(false);
    // no picture in time = failed; then one new try every 10 s (no hammering the Pi)
    const timeout = window.setTimeout(() => setJpegFailed(true), START_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [jpegWanted, jpegAttempt, url, blockedByBrowser]);

  useEffect(() => {
    if (!jpegFailed || !jpegWanted) return;
    const timer = window.setTimeout(() => {
      setJpegFailed(false);
      setJpegAttempt((n) => n + 1);
    }, OFFLINE_RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [jpegFailed, jpegWanted]);

  // ---------------------------------------------------------------- state for the page
  const live = hlsPlaying || jpegPlaying;
  const state: CameraState = live
    ? 'live'
    : jpegWanted && jpegFailed && (!hlsUrl || hlsFails.current >= HLS_FAILS_BEFORE_JPEG)
      ? 'offline'
      : 'connecting';

  useEffect(() => {
    onStateChange?.(!url || blockedByBrowser ? 'not-set-up' : state);
  }, [state, url, blockedByBrowser, onStateChange]);

  const retry = useCallback(() => {
    hlsFails.current = 0;
    setJpegFailed(false);
    setHlsAttempt((n) => n + 1);
    setJpegAttempt((n) => n + 1);
  }, []);

  const fullscreen = () => {
    const box = containerRef.current;
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (box?.requestFullscreen) box.requestFullscreen().catch(() => {});
    else if (hlsPlaying && video?.webkitEnterFullscreen) video.webkitEnterFullscreen(); // iPhone
  };

  // The picture can't be right-clicked (save / copy address / open) or dragged out
  const noMenu = (e: React.SyntheticEvent) => e.preventDefault();

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
                live ? 'bg-red-600' : state === 'connecting' ? 'bg-yellow-600' : 'bg-gray-600'
              }`}
            >
              <span className={`h-2.5 w-2.5 rounded-full bg-white ${live ? 'animate-pulse' : ''}`} />
              {live ? 'LIVE' : state === 'connecting' ? 'CONNECTING' : 'OFFLINE'}
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
            {/* H.264 / HLS: invisible until it really plays (the MJPEG picture stays meanwhile) */}
            {hlsUrl && (
              <video
                ref={videoRef}
                muted
                autoPlay
                playsInline
                disablePictureInPicture
                onContextMenu={noMenu}
                className={`pointer-events-none absolute inset-0 h-full w-full object-contain ${
                  hlsPlaying ? '' : 'invisible'
                }`}
              />
            )}

            {/* MJPEG fallback, exactly as before */}
            {jpegWanted && !hlsPlaying && (
              <img
                key={jpegAttempt}
                src={withRetryParam(url, jpegAttempt)}
                alt="Live camera feed from the Raspberry Pi"
                onLoad={() => {
                  setJpegPlaying(true);
                  setJpegFailed(false);
                }}
                onError={() => {
                  setJpegPlaying(false);
                  setJpegFailed(true);
                }}
                onContextMenu={noMenu}
                onDragStart={noMenu}
                draggable={false}
                className={`pointer-events-none absolute inset-0 h-full w-full object-contain ${
                  jpegPlaying ? '' : 'invisible'
                }`}
              />
            )}

            {live && (
              <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 text-sm font-semibold text-white">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                Live · {hlsPlaying ? 'HLS' : 'JPEG'}
              </div>
            )}

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
                  Check that the Raspberry Pi is on and the camera program and Tailscale are running. Retrying every 10
                  seconds…
                </p>
                <p className="text-sm text-gray-300 sm:hidden">Retrying every 10 seconds…</p>
                <button
                  type="button"
                  onClick={retry}
                  className="rounded-xl bg-white px-5 py-2 text-lg text-gray-900 hover:bg-gray-200 sm:px-6 sm:py-3 sm:text-xl"
                >
                  Try Again Now
                </button>
              </div>
            )}

            {live && label && (
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
