import { useEffect, useState } from "react";
import { Home, History, Bell, Users, ScanFace, Settings as SettingsIcon } from "lucide-react";
import { Dashboard } from "./components/Dashboard";
import { History as HistoryView } from "./components/History";
import { Alerts } from "./components/Alerts";
import { Horses } from "./components/Horses";
import { Register } from "./components/Register";
import { Settings } from "./components/Settings";

type View = "dashboard" | "history" | "alerts" | "horses" | "register" | "settings";

export interface HorseRecord {
  id: string;
  name: string;
  age: number;
  normalTemperature: number;
  currentTemperature: number;
  registeredAt: string;
  lastUpdated: string;
  photo: string;
}

const HORSES_STORAGE_KEY = "farmRegisteredHorsesV2";
const TEMPERATURE_UPDATE_INTERVAL = 3 * 60 * 1000;

export default function App() {
  const [currentView, setCurrentView] = useState<View>("dashboard");
  const [horses, setHorses] = useState<HorseRecord[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HORSES_STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [selectedHorseId, setSelectedHorseId] = useState<string | null>(() => {
    try {
      const saved: HorseRecord[] = JSON.parse(localStorage.getItem(HORSES_STORAGE_KEY) || "[]");
      return saved[0]?.id ?? null;
    } catch {
      return null;
    }
  });

  const selectedHorse = horses.find((horse) => horse.id === selectedHorseId) ?? null;

  useEffect(() => {
    localStorage.setItem(HORSES_STORAGE_KEY, JSON.stringify(horses));
  }, [horses]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const updatedAt = new Date().toISOString();
      setHorses((currentHorses) =>
        currentHorses.map((horse) => ({
          ...horse,
          currentTemperature: Number((horse.normalTemperature - 0.2 + Math.random() * 1.2).toFixed(1)),
          lastUpdated: updatedAt,
        })),
      );
    }, TEMPERATURE_UPDATE_INTERVAL);

    return () => window.clearInterval(interval);
  }, []);

  const handleRegisteredHorse = (horse: HorseRecord) => {
    setHorses((currentHorses) => [...currentHorses, horse]);
    setSelectedHorseId(horse.id);
  };

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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl">🐎 Horse Thermal Monitor</h1>
            <p className="text-xl mt-1">Real-Time Temperature Monitoring System</p>
          </div>
          <div className="text-right">
            <div className="text-2xl">{selectedHorse?.name ?? "No horse registered"}</div>
            <div className="text-lg opacity-90">
              {selectedHorse ? "Currently Monitoring" : "Open Register to begin"}
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

      {/* Main Content */}
      <main className="max-w-7xl mx-auto">
        {currentView === "dashboard" && (
          <Dashboard horse={selectedHorse} onRegister={() => setCurrentView("register")} />
        )}
        {currentView === "history" && <HistoryView selectedHorse={selectedHorse?.name ?? ""} />}
        {currentView === "alerts" && <Alerts selectedHorse={selectedHorse?.name ?? ""} />}
        {currentView === "horses" && (
          <Horses
            horses={horses}
            selectedHorseId={selectedHorseId}
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
        {currentView === "settings" && <Settings />}
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
