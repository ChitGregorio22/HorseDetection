import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Home, History, Bell, Users, ScanFace, Settings as SettingsIcon, LogOut } from "lucide-react";
import { Dashboard } from "./components/Dashboard";
import { History as HistoryView } from "./components/History";
import { Alerts } from "./components/Alerts";
import { Horses } from "./components/Horses";
import { Register } from "./components/Register";
import { Settings } from "./components/Settings";
import { Login } from "./components/Login";
import { PiStatusBadge, useDeviceStatus } from "./components/PiStatus";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import {
  DEFAULT_SETTINGS,
  getHorseRecords,
  getMyProfile,
  getSettings,
  subscribeToChanges,
  type HorseRecord,
  type Profile,
  type Settings as SettingsType,
} from "./lib/api";

export type { HorseRecord } from "./lib/api";

type View = "dashboard" | "history" | "alerts" | "horses" | "register" | "settings";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [currentView, setCurrentView] = useState<View>("dashboard");
  const [horses, setHorses] = useState<HorseRecord[]>([]);
  const [selectedHorseId, setSelectedHorseId] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS);
  const [loadError, setLoadError] = useState("");
  const deviceStatus = useDeviceStatus(Boolean(session));

  const selectedHorse = horses.find((horse) => horse.id === selectedHorseId) ?? null;

  // ---- Login session ----
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => data.subscription.unsubscribe();
  }, []);

  // ---- Horses and settings from the database ----
  const refreshHorses = useCallback(async () => {
    try {
      const list = await getHorseRecords();
      setHorses(list);
      setSelectedHorseId((current) =>
        current && list.some((horse) => horse.id === current) ? current : list[0]?.id ?? null,
      );
      setLoadError("");
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      setSettings(await getSettings());
    } catch (error) {
      setLoadError((error as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    getMyProfile().then(setProfile).catch(() => setProfile(null));
    refreshHorses();
    refreshSettings();
    // New readings, alerts or horses → refresh the list instantly (real-time)
    return subscribeToChanges("app", ["temperature_readings", "alerts", "horses"], () => refreshHorses());
  }, [session, refreshHorses, refreshSettings]);

  const handleRegisteredHorse = async (horse: HorseRecord) => {
    await refreshHorses();
    setSelectedHorseId(horse.id);
  };

  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="max-w-xl rounded-2xl border-2 border-yellow-500 bg-yellow-50 p-8">
          <h1 className="text-3xl">🐎 Database not connected yet</h1>
          <p className="mt-4 text-xl text-gray-700">
            Add <code className="font-mono">VITE_SUPABASE_URL</code> and{" "}
            <code className="font-mono">VITE_SUPABASE_ANON_KEY</code> in Vercel → Settings → Environment Variables,
            then redeploy.
          </p>
        </div>
      </div>
    );
  }

  if (!authReady) {
    return <div className="flex min-h-screen items-center justify-center text-2xl text-gray-600">Loading…</div>;
  }
  if (!session) return <Login />;

  const navigationItems = [
    { id: "dashboard" as View, label: "Dashboard", icon: Home },
    { id: "history" as View, label: "History", icon: History },
    { id: "alerts" as View, label: "Alerts", icon: Bell },
    { id: "horses" as View, label: "Horses", icon: Users },
    { id: "register" as View, label: "Register", icon: ScanFace },
    { id: "settings" as View, label: "Settings", icon: SettingsIcon },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-green-600 text-white px-6 py-6 border-b-4 border-green-700">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-4xl">🐎 Horse Thermal Monitor</h1>
            <p className="text-xl mt-1">Real-Time Temperature Monitoring System</p>
            <div className="mt-3">
              <PiStatusBadge devices={deviceStatus.devices} onClick={() => setCurrentView("settings")} />
            </div>
          </div>
          <div className="flex items-center gap-6 text-right">
            <div>
              <div className="text-2xl">{selectedHorse?.name ?? "No horse registered"}</div>
              <div className="text-lg opacity-90">
                {selectedHorse ? "Currently Monitoring" : "Open Register to begin"}
              </div>
            </div>
            <div className="border-l-2 border-green-400 pl-6">
              <div className="text-lg">{profile?.full_name || session.user.email}</div>
              <div className="text-base capitalize opacity-90">{profile?.role ?? ""}</div>
              <button
                type="button"
                onClick={() => supabase.auth.signOut()}
                className="mt-1 inline-flex items-center gap-1 text-base underline underline-offset-4"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b-2 border-gray-200">
        <div className="flex gap-2 p-4 overflow-x-auto">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;

            return (
              <button
                key={item.id}
                onClick={() => setCurrentView(item.id)}
                className={`flex items-center gap-2 px-6 py-3 rounded-lg text-xl whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      {loadError && (
        <div className="mx-6 mt-4 rounded-xl border-2 border-red-300 bg-red-50 p-4 text-lg text-red-800">
          Could not load data from the database: {loadError}
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto">
        {currentView === "dashboard" && (
          <Dashboard horse={selectedHorse} settings={settings} onRegister={() => setCurrentView("register")} />
        )}
        {currentView === "history" && <HistoryView horse={selectedHorse} settings={settings} />}
        {currentView === "alerts" && <Alerts selectedHorse={selectedHorse?.name ?? ""} settings={settings} />}
        {currentView === "horses" && (
          <Horses
            horses={horses}
            selectedHorseId={selectedHorseId}
            settings={settings}
            onSelectHorse={setSelectedHorseId}
            onRegister={() => setCurrentView("register")}
          />
        )}
        {currentView === "register" && (
          <Register
            onRegistered={handleRegisteredHorse}
            onViewDashboard={() => setCurrentView("dashboard")}
          />
        )}
        {currentView === "settings" && (
          <Settings
            profile={profile}
            settings={settings}
            onSettingsSaved={refreshSettings}
            onHorseAdded={refreshHorses}
            deviceStatus={deviceStatus}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t-2 border-gray-200 mt-12 py-6 text-center text-gray-600">
        <p className="text-lg">
          Thermal Scanning Temperature Monitoring System for Horses
        </p>
        <p className="text-sm mt-1">
          Designed for simple, fast, and non-technical interfaces
        </p>
      </footer>
    </div>
  );
}
