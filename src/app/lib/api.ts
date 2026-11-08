// All database calls used by the screens live here, so the components stay simple.
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// ---------- Types (mirror the tables/views in supabase/01_schema.sql) ----------
export type UserRole = "admin" | "caretaker" | "veterinarian" | "owner";
export type HealthStatus = "normal" | "warning" | "fever";
export type AlertStatus = "active" | "acknowledged" | "resolved";

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  phone: string | null;
}

export interface Settings {
  warning_threshold: number;
  fever_threshold: number;
  check_interval_seconds: number;
  sound_alerts: boolean;
  email_notifications: boolean;
}

export interface HorseStatus {
  id: string;
  horse_code: string;
  name: string;
  age: number | null;
  normal_temp: number;
  photo_path: string | null;
  is_active: boolean;
  registered_at: string;
  current_temp: number | null;
  current_env_temp: number | null;
  status: HealthStatus;
  last_check: string | null;
  open_alerts: number;
}

export interface Reading {
  id: number;
  horse_id: string;
  body_temp: number;
  env_temp: number | null;
  status: HealthStatus;
  recorded_at: string;
}

export interface DailySummary {
  horse_id: string;
  day: string;
  reading_count: number;
  avg_body_temp: number;
  peak_body_temp: number;
  min_body_temp: number;
  peak_time: string;
  avg_env_temp: number | null;
  status: HealthStatus;
}

export interface Alert {
  id: number;
  horse_id: string;
  level: HealthStatus;
  temperature: number;
  status: AlertStatus;
  message: string | null;
  notes: string | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  horses: { name: string } | null;
}

export interface Device {
  id: string;
  name: string;
  location: string | null;
  device_key: string;
  calibration_offset: number;
  last_calibrated_at: string | null;
  last_seen_at: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  warning_threshold: 37.5,
  fever_threshold: 38.0,
  check_interval_seconds: 3,
  sound_alerts: true,
  email_notifications: true,
};

// numeric columns arrive from Postgres as numbers or strings — normalise them
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function check<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

// ---------- Status helpers ----------
export function classify(temp: number, s: Settings): HealthStatus {
  if (temp >= s.fever_threshold) return "fever";
  if (temp >= s.warning_threshold) return "warning";
  return "normal";
}

export function photoUrl(path: string | null) {
  if (!path) return null;
  return supabase.storage.from("horse-photos").getPublicUrl(path).data.publicUrl;
}

export function timeAgo(iso: string | null) {
  if (!iso) return "No readings yet";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

// ---------- Auth & profile ----------
export async function getMyProfile(): Promise<Profile | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  return check(await supabase.from("profiles").select("id, full_name, role, phone").eq("id", auth.user.id).single());
}

// ---------- Settings ----------
export async function getSettings(): Promise<Settings> {
  const row = check(await supabase.from("system_settings").select("*").eq("id", 1).single()) as Record<string, unknown>;
  return {
    warning_threshold: Number(row.warning_threshold),
    fever_threshold: Number(row.fever_threshold),
    check_interval_seconds: Number(row.check_interval_seconds),
    sound_alerts: Boolean(row.sound_alerts),
    email_notifications: Boolean(row.email_notifications),
  };
}

export async function updateSettings(s: Settings) {
  const { data: auth } = await supabase.auth.getUser();
  const rows = check(
    await supabase.from("system_settings").update({ ...s, updated_by: auth.user?.id }).eq("id", 1).select(),
  );
  if (!rows || rows.length === 0) throw new Error("Only an admin can change settings.");
}

// ---------- Horses ----------
export async function getHorses(): Promise<HorseStatus[]> {
  const rows = check(
    await supabase.from("horse_current_status").select("*").eq("is_active", true).order("name"),
  ) as Record<string, unknown>[];
  return rows.map((r) => ({
    ...(r as unknown as HorseStatus),
    normal_temp: Number(r.normal_temp),
    current_temp: num(r.current_temp),
    current_env_temp: num(r.current_env_temp),
  }));
}

export async function addHorse(input: { name: string; age: number | null; normal_temp: number; photo_path?: string | null }) {
  const { data: auth } = await supabase.auth.getUser();
  return check(
    await supabase
      .from("horses")
      .insert({ ...input, registered_by: auth.user?.id })
      .select("id, horse_code, name, age, normal_temp, registered_at")
      .single(),
  ) as { id: string; horse_code: string; name: string; age: number; normal_temp: number; registered_at: string };
}

/** Register screen: uploads the photo (data URL) then creates the horse. */
export async function registerHorse(input: { name: string; age: number; normal_temp: number; photoDataUrl: string }) {
  const blob = await (await fetch(input.photoDataUrl)).blob();
  const ext = blob.type === "image/png" ? "png" : "jpg";
  const path = `registrations/${crypto.randomUUID()}.${ext}`;
  const upload = await supabase.storage.from("horse-photos").upload(path, blob, { contentType: blob.type });
  if (upload.error) throw new Error(`Photo upload failed: ${upload.error.message}`);
  return addHorse({ name: input.name, age: input.age, normal_temp: input.normal_temp, photo_path: path });
}

