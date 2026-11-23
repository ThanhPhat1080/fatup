export type LockScene = 'moria' | 'gate' | 'simple';

/** Which app-lock scene to show. Off = the light simple door; on = the full LOTR scenes. */
export function lockScene(lotr: boolean, phone: boolean): LockScene {
  if (!lotr) return 'simple';
  return phone ? 'gate' : 'moria';
}

/** Whether the Vault gate is the still (no animation, instant) variant. */
export function vaultGateStill(lotr: boolean, still: boolean): boolean {
  return lotr ? still : true;
}
