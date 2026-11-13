import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Loader2, RefreshCw, SwitchCamera, X } from 'lucide-react';
import { loadImageFile, preparePhoto, type PreparedPhoto } from '../lib/imageTools';

/**
 * Take a photo with THIS device's camera (phone back camera, laptop webcam).
 * Live preview → Take photo → Use this photo / Retake. If the browser can't open the camera
 * (no permission, no camera), it falls back to the phone's own camera app via a file input.
 */
export function DeviceCamera({
  title,
  busy,
  onPhoto,
  onClose,
}: {
  title: string;
  busy: boolean;
  onPhoto: (photo: PreparedPhoto) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [cameras, setCameras] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [shot, setShot] = useState<PreparedPhoto | null>(null);

  // open the camera (again after switching or retaking)
  useEffect(() => {
    if (shot) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    setReady(false);
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't open the camera here. Use the phone's camera app instead.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const v = videoRef.current;
        if (v) {
          v.srcObject = s;
          await v.play().catch(() => {});
        }
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        setCameras(devices.filter((d) => d.kind === 'videoinput').length);
      })
      .catch((e: DOMException) => {
        if (cancelled) return;
        setError(
          e?.name === 'NotAllowedError'
            ? 'The camera is blocked for this site. Allow the camera in the browser settings, or use the phone’s camera app.'
            : e?.name === 'NotFoundError'
              ? 'No camera found on this device. Use “Upload pictures” instead.'
              : "The camera couldn't be opened. Use the phone's camera app instead.",
        );
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop()); // camera light goes off
      const v = videoRef.current;
      if (v) v.srcObject = null;
    };
  }, [facing, shot]);

  const take = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    setShot(preparePhoto(v, v.videoWidth, v.videoHeight)); // the real picture, never mirrored
  };

  const fromCameraApp = async (file: File | undefined) => {
    if (!file) return;
    try {
      const img = await loadImageFile(file);
      setShot(preparePhoto(img, img.naturalWidth, img.naturalHeight));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Esc closes
  const onKey = useCallback((e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose(), [busy, onClose]);
  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  const btn = 'flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-2 text-lg font-semibold';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
          <h3 className="flex items-center gap-2 text-xl">
            <Camera className="h-6 w-6" /> {title}
          </h3>
          <button type="button" onClick={onClose} disabled={busy} className="rounded-lg p-2 hover:bg-gray-100" aria-label="Close">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="relative flex min-h-[14rem] items-center justify-center bg-black">
          {shot ? (
            <img src={shot.image} alt="Photo just taken" className="max-h-[60vh] w-full object-contain" />
          ) : error ? (
            <p className="px-6 py-10 text-center text-lg text-white">{error}</p>
          ) : (
            <>
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                onLoadedData={() => setReady(true)}
                // the selfie camera is shown like a mirror (as people expect); the saved photo isn't mirrored
                className={`max-h-[60vh] w-full object-contain ${facing === 'user' ? '-scale-x-100' : ''}`}
              />
              {!ready && <Loader2 className="absolute h-10 w-10 animate-spin text-white" />}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 p-4">
          {shot ? (
            <>
              <button type="button" disabled={busy} onClick={() => onPhoto(shot)} className={`${btn} bg-green-600 text-white hover:bg-green-700`}>
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />} Use this photo
              </button>
              <button type="button" disabled={busy} onClick={() => setShot(null)} className={`${btn} border-2 border-gray-300 bg-white text-gray-800`}>
                <RefreshCw className="h-5 w-5" /> Retake
              </button>
            </>
          ) : (
            <>
              {!error && (
                <button type="button" disabled={!ready} onClick={take} className={`${btn} bg-green-600 text-white hover:bg-green-700 disabled:opacity-50`}>
                  <Camera className="h-5 w-5" /> Take photo
                </button>
              )}
              {!error && cameras > 1 && (
                <button
                  type="button"
                  onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
                  className={`${btn} border-2 border-gray-300 bg-white text-gray-800`}
                >
                  <SwitchCamera className="h-5 w-5" /> Switch camera
                </button>
              )}
              {/* phones: the phone's own camera app (also the fallback when the camera can't be opened here) */}
              <button type="button" onClick={() => fileRef.current?.click()} className={`${btn} border-2 border-gray-300 bg-white text-gray-800`}>
                Phone camera app
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  fromCameraApp(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
