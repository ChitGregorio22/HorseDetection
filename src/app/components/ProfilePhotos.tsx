import { useCallback, useEffect, useState } from 'react';
import { Camera, Check, Images, Loader2, X } from 'lucide-react';
import {
  cancelPhotoRequest,
  getHorsePhotoImage,
  getHorsePhotos,
  getPhotoRequest,
  requestProfilePhoto,
  setProfilePhoto,
  subscribeToChanges,
  type HorsePhoto,
  type PhotoRequest,
} from '../lib/api';
import { LiveCamera } from './LiveCamera';

const SOURCE_LABEL: Record<HorsePhoto['source'], string> = {
  registration: 'From registration',
  website: 'Taken from the website',
  pi_key: 'Taken at the Pi (p key)',
};

/**
 * Horse profile photo: the whole camera picture, uncropped. Owners/admins can pick another saved
 * picture ("Change photo") or ask the Pi for a new one while watching the live camera ("Take profile photo").
 */
export function ProfilePhotos({
  horseId,
  horseName,
  fallback,
  canManage,
  cameraUrl,
  onChanged,
}: {
  horseId: string;
  horseName: string;
  /** small card photo, shown until the big one loads (or before 10_profile_photos.sql) */
  fallback: string;
  canManage: boolean;
  cameraUrl: string | null | undefined;
  onChanged: () => Promise<void> | void;
}) {
  const [photos, setPhotos] = useState<HorsePhoto[] | undefined>(undefined);
  const [installed, setInstalled] = useState(true);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [big, setBig] = useState<string | null>(null);
  const [mode, setMode] = useState<'none' | 'choose' | 'take'>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [request, setRequest] = useState<PhotoRequest | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await getHorsePhotos(horseId);
      if (!r) {
        setInstalled(false);
        setPhotos([]);
        return;
      }
      setInstalled(true);
      setPhotos(r.photos);
      setProfileId(r.profileId);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [horseId]);

  useEffect(() => {
    setPhotos(undefined);
    setBig(null);
    setMode('none');
    setRequest(null);
    setNotice('');
    setError('');
    load();
  }, [load]);

  // full-size profile picture
  useEffect(() => {
    let cancelled = false;
    setBig(null);
    if (profileId != null) getHorsePhotoImage(profileId).then((img) => !cancelled && setBig(img));
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  // "Take profile photo": follow the request until the Pi answers
  const active = request && (request.status === 'pending' || request.status === 'running');
  useEffect(() => {
    if (!request || !active) return;
    const check = async () => {
      const r = await getPhotoRequest(request.id);
      if (!r) return;
      setRequest(r);
      if (r.status === 'done') {
        setNotice(`New profile photo of ${horseName} saved.`);
        setMode('none');
        await load();
        await onChanged();
      }
    };
    const timer = window.setInterval(check, 1500);
    const unsubscribe = subscribeToChanges('photo-request', ['photo_requests'], (_t, row) => {
      if (Number(row.id) === request.id) check();
    });
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [request?.id, active, horseName, load, onChanged]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = async (id: number) => {
    setBusy(true);
    setError('');
    try {
      await setProfilePhoto(horseId, id);
      setProfileId(id);
      setMode('none');
      setNotice('Profile photo changed.');
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const take = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setRequest(await requestProfilePhoto(horseId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const shown = big ?? fallback;
  const button = 'flex min-h-12 items-center gap-2 rounded-xl px-5 py-2 text-lg font-semibold';

  return (
    <div className="mb-8">
      <div className="flex items-center justify-center overflow-hidden rounded-2xl border-2 border-gray-200 bg-black">
        {shown ? (
          <img src={shown} alt={`Profile photo of ${horseName}`} className="max-h-[520px] w-full object-contain" />
        ) : (
          <div className="py-24 text-7xl">🐎</div>
        )}
      </div>

      {canManage && (
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setMode(mode === 'take' ? 'none' : 'take')}
            className={`${button} bg-green-600 text-white hover:bg-green-700`}
          >
            <Camera className="h-5 w-5" /> Take profile photo
          </button>
          {installed && (photos?.length ?? 0) > 1 && (
            <button
              type="button"
              onClick={() => setMode(mode === 'choose' ? 'none' : 'choose')}
              className={`${button} border-2 border-gray-300 bg-white text-gray-800 hover:bg-gray-100`}
            >
              <Images className="h-5 w-5" /> Change photo ({photos?.length})
            </button>
          )}
        </div>
      )}

      {notice && <p className="mt-3 rounded-lg bg-green-50 px-4 py-2 text-lg text-green-800">{notice}</p>}
      {error && <p className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-lg text-red-700">{error}</p>}
      {!installed && canManage && (
        <p className="mt-3 text-base text-gray-600">
          Saved photo choices and taking photos from the website need the database update 10_profile_photos.sql.
        </p>
      )}

      {mode === 'choose' && photos && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={busy}
              onClick={() => choose(p.id)}
              className={`overflow-hidden rounded-xl border-4 bg-black text-left ${
                p.id === profileId ? 'border-green-600' : 'border-transparent hover:border-green-300'
              }`}
            >
              {p.thumb ? (
                <img src={p.thumb} alt="" className="aspect-video w-full object-contain" />
              ) : (
                <div className="aspect-video" />
              )}
              <div className="flex items-center justify-between bg-white px-2 py-1 text-sm text-gray-700">
                <span>{SOURCE_LABEL[p.source] ?? p.source}</span>
                {p.id === profileId && <Check className="h-4 w-4 text-green-700" />}
              </div>
            </button>
          ))}
        </div>
      )}

      {mode === 'take' && (
        <div className="mt-4 rounded-2xl border-2 border-green-200 bg-green-50 p-4">
          <p className="mb-3 text-lg text-gray-800">
            Watch the camera. When <strong>{horseName}</strong> faces the camera, press <strong>Take photo now</strong>. The Pi
            takes it only if {horseName} is the confirmed horse in the stall.
          </p>
          <LiveCamera url={cameraUrl ?? null} label={`Profile photo: ${horseName}`} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {active ? (
              <>
                <span className="flex items-center gap-2 text-lg text-gray-700">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {request?.status === 'running' ? 'The Pi is taking the photo…' : 'Waiting for the Pi…'}
                </span>
                <button
                  type="button"
                  onClick={() => request && cancelPhotoRequest(request.id).then(() => setRequest(null))}
                  className={`${button} border-2 border-gray-300 bg-white text-gray-800`}
                >
                  <X className="h-5 w-5" /> Cancel
                </button>
              </>
            ) : (
              <button type="button" disabled={busy} onClick={take} className={`${button} bg-green-600 text-white hover:bg-green-700`}>
                <Camera className="h-5 w-5" /> Take photo now
              </button>
            )}
          </div>
          {request?.status === 'failed' && (
            <p className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-lg text-red-700">
              Not taken: {request.message ?? 'the Pi could not take the photo.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
