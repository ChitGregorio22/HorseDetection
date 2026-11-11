import { useEffect, useState, type ChangeEvent } from 'react';
import { Save, Plus, Thermometer, Camera } from 'lucide-react';
import { PiStatusPanel, type useDeviceStatus } from './PiStatus';
import { addHorse, getDevices, saveCalibration, updateSettings, type Device, type Profile, type Settings as SettingsType } from '../lib/api';

interface SettingsProps {
  profile: Profile | null;
  settings: SettingsType;
  onSettingsSaved: () => void;
  onHorseAdded: () => void;
  deviceStatus: ReturnType<typeof useDeviceStatus>;
}

type Notice = { kind: 'ok' | 'error'; text: string } | null;

function NoticeBox({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <div className={`rounded-xl border-2 p-4 text-lg ${notice.kind === 'ok' ? 'border-green-300 bg-green-50 text-green-800' : 'border-red-300 bg-red-50 text-red-800'}`}>
      {notice.text}
    </div>
  );
}

export function Settings({ profile, settings, onSettingsSaved, onHorseAdded, deviceStatus }: SettingsProps) {
  const isAdmin = profile?.role === 'admin';
  const canAddHorse = profile?.role === 'admin' || profile?.role === 'caretaker';

  // Thresholds & monitoring
  const [form, setForm] = useState(settings);
  const [settingsNotice, setSettingsNotice] = useState<Notice>(null);
  useEffect(() => setForm(settings), [settings]);

  // Add horse
  const [horseName, setHorseName] = useState('');
  const [horseAge, setHorseAge] = useState('');
  const [horseTemp, setHorseTemp] = useState('');
  const [horseNotice, setHorseNotice] = useState<Notice>(null);

  // Calibration
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [offset, setOffset] = useState('0');
  const [calNotice, setCalNotice] = useState<Notice>(null);

  useEffect(() => {
    if (!isAdmin) return;
    getDevices()
      .then((list) => {
        setDevices(list);
        if (list[0]) { setDeviceId(list[0].id); setOffset(String(list[0].calibration_offset)); }
      })
      .catch((e) => setCalNotice({ kind: 'error', text: e.message }));
  }, [isAdmin]);

  const saveSettings = async () => {
    setSettingsNotice(null);
    const cameraUrl = form.camera_stream_url?.trim() ?? '';
    if (cameraUrl && !/^https?:\/\//i.test(cameraUrl)) {
      setSettingsNotice({ kind: 'error', text: 'The camera address must start with https:// (or http:// for testing on your own Wi-Fi).' });
      return;
    }
    if (form.warning_threshold >= form.fever_threshold) {
      setSettingsNotice({ kind: 'error', text: 'Warning threshold must be lower than the fever threshold.' });
      return;
    }
    try {
      await updateSettings(form);
      onSettingsSaved();
      setSettingsNotice({ kind: 'ok', text: 'Settings saved.' });
    } catch (e) {
      setSettingsNotice({ kind: 'error', text: (e as Error).message });
    }
  };

  const submitHorse = async () => {
    setHorseNotice(null);
    if (!horseName.trim()) {
      setHorseNotice({ kind: 'error', text: 'Enter a horse name.' });
      return;
    }
    try {
      const horse = await addHorse({
        name: horseName.trim(),
        age: horseAge ? Number(horseAge) : null,
        normal_temp: horseTemp ? Number(horseTemp) : 37.2,
      });
      setHorseName(''); setHorseAge(''); setHorseTemp('');
      onHorseAdded();
      setHorseNotice({ kind: 'ok', text: `${horse.name} added (ID ${horse.horse_code}).` });
    } catch (e) {
      setHorseNotice({ kind: 'error', text: (e as Error).message });
    }
  };

  const submitCalibration = async () => {
    setCalNotice(null);
    try {
      await saveCalibration(deviceId, Number(offset));
      setDevices(await getDevices());
      setCalNotice({ kind: 'ok', text: 'Calibration saved. New readings from this camera will be adjusted.' });
    } catch (e) {
      setCalNotice({ kind: 'error', text: (e as Error).message });
    }
  };

  const selectedDevice = devices.find((d) => d.id === deviceId);
  const numberInput = (key: keyof SettingsType) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: Number(e.target.value) });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-4xl mb-4">Settings</h1>

      <PiStatusPanel devices={deviceStatus.devices} error={deviceStatus.error} onRefresh={deviceStatus.refresh} />

      {!isAdmin && (
        <div className="rounded-xl border-2 border-blue-300 bg-blue-50 p-4 text-lg text-blue-900">
          You are signed in as <strong className="capitalize">{profile?.role ?? 'user'}</strong>. Only an admin can change thresholds and calibration.
        </div>
      )}

      {/* Threshold Settings */}
      <div className="bg-white border-2 border-gray-200 rounded-2xl p-6">
        <h2 className="text-2xl mb-6">Temperature Thresholds</h2>

        <div className="space-y-6">
          <div>
            <label className="text-xl block mb-2">Warning Threshold (°C)</label>
            <input
              type="number"
              value={form.warning_threshold}
              onChange={numberInput('warning_threshold')}
              step="0.1"
              disabled={!isAdmin}
              className="w-full md:w-64 px-4 py-3 text-2xl border-2 border-gray-300 rounded-lg focus:border-yellow-600 focus:outline-none disabled:bg-gray-100"
            />
            <p className="text-lg text-gray-600 mt-2">Temperature at which a warning is triggered</p>
          </div>

          <div>
            <label className="text-xl block mb-2">Fever Threshold (°C)</label>
            <input
              type="number"
              value={form.fever_threshold}
              onChange={numberInput('fever_threshold')}
              step="0.1"
              disabled={!isAdmin}
              className="w-full md:w-64 px-4 py-3 text-2xl border-2 border-gray-300 rounded-lg focus:border-red-600 focus:outline-none disabled:bg-gray-100"
            />
            <p className="text-lg text-gray-600 mt-2">Temperature at which a fever alert is triggered</p>
          </div>
        </div>
      </div>

      {/* Monitoring Settings */}
      <div className="bg-white border-2 border-gray-200 rounded-2xl p-6">
        <h2 className="text-2xl mb-6">Monitoring Settings</h2>

        <div className="space-y-6">
          <div>
            <label className="text-xl block mb-2">Check Interval (seconds)</label>
            <input
              type="number"
              value={form.check_interval_seconds}
              onChange={numberInput('check_interval_seconds')}
              min="1"
              max="60"
              disabled={!isAdmin}
              className="w-full md:w-64 px-4 py-3 text-2xl border-2 border-gray-300 rounded-lg focus:border-blue-600 focus:outline-none disabled:bg-gray-100"
            />
            <p className="text-lg text-gray-600 mt-2">How often the camera should send a temperature</p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="soundAlerts"
              checked={form.sound_alerts}
              onChange={(e) => setForm({ ...form, sound_alerts: e.target.checked })}
              disabled={!isAdmin}
              className="w-6 h-6"
            />
            <label htmlFor="soundAlerts" className="text-xl">Enable sound alerts</label>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="emailNotifications"
              checked={form.email_notifications}
              onChange={(e) => setForm({ ...form, email_notifications: e.target.checked })}
              disabled={!isAdmin}
              className="w-6 h-6"
            />
            <label htmlFor="emailNotifications" className="text-xl">Send email notifications</label>
          </div>
        </div>
      </div>

      {/* Live Camera */}
      <div className="bg-white border-2 border-gray-200 rounded-2xl p-6">
        <div className="mb-6 flex items-center gap-3">
          <Camera className="h-7 w-7 text-gray-700" />
          <h2 className="text-2xl">Live Camera</h2>
        </div>

        <div className="space-y-3">
          <label htmlFor="cameraUrl" className="text-xl block">Raspberry Pi stream address</label>
          <input
            id="cameraUrl"
            type="url"
            value={form.camera_stream_url ?? ''}
            onChange={(e) => setForm({ ...form, camera_stream_url: e.target.value })}
            placeholder="https://horse-cam.your-tailnet.ts.net/stream.mjpg?key=YOUR-KEY"
            disabled={!isAdmin}
            className="w-full px-4 py-3 text-lg font-mono border-2 border-gray-300 rounded-lg focus:border-blue-600 focus:outline-none disabled:bg-gray-100"
          />
          <p className="text-lg text-gray-600">
            Shown on the Dashboard for everyone. Copy the <strong>https://</strong> Tailscale Funnel address of the Raspberry Pi and add <span className="font-mono">/stream.mjpg?key=…</span> at the end. Leave empty to hide the camera.
          </p>
          {form.camera_stream_url?.startsWith('http://') && (
            <p className="rounded-lg border-2 border-yellow-400 bg-yellow-50 p-3 text-lg text-yellow-900">
              ⚠️ http:// addresses only work when testing on your own computer. On the Vercel website use the https://…ts.net Funnel address.
            </p>
          )}
        </div>
      </div>

      {/* Calibration */}
      {isAdmin && (
        <div className="bg-white border-2 border-gray-200 rounded-2xl p-6">
          <h2 className="text-2xl mb-6">Camera Calibration</h2>

          <div className="space-y-4">
            <p className="text-xl text-gray-600">
              Compare the camera with a rectal thermometer reading, then enter the difference. Example: thermometer 37.6°C, camera 37.2°C → offset +0.4.
            </p>

            {devices.length === 0 ? (
              <p className="text-xl">No cameras registered. Add one in Supabase → Table Editor → devices.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xl block mb-2">Camera</label>
                  <select
                    value={deviceId}
                    onChange={(e) => {
                      setDeviceId(e.target.value);
                      const d = devices.find((x) => x.id === e.target.value);
                      setOffset(String(d?.calibration_offset ?? 0));
                    }}
                    className="w-full px-4 py-3 text-xl border-2 border-gray-300 rounded-lg bg-white"
                  >
                    {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  {selectedDevice && (
                    <p className="text-lg text-gray-600 mt-2">
                      Last calibrated: {selectedDevice.last_calibrated_at ? new Date(selectedDevice.last_calibrated_at).toLocaleString('en-PH') : 'never'}
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-xl block mb-2">Offset (°C)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="-5"
                    max="5"
                    value={offset}
                    onChange={(e) => setOffset(e.target.value)}
                    className="w-full md:w-64 px-4 py-3 text-2xl border-2 border-gray-300 rounded-lg focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>
            )}

            <NoticeBox notice={calNotice} />

            {devices.length > 0 && (
              <button onClick={submitCalibration} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg text-xl hover:bg-blue-700">
                <Thermometer className="w-6 h-6" />
                Save Calibration
              </button>
            )}
          </div>
        </div>
      )}

      {/* Add Horse */}
      {canAddHorse && (
        <div className="bg-white border-2 border-gray-200 rounded-2xl p-6">
          <h2 className="text-2xl mb-6">Manage Horses</h2>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xl block mb-2">Horse Name</label>
                <input
                  type="text"
                  value={horseName}
                  onChange={(e) => setHorseName(e.target.value)}
                  placeholder="Enter name"
                  className="w-full px-4 py-3 text-xl border-2 border-gray-300 rounded-lg focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xl block mb-2">Age (years)</label>
                <input
                  type="number"
                  value={horseAge}
                  onChange={(e) => setHorseAge(e.target.value)}
                  placeholder="Enter age"
                  className="w-full px-4 py-3 text-xl border-2 border-gray-300 rounded-lg focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xl block mb-2">Normal Temperature (°C)</label>
                <input
                  type="number"
                  step="0.1"
                  value={horseTemp}
                  onChange={(e) => setHorseTemp(e.target.value)}
                  placeholder="e.g., 37.2"
                  className="w-full px-4 py-3 text-xl border-2 border-gray-300 rounded-lg focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <NoticeBox notice={horseNotice} />

            <button onClick={submitHorse} className="bg-green-600 text-white px-6 py-3 rounded-lg text-xl flex items-center gap-2 hover:bg-green-700">
              <Plus className="w-6 h-6" />
              Add Horse
            </button>
          </div>
        </div>
      )}

      {/* Save Button */}
      <NoticeBox notice={settingsNotice} />
      {isAdmin && (
        <button onClick={saveSettings} className="bg-blue-600 text-white px-8 py-4 rounded-xl text-2xl flex items-center gap-3 hover:bg-blue-700">
          <Save className="w-6 h-6" />
          Save All Settings
        </button>
      )}
    </div>
  );
}
