export type SpeedAxis = 'horizontal' | 'vertical';
export type MovementMode = 'walking' | 'flying';
export interface MovementSpeeds { horizontal: number; vertical: number }
export interface NavigationProfiles { walking: MovementSpeeds; flying: MovementSpeeds }
export interface NavigationState extends MovementSpeeds { profiles: NavigationProfiles; firstPerson: boolean; flying: boolean; selecting: boolean }
export const DEFAULT_SPEEDS: MovementSpeeds = { horizontal: 8, vertical: 8 };
export const DEFAULT_FLYING_SPEEDS: MovementSpeeds = { horizontal: 14, vertical: 14 };
export function createNavigationProfiles(walking = DEFAULT_SPEEDS, flying = DEFAULT_FLYING_SPEEDS): NavigationProfiles {
  return { walking: { horizontal: walking.horizontal, vertical: walking.vertical }, flying: { horizontal: flying.horizontal, vertical: flying.vertical } };
}