// ---------- Readings ----------
export async function getRecentReadings(horseId: string, limit = 20): Promise<Reading[]> {
  const rows = check(
    await supabase
      .from("temperature_readings")
      .select("id, horse_id, body_temp, env_temp, status, recorded_at")
      .eq("horse_id", horseId)
      .order("recorded_at", { ascending: false })
      .limit(limit),
  ) as Record<string, unknown>[];
  return rows
    .map((r) => ({ ...(r as unknown as Reading), body_temp: Number(r.body_temp), env_temp: num(r.env_temp) }))
    .reverse();
}

export async function getDailySummary(horseId: string, days = 7): Promise<DailySummary[]> {
  const rows = check(
    await supabase
      .from("daily_temperature_summary")
      .select("*")
      .eq("horse_id", horseId)
      .order("day", { ascending: false })
      .limit(days),
  ) as Record<string, unknown>[];
  return rows
    .map((r) => ({
      ...(r as unknown as DailySummary),
      avg_body_temp: Number(r.avg_body_temp),
      peak_body_temp: Number(r.peak_body_temp),
      min_body_temp: Number(r.min_body_temp),
      avg_env_temp: num(r.avg_env_temp),
    }))
    .reverse();
}

/** Manual reading (e.g. from a handheld thermometer). Status + alerts are handled by the database. */
export async function addManualReading(horseId: string, bodyTemp: number, envTemp: number | null) {
  return check(
    await supabase
      .from("temperature_readings")
      .insert({ horse_id: horseId, body_temp: bodyTemp, env_temp: envTemp })
      .select()
      .single(),
  );
}

// ---------- Alerts ----------
export async function getAlerts(limit = 50): Promise<Alert[]> {
  const rows = check(
    await supabase
      .from("alerts")
      .select("id, horse_id, level, temperature, status, message, notes, created_at, acknowledged_at, resolved_at, horses(name)")
      .order("created_at", { ascending: false })
      .limit(limit),
  ) as unknown as Alert[];
  return rows.map((a) => ({ ...a, temperature: Number(a.temperature) }));
}

export async function setAlertStatus(id: number, status: AlertStatus, notes?: string) {
  const rows = check(
    await supabase.from("alerts").update(notes ? { status, notes } : { status }).eq("id", id).select("id"),
  );
  if (!rows || rows.length === 0) throw new Error("Your account is not allowed to update alerts.");
}

// ---------- Devices / calibration (admin) ----------
export async function getDevices(): Promise<Device[]> {
  const rows = check(await supabase.from("devices").select("*").order("name")) as Record<string, unknown>[];
  return rows.map((d) => ({ ...(d as unknown as Device), calibration_offset: Number(d.calibration_offset) }));
}

export async function saveCalibration(deviceId: string, offset: number) {
  check(
    await supabase
      .from("devices")
      .update({ calibration_offset: offset, last_calibrated_at: new Date().toISOString() })
      .eq("id", deviceId),
  );
}

// ---------- Realtime ----------
/** Calls `onChange` whenever readings, alerts or horses change. Returns an unsubscribe function. */
export function subscribeToChanges(
  name: string,
  tables: Array<"temperature_readings" | "alerts" | "horses">,
  onChange: (table: string, row: Record<string, unknown>) => void,
  horseId?: string,
) {
  let channel: RealtimeChannel = supabase.channel(`${name}-${Math.random().toString(36).slice(2)}`);
  for (const table of tables) {
    channel = channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table,
        ...(horseId && table !== "horses" ? { filter: `horse_id=eq.${horseId}` } : {}),
      },
      (payload) => onChange(table, (payload.new ?? {}) as Record<string, unknown>),
    );
  }
  channel.subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// ---------- Shape used by the screens ----------
export interface HorseRecord {
  id: string; // database id (uuid)
  horseCode: string; // printed on the QR tag, e.g. HTM-4F2A9C1B
  name: string;
  age: number | null;
  normalTemperature: number;
  currentTemperature: number | null; // null until the first reading arrives
  envTemperature: number | null;
  status: HealthStatus;
  registeredAt: string;
  lastUpdated: string | null;
  photo: string; // public URL, or "" if no photo
  openAlerts: number;
}

export function toHorseRecord(h: HorseStatus): HorseRecord {
  return {
    id: h.id,
    horseCode: h.horse_code,
    name: h.name,
    age: h.age,
    normalTemperature: h.normal_temp,
    currentTemperature: h.current_temp,
    envTemperature: h.current_env_temp,
    status: h.status,
    registeredAt: h.registered_at,
    lastUpdated: h.last_check,
    photo: photoUrl(h.photo_path) ?? "",
    openAlerts: h.open_alerts,
  };
}

export async function getHorseRecords(): Promise<HorseRecord[]> {
  return (await getHorses()).map(toHorseRecord);
}
