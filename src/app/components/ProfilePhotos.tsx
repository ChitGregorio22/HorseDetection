import { useCallback, useEffect, useRef, useState } from 'react';
import { NoPhoto } from './Brand';
import { Camera, Check, Images, Loader2, Trash2, Upload, Video, X } from 'lucide-react';
import {
  addHorsePhoto,
  cancelPhotoRequest,
  deleteHorsePhoto,
  MAX_WEBSITE_PHOTOS,
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
import { DeviceCamera } from './DeviceCamera';
import { loadImageFile, preparePhoto, type PreparedPhoto } from '../lib/imageTools';

const SOURCE_LABEL: Record<HorsePhoto['source'], string> = {
  registration: 'From registration',
  website: 'Stall camera',
  pi_key: 'Taken at the Pi (p key)',
  upload: 'Uploaded',
  device: 'Phone / computer camera',
};
const isWebsitePhoto = (p: HorsePhoto) => p.source === 'upload' || p.source === 'device';

/**
 * Horse profile photo: the whole picture, uncropped. Owners/admins can:
 *  - Take profile photo: with THIS device's camera (phone / laptop), becomes the profile photo
 *  - Upload pictures: from the phone / computer
 *    (photos added on the website: max 3 per horse; the Pi's photos don't count)
 *  - Change photo: pick any saved picture, or delete one
 *  - Use the stall camera: ask the Pi for a picture (as before)
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
  const [mode, setMode] = useState<'none' | 'choose' | 'take' | 'device'>('none');
  const [uploading, setUploading] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
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

  const websiteCount = (photos ?? []).filter(isWebsitePhoto).length;
  const slotsLeft = Math.max(0, MAX_WEBSITE_PHOTOS - websiteCount);

  const afterAdding = async (text: string) => {
    setNotice(text);
    await load();
    await onChanged(); // card thumbnail
  };

  // photo from this device's camera → the new profile photo
  const savePhotoFromDevice = async (photo: PreparedPhoto) => {
    setBusy(true);
    setError('');
    try {
      const id = await addHorsePhoto(horseId, photo, 'device', true);
      setProfileId(id);
      setMode('none');
      await afterAdding(`New profile photo of ${horseName} saved.`);
    } catch (e) {
      setError((e as Error).message);
      setMode('none');
    } finally {
      setBusy(false);
    }
  };

  // pictures from the phone / computer (as many as there are free slots)
  const upload = async (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (!files.length) return;
    setError('');
    setNotice('');
    const take = files.slice(0, slotsLeft);
    let saved = 0;
    setBusy(true);
    try {
      for (const [i, file] of take.entries()) {
        setUploading(`Uploading ${i + 1} of ${take.length}…`);
        const img = await loadImageFile(file);
        await addHorsePhoto(horseId, preparePhoto(img, img.naturalWidth, img.naturalHeight), 'upload', false);
        saved++;
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading('');
      setBusy(false);
    }
    const skipped = files.length - take.length;
    if (saved) {
      await afterAdding(
        `${saved} photo${saved === 1 ? '' : 's'} uploaded.` +
          (skipped ? ` ${skipped} not uploaded: a horse can have ${MAX_WEBSITE_PHOTOS} photos added on the website.` : '') +
          (saved && profileId != null ? ' Use “Change photo” to make one the profile photo.' : ''),
      );
    } else if (skipped) {
      setError(`This horse already has ${MAX_WEBSITE_PHOTOS} photos added on the website. Delete one under “Change photo” first.`);
    }
  };

  const remove = async (p: HorsePhoto) => {
    if (!window.confirm(`Delete this photo of ${horseName}?${p.id === profileId ? ' It is the profile photo: another photo takes its place.' : ''}`)) return;
    setBusy(true);
    setError('');
    try {
      await deleteHorsePhoto(p.id);
      await afterAdding('Photo deleted.');
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
          <NoPhoto className="h-72 w-full" />
        )}
      </div>

      {canManage && (
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy || slotsLeft === 0}
            title={slotsLeft === 0 ? `${MAX_WEBSITE_PHOTOS} photos added already: delete one under Change photo` : undefined}
            onClick={() => setMode('device')}
            className={`${button} bg-green-600 text-white hover:bg-green-700 disabled:opacity-50`}
          >
            <Camera className="h-5 w-5" /> Take profile photo
          </button>
          <button
            type="button"
            disabled={busy || slotsLeft === 0}
            onClick={() => fileRef.current?.click()}
            className={`${button} border-2 border-green-600 bg-white text-green-700 hover:bg-green-50 disabled:opacity-50`}
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            {uploading || `Upload pictures (${websiteCount}/${MAX_WEBSITE_PHOTOS})`}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              upload(e.target.files);
              e.target.value = '';
            }}
          />
          {installed && (photos?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => setMode(mode === 'choose' ? 'none' : 'choose')}
              className={`${button} border-2 border-gray-300 bg-white text-gray-800 hover:bg-gray-100`}
            >
              <Images className="h-5 w-5" /> Change photo ({photos?.length})
            </button>
          )}
          {cameraUrl && (
            <button
              type="button"
              onClick={() => setMode(mode === 'take' ? 'none' : 'take')}
              className={`${button} border-2 border-gray-300 bg-white text-gray-800 hover:bg-gray-100`}
            >
              <Video className="h-5 w-5" /> Use the stall camera
            </button>
          )}
        </div>
      )}
      {canManage && slotsLeft === 0 && (
        <p className="mt-2 text-base text-gray-600">
          {horseName} has {MAX_WEBSITE_PHOTOS} photos added on the website (the most). Delete one under “Change photo” to add another.
        </p>
      )}

      {mode === 'device' && (
        <DeviceCamera
          title={`Profile photo of ${horseName}`}
          busy={busy}
          onPhoto={savePhotoFromDevice}
          onClose={() => setMode('none')}
        />
      )}

      {notice && <p className="mt-3 rounded-lg bg-green-50 px-4 py-2 text-lg text-green-800">{notice}</p>}
      {error && <p className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-lg text-red-700">{error}</p>}
      {!installed && canManage && (
        <p className="mt-3 text-base text-gray-600">
          Saved photo choices and adding photos on the website need the database updates 10_profile_photos.sql and
          11_photo_uploads.sql.
        </p>
      )}

      {mode === 'choose' && photos && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p) => (
            <div
              key={p.id}
              className={`relative overflow-hidden rounded-xl border-4 bg-black ${
                p.id === profileId ? 'border-green-600' : 'border-transparent hover:border-green-300'
              }`}
            >
              <button type="button" disabled={busy} onClick={() => choose(p.id)} className="block w-full text-left" title="Make this the profile photo">
                {p.thumb ? (
                  <img src={p.thumb} alt="" className="aspect-video w-full object-contain" />
                ) : (
                  <div className="aspect-video" />
                )}
                <div className="flex items-center justify-between gap-1 bg-white px-2 py-1 text-sm text-gray-700">
                  <span className="truncate">{SOURCE_LABEL[p.source] ?? p.source}</span>
                  {p.id === profileId && <Check className="h-4 w-4 shrink-0 text-green-700" />}
                </div>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => remove(p)}
                title="Delete this photo"
                aria-label="Delete this photo"
                className="absolute right-1.5 top-1.5 rounded-lg bg-white/90 p-1.5 text-red-600 shadow hover:bg-white"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
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
