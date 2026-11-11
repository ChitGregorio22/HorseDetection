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
  /** false = new sign-up waiting for an admin to approve it */
  approved: boolean;
}

export interface Settings {
  warning_threshold: number;
  fever_threshold: number;
  check_interval_seconds: number;
  sound_alerts: boolean;
  email_notifications: boolean;
  /** Raspberry Pi live stream address (MJPEG), or null if not set up */
  camera_stream_url: string | null;
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
  camera_stream_url: null,
};

// numeric columns arrive from Postgres as numbers or strings — normalise them
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Turns database error messages into plain sentences for the screen. */
export function friendlyError(message: string) {
  if (message.includes("horses_active_name_unique")) {
    return "A horse with this name is already registered. Each name can only be used for one horse.";
  }
  if (/row-level security|permission denied|Only an admin/i.test(message)) {
    return "Your account doesn't have permission to do this.";
  }
  return message;
}

function check<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(friendlyError(result.error.message));
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
  if (path.startsWith("data:")) return path; // photo sent by the Pi (registration crop)
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
  const result = await supabase.from("profiles").select("id, full_name, role, phone, approved").eq("id", auth.user.id).single();
  if (result.error?.message.includes("approved")) {
    // database update 05 not run yet → everyone counts as approved, like before
    const old = check(await supabase.from("profiles").select("id, full_name, role, phone").eq("id", auth.user.id).single());
    return { ...(old as unknown as Omit<Profile, "approved">), approved: true };
  }
  return check(result) as Profile;
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
    camera_stream_url: typeof row.camera_stream_url === "string" && row.camera_stream_url ? row.camera_stream_url : null,
  };
}

export async function updateSettings(s: Settings) {
  const { data: auth } = await supabase.auth.getUser();
  const cameraUrl = s.camera_stream_url?.trim() || null;
  const result = await supabase
    .from("system_settings")
    .update({ ...s, camera_stream_url: cameraUrl, updated_by: auth.user?.id })
    .eq("id", 1)
    .select();
  if (result.error?.message.includes("camera_stream_url")) {
    throw new Error("The database needs the live camera update. Run supabase/03_live_camera.sql in the Supabase SQL Editor, then save again.");
  }
  const rows = check(result);
  if (!rows || rows.length === 0) throw new Error("Only an owner or admin can change settings.");
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
  tables: Array<"temperature_readings" | "alerts" | "horses" | "registration_requests">,
  onChange: (table: string, row: Record<string, unknown>, event: "INSERT" | "UPDATE" | "DELETE") => void,
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
        ...(horseId && table !== "horses" && table !== "registration_requests" ? { filter: `horse_id=eq.${horseId}` } : {}),
      },
      (payload) => onChange(table, (payload.new ?? {}) as Record<string, unknown>, payload.eventType),
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

// ---------- Raspberry Pi connection (heartbeat) ----------
export interface DeviceStatus {
  id: string;
  name: string;
  location: string | null;
  last_seen_at: string | null;
  seconds_since_seen: number | null;
  online: boolean;
  /** What the Pi last reported: cpu_temp, camera, thermal, dht, uptime_s, ip, app… */
  status: Record<string, unknown>;
}

