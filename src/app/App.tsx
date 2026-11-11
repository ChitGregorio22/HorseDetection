import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Home, History, Bell, Users, ScanFace, Settings as SettingsIcon, LogOut, UserCog, Clock } from "lucide-react";
import { Dashboard } from "./components/Dashboard";
import { History as HistoryView } from "./components/History";
import { Alerts } from "./components/Alerts";
import { Horses } from "./components/Horses";
import { Register } from "./components/Register";
import { Settings } from "./components/Settings";
import { Login } from "./components/Login";
import { PiStatusBadge, useDeviceStatus } from "./components/PiStatus";
import { Users as UsersView } from "./components/Users";
import { FeverAlarm } from "./components/FeverAlarm";
import { useLiveView } from "./components/useLiveView";
import { permissionsFor, ROLE_LABELS } from "./lib/permissions";
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

type View = "dashboard" | "history" | "alerts" | "horses" | "register" | "settings" | "users";

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [currentView, setCurrentView] = useState<View>("dashboard");
  const [horses, setHorses] = useState<HorseRecord[]>([]);
  const [selectedHorseId, setSelectedHorseId] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsType>(DEFAULT_SETTINGS);
  const [loadError, setLoadError] = useState("");
  const can = permissionsFor(profile);
  const approved = Boolean(profile?.approved);
  const deviceStatus = useDeviceStatus(Boolean(session) && approved);
  const live = useLiveView(Boolean(session) && approved);
  const [followCamera, setFollowCamera] = useState(() => {
    try {
      return localStorage.getItem("followCamera") !== "off";
    } catch {
      return true;
    }
  });

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

  // Who is signed in (role + approval). Re-check when a different user signs in.
  const userId = session?.user.id;
  useEffect(() => {
    setProfile(null);
    setProfileLoaded(false);
    setCurrentView("dashboard");
    if (!userId) return;
    getMyProfile()
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setProfileLoaded(true));
  }, [userId]);

  useEffect(() => {
    if (!session || !approved) return;
    refreshHorses();
    refreshSettings();
    // New readings, alerts or horses → refresh the list instantly (real-time)
    return subscribeToChanges("app", ["temperature_readings", "alerts", "horses"], () => refreshHorses());
  }, [session, approved, refreshHorses, refreshSettings]);

  // ---- Follow the camera: when the Pi identifies a horse, the Dashboard switches to it.
  //      Picking another horse by hand sticks until the camera sees a different horse (or this one again).
  const liveCode = live.main?.status === "identified" ? live.main.horse_code : null;
  const followed = useRef<string | null>(null);
  useEffect(() => {
    if (!liveCode) {
      followed.current = null;
      return;
    }
    if (!followCamera || liveCode === followed.current) return;
    const match = horses.find((horse) => horse.horseCode === liveCode);
    if (match) {
      setSelectedHorseId(match.id);
      followed.current = liveCode;
    }
  }, [liveCode, horses, followCamera]);

  // No live view from the Pi? Follow it through its readings instead: a NEW Pi reading (sent in the last
  // 3 minutes) switches the Dashboard to that horse.
  const piReading = live.lastPiReading;
  const seenReading = useRef<number | null>(null);
  useEffect(() => {
    if (!piReading || piReading.id === seenReading.current) return;
    const isFirst = seenReading.current === null;
    seenReading.current = piReading.id;
    if (!isFirst) refreshHorses(); // a new Pi reading: update the horse cards even if realtime is down
    const recent = Date.now() - new Date(piReading.recorded_at).getTime() < 180000;
    if (followCamera && !live.fresh && recent && horses.some((h) => h.id === piReading.horse_id)) {
      setSelectedHorseId(piReading.horse_id);
    }
  }, [piReading, followCamera, live.fresh, horses, refreshHorses]);

  const changeFollowCamera = useCallback((on: boolean) => {
    setFollowCamera(on);
    followed.current = null;
    try {
      localStorage.setItem("followCamera", on ? "on" : "off");
    } catch {
      /* private window: just not remembered */
    }
  }, []);

  const handleRegisteredHorse = useCallback(
    async (horse: { id: string }) => {
      await refreshHorses();
      setSelectedHorseId(horse.id);
    },
    [refreshHorses],
  );

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
  if (!profileLoaded) {
    return <div className="flex min-h-screen items-center justify-center text-2xl text-gray-600">Loading…</div>;
  }
  if (!approved) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="max-w-xl rounded-2xl border-2 border-yellow-500 bg-yellow-50 p-8 text-center">
          <Clock className="mx-auto h-14 w-14 text-yellow-700" />
          <h1 className="mt-4 text-3xl">Waiting for approval</h1>
          <p className="mt-4 text-xl text-gray-700">
            Your account <strong>{session.user.email}</strong>
            {profile ? <> (signed up as <strong>{ROLE_LABELS[profile.role]}</strong>)</> : null} was created. An admin
            needs to approve it before you can see the horses.
          </p>
          <p className="mt-3 text-lg text-gray-600">Ask your admin to open <strong>Users</strong> on this website.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setProfileLoaded(false);
                getMyProfile().then(setProfile).finally(() => setProfileLoaded(true));
              }}
              className="rounded-xl bg-green-600 px-6 py-3 text-xl text-white hover:bg-green-700"
            >
              Check again
            </button>
            <button
              type="button"
              onClick={() => supabase.auth.signOut()}
              className="flex items-center gap-2 rounded-xl border-2 border-gray-300 bg-white px-6 py-3 text-xl hover:bg-gray-100"
            >
              <LogOut className="h-5 w-5" /> Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const navigationItems = [
    { id: "dashboard" as View, label: "Dashboard", icon: Home },
    { id: "history" as View, label: "History", icon: History },
    { id: "alerts" as View, label: "Alerts", icon: Bell },
    { id: "horses" as View, label: "Horses", icon: Users },
    ...(can.registerHorses ? [{ id: "register" as View, label: "Register", icon: ScanFace }] : []),
    { id: "settings" as View, label: "Settings", icon: SettingsIcon },
    ...(can.manageUsers ? [{ id: "users" as View, label: "Users", icon: UserCog }] : []),
  ];
  // If the role doesn't allow the current page, fall back to the Dashboard
  const view: View = navigationItems.some((item) => item.id === currentView) ? currentView : "dashboard";

  return (
    <div className="min-h-screen bg-gray-50">
      <FeverAlarm
        enabled={approved}
        soundOn={settings.sound_alerts}
        horses={horses}
        onOpenAlerts={() => setCurrentView("alerts")}
      />

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
                {!selectedHorse
                  ? "Open Register to begin"
                  : liveCode && liveCode === selectedHorse.horseCode
                    ? "📷 In the stall now"
                    : "Currently Monitoring"}
              </div>
            </div>
            <div className="border-l-2 border-green-400 pl-6">
              <div className="text-lg">{profile?.full_name || session.user.email}</div>
              <div className="text-base opacity-90">{profile ? ROLE_LABELS[profile.role] : ""}</div>
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
            const isActive = view === item.id;

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
        {view === "dashboard" && (
          <Dashboard
            horse={selectedHorse}
            horses={horses}
            settings={settings}
            devices={deviceStatus.devices}
            live={live}
            followCamera={followCamera}
            onFollowCameraChange={changeFollowCamera}
            onSelectHorse={setSelectedHorseId}
            onRegister={can.registerHorses ? () => setCurrentView("register") : undefined}
          />
        )}
        {view === "history" && <HistoryView horse={selectedHorse} settings={settings} />}
        {view === "alerts" && (
          <Alerts selectedHorse={selectedHorse?.name ?? ""} settings={settings} canHandle={can.handleAlerts} />
        )}
        {view === "horses" && (
          <Horses
            horses={horses}
            selectedHorseId={selectedHorseId}
            settings={settings}
            can={can}
            onSelectHorse={setSelectedHorseId}
            onRegister={can.registerHorses ? () => setCurrentView("register") : undefined}
            onChanged={refreshHorses}
          />
        )}
        {view === "register" && (
          <Register
            settings={settings}
            devices={deviceStatus.devices}
            onRegistered={handleRegisteredHorse}
            onViewDashboard={() => setCurrentView("dashboard")}
          />
        )}
        {view === "settings" && (
          <Settings
            profile={profile}
            can={can}
            settings={settings}
            onSettingsSaved={refreshSettings}
            onHorseAdded={refreshHorses}
            deviceStatus={deviceStatus}
          />
        )}
        {view === "users" && session && <UsersView myId={session.user.id} />}
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
