import type { CSSProperties } from "react";

export type VehicleFlagKey =
  | "wanted"
  | "dangerous"
  | "heist"
  | "lawbreaker";

export type VehicleFlagsState = Partial<Record<VehicleFlagKey, boolean>> | undefined;

export const VEHICLE_FLAGS: {
  key: VehicleFlagKey;
  label: string;
  description: string;
  color: string;
  icon: string;
}[] = [
  {
    key: "wanted",
    label: "Poszukiwanie",
    description: "Pojazd objęty poszukiwaniem",
    color: "#7f1d1d",
    icon: "🚨",
  },
  {
    key: "dangerous",
    label: "Niebezpieczny",
    description: "Pojazd jest uznany za niebezpieczny",
    color: "#b45309",
    icon: "☠️",
  },
  {
    key: "heist",
    label: "Wiele napadów",
    description: "Pojazd brał udział w wielu napadach",
    color: "#6d28d9",
    icon: "💣",
  },
  {
    key: "lawbreaker",
    label: "Często łamie prawo",
    description: "Pojazd regularnie łamie przepisy",
    color: "#0369a1",
    icon: "🚓",
  },
];

export function getActiveVehicleFlags(flags: VehicleFlagsState) {
  return VEHICLE_FLAGS.filter((flag) => !!flags?.[flag.key]);
}

export function getVehicleHighlightStyle(flags: VehicleFlagsState) {
  const active = getActiveVehicleFlags(flags);
  if (active.length === 0) return null;
  const colors = active.map((f) => f.color);
  const style: CSSProperties = colors.length === 1
    ? {
        background: colors[0],
        color: "#fff",
        borderColor: colors[0],
        boxShadow: "0 12px 30px rgba(0,0,0,0.25)",
      }
    : {
        background: `linear-gradient(135deg, ${colors.join(", ")})`,
        color: "#fff",
        borderColor: colors[0],
        boxShadow: "0 12px 30px rgba(0,0,0,0.25)",
      };
  return { style, active };
}