/** Returns null when the database update (04_device_status.sql) hasn't been run yet. */
export async function getDeviceStatus(): Promise<DeviceStatus[] | null> {
  const { data, error } = await supabase.rpc("get_device_status");
  if (error) {
    if (/get_device_status|function|schema cache/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  return (data ?? []) as DeviceStatus[];
}

// ---------- Edit / remove horses (owner + admin) ----------
export async function updateHorse(id: string, changes: { name: string; age: number | null; normal_temp: number }) {
  const rows = check(await supabase.from("horses").update(changes).eq("id", id).select("id"));
  if (!rows || rows.length === 0) throw new Error("Your account doesn't have permission to do this.");
}

/** Remove from monitoring (keeps all readings) or restore. */
export async function setHorseActive(id: string, active: boolean) {
  const rows = check(await supabase.from("horses").update({ is_active: active }).eq("id", id).select("id"));
  if (!rows || rows.length === 0) throw new Error("Your account doesn't have permission to do this.");
}

/** Admin only: deletes the horse AND all its readings and alerts. */
export async function deleteHorsePermanently(id: string) {
  const rows = check(await supabase.from("horses").delete().eq("id", id).select("id"));
  if (!rows || rows.length === 0) throw new Error("Only an admin can delete a horse permanently.");
}

export async function getRemovedHorses(): Promise<{ id: string; name: string; horse_code: string; updated_at: string }[]> {
  return check(
    await supabase.from("horses").select("id, name, horse_code, updated_at").eq("is_active", false).order("name"),
  ) as { id: string; name: string; horse_code: string; updated_at: string }[];
}

// ---------- Users (admin) ----------
export interface UserAccount {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  approved: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

export async function adminListUsers(): Promise<UserAccount[]> {
  return check(await supabase.rpc("admin_list_users")) as UserAccount[];
}

export async function adminUpdateUser(id: string, changes: { role?: UserRole; approved?: boolean }) {
  const rows = check(await supabase.from("profiles").update(changes).eq("id", id).select("id"));
  if (!rows || rows.length === 0) throw new Error("Only an admin can change user roles or approval.");
}

// ---------- CSV export (History) ----------
/** Downloads every reading for one horse (or all horses) in the last `days` days (null = all time). */
export async function downloadReadingsCsv(horse: { id: string; name: string } | null, days: number | null) {
  const pageSize = 1000; // Supabase returns at most 1000 rows per request
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("temperature_readings")
      .select("*, horses(name, horse_code)")
      .order("recorded_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (horse) query = query.eq("horse_id", horse.id);
    if (days) query = query.gte("recorded_at", new Date(Date.now() - days * 86400000).toISOString());
    const page = check(await query) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  const fmt = (iso: unknown) => {
    const d = new Date(String(iso));
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const text = String(v);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = ["date_time", "horse_name", "horse_code", "body_temp_c", "raw_body_temp_c", "env_temp_c", "humidity_pct", "status"];
  const lines = rows.map((r) => {
    const h = (r.horses ?? {}) as { name?: string; horse_code?: string };
    return [fmt(r.recorded_at), h.name, h.horse_code, r.body_temp, r.raw_body_temp, r.env_temp, r.humidity, r.status]
      .map(cell)
      .join(",");
  });
  const csv = "\uFEFF" + [header.join(","), ...lines].join("\r\n"); // BOM so Excel shows °C/ñ correctly

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const today = new Date().toISOString().slice(0, 10);
  const who = horse ? horse.name.replace(/[^a-z0-9]+/gi, "-") : "all-horses";
  link.href = url;
  link.download = `temperature-readings_${who}_${days ? `last-${days}-days` : "all-time"}_${today}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return rows.length;
}

// ---------- Registration through the Pi's stall camera ----------
export type RegistrationStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export interface RegistrationProgress {
  photos?: number;
  needed?: number;
  views?: Record<string, number>;
  need_views?: Record<string, number>;
  missing?: string;
  note?: string;
  horses_in_view?: number | null;
  done?: boolean;
}

export interface RegistrationRequest {
  id: number;
  name: string;
  age: number | null;
  normal_temp: number;
  force: boolean;
  status: RegistrationStatus;
  progress: RegistrationProgress;
  message: string | null;
  horse_id: string | null;
  created_at: string;
  updated_at: string;
}

const toRequest = (r: Record<string, unknown>): RegistrationRequest => ({
  ...(r as unknown as RegistrationRequest),
  normal_temp: Number(r.normal_temp),
  progress: (r.progress ?? {}) as RegistrationProgress,
});

/** The newest registration request (any status), or null. Returns undefined if update 07 isn't installed. */
export async function getLatestRegistration(): Promise<RegistrationRequest | null | undefined> {
  await supabase.rpc("expire_stale_registrations"); // tidy up requests the Pi never finished
  const { data, error } = await supabase
    .from("registration_requests")
    .select("*")
    .order("id", { ascending: false })
    .limit(1);
  if (error) {
    if (/registration_requests|schema cache|does not exist/i.test(error.message)) return undefined;
    throw new Error(friendlyError(error.message));
  }
  return data && data[0] ? toRequest(data[0] as Record<string, unknown>) : null;
}

export async function getRegistration(id: number): Promise<RegistrationRequest | null> {
  const rows = check(await supabase.from("registration_requests").select("*").eq("id", id).limit(1)) as Record<string, unknown>[];
  return rows[0] ? toRequest(rows[0]) : null;
}

export async function startRegistration(input: { name: string; age: number | null; normal_temp: number; force?: boolean }) {
  const result = await supabase
    .from("registration_requests")
    .insert({ name: input.name.trim(), age: input.age, normal_temp: input.normal_temp, force: Boolean(input.force) })
    .select()
    .single();
  if (result.error?.message.includes("registration_requests_one_active")) {
    throw new Error("Another registration is already in progress. Wait for it to finish or cancel it.");
  }
  return toRequest(check(result) as Record<string, unknown>);
}

export async function cancelRegistration(id: number) {
  check(
    await supabase
      .from("registration_requests")
      .update({ status: "cancelled", message: "Cancelled on the website." })
      .eq("id", id)
      .in("status", ["pending", "running"]),
  );
}

export async function getHorseBasic(id: string) {
  const rows = check(
    await supabase.from("horses").select("id, horse_code, name, age, normal_temp, photo_path, registered_at").eq("id", id).limit(1),
  ) as Record<string, unknown>[];
  const h = rows[0];
  if (!h) return null;
  return {
    id: String(h.id),
    horseCode: String(h.horse_code),
    name: String(h.name),
    age: h.age == null ? null : Number(h.age),
    normalTemperature: Number(h.normal_temp),
    photo: photoUrl((h.photo_path as string | null) ?? null) ?? "",
    registeredAt: String(h.registered_at),
  };
}
