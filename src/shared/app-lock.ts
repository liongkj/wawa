import { z } from 'zod';

export const idleMinuteChoices = [5, 15, 60] as const;
export const IdleMinutesSchema = z.union(idleMinuteChoices.map((value) => z.literal(value)));
export const PinSchema = z.string().regex(/^\d{6,12}$/, 'Use a PIN of 6 to 12 digits.');

export const AppLockStatusSchema = z.object({
  enabled: z.boolean(),
  idleMinutes: IdleMinutesSchema,
});
export const UnlockRequestSchema = z.object({ pin: z.string().max(40) });
export const UnlockResultSchema = z.object({ token: z.string(), expiresAt: z.number() });
export const AppLockSettingsSchema = z.object({
  /** Required whenever a PIN is already set. */
  currentPin: z.string().max(40).optional(),
  /** A new PIN; omit to keep the current one. Required to turn the lock on. */
  pin: PinSchema.optional(),
  idleMinutes: IdleMinutesSchema,
});
export const AppLockDisableSchema = z.object({ currentPin: z.string().max(40) });
export const AppLockSavedSchema = AppLockStatusSchema.extend({
  unlock: UnlockResultSchema.nullable(),
});

export const unlockHeader = 'x-wawa-unlock';
export type AppLockStatus = z.infer<typeof AppLockStatusSchema>;
