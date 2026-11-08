import { Save, Plus } from 'lucide-react';

export function Settings() {
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-4xl mb-4">Settings</h1>

      {/* Threshold Settings */}
      <div className="bg-white border-2 border-gray-200 rounded-2xl p-6">
        <h2 className="text-2xl mb-6">Temperature Thresholds</h2>

        <div className="space-y-6">
          <div>
            <label className="text-xl block mb-2">Warning Threshold (°C)</label>
            <input
              type="number"
              defaultValue="37.5"
              step="0.1"
              className="w-full md:w-64 px-4 py-3 text-2xl border-2 border-gray-300 rounded-lg focus:border-yellow-600 focus:outline-none"
            />
            <p className="text-lg text-gray-600 mt-2">Temperature at which a warning is triggered</p>
          </div>

          <div>
            <label className="text-xl block mb-2">Fever Threshold (°C)</label>
            <input
              type="number"
              defaultValue="38.0"
              step="0.1"
              className="w-full md:w-64 px-4 py-3 text-2xl border-2 border-gray-300 rounded-lg focus:border-red-600 focus:outline-none"
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
              defaultValue="3"
              min="1"
              max="60"
              className="w-full md:w-64 px-4 py-3 text-2xl border-2 border-gray-300 rounded-lg focus:border-blue-600 focus:outline-none"
            />
            <p className="text-lg text-gray-600 mt-2">How often to check temperature</p>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="soundAlerts"
              defaultChecked
              className="w-6 h-6"
            />
            <label htmlFor="soundAlerts" className="text-xl">Enable sound alerts</label>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="emailNotifications"
              defaultChecked
              className="w-6 h-6"
            />
            <label htmlFor="emailNotifications" className="text-xl">Send email notifications</label>
          </div>
        </div>
      </div>

      {/* Calibration */}
      <div className="bg-white border-2 border-gray-200 rounded-2xl p-6">
        <h2 className="text-2xl mb-6">Camera Calibration</h2>

        <div className="space-y-4">
          <p className="text-xl text-gray-600">
            Calibrate the thermal camera to ensure accurate readings.
          </p>

          <button className="bg-blue-600 text-white px-6 py-3 rounded-lg text-xl hover:bg-blue-700">
            Run Calibration
          </button>
        </div>
      </div>

      {/* Add Horse */}
      <div className="bg-white border-2 border-gray-200 rounded-2xl p-6">
        <h2 className="text-2xl mb-6">Manage Horses</h2>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xl block mb-2">Horse Name</label>
              <input
                type="text"
                placeholder="Enter name"
                className="w-full px-4 py-3 text-xl border-2 border-gray-300 rounded-lg focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xl block mb-2">Age (years)</label>
              <input
                type="number"
                placeholder="Enter age"
                className="w-full px-4 py-3 text-xl border-2 border-gray-300 rounded-lg focus:border-blue-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xl block mb-2">Normal Temperature (°C)</label>
              <input
                type="number"
                step="0.1"
                placeholder="e.g., 37.2"
                className="w-full px-4 py-3 text-xl border-2 border-gray-300 rounded-lg focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          <button className="bg-green-600 text-white px-6 py-3 rounded-lg text-xl flex items-center gap-2 hover:bg-green-700">
            <Plus className="w-6 h-6" />
            Add Horse
          </button>
        </div>
      </div>

      {/* Save Button */}
      <button className="bg-blue-600 text-white px-8 py-4 rounded-xl text-2xl flex items-center gap-3 hover:bg-blue-700">
        <Save className="w-6 h-6" />
        Save All Settings
      </button>
    </div>
  );
}
