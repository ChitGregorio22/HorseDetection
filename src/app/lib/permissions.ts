import type { Profile } from "./api";

/**
 * Who can do what (matches the database rules in supabase/05_roles_and_approval.sql):
 *  admin        → everything, plus approving users and changing roles
 *  owner        → settings, thresholds, calibration, camera, register / edit / remove horses
 *  caretaker    → view everything, acknowledge / resolve alerts
 *  veterinarian → same as caretaker
 */
export function permissionsFor(profile: Profile | null) {
  const role = profile?.approved ? profile.role : null;
  return {
    manageSettings: role === "admin" || role === "owner",
    manageHorses: role === "admin" || role === "owner",
    registerHorses: role === "admin" || role === "owner",
    handleAlerts: role !== null,
    deleteHorses: role === "admin",
    manageUsers: role === "admin",
  };
}

export type Permissions = ReturnType<typeof permissionsFor>;

export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  owner: "Owner",
  caretaker: "Caretaker",
  veterinarian: "Veterinarian",
};
