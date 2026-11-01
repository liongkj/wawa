import { z } from 'zod';
import { DeviceSchema } from './companion.js';

/** How long a paired computer may sit unused before it must pair again. */
export const pairingLifetimeDays = [30, 90, 365] as const;
export const PairingLifetimeSchema = z.union(pairingLifetimeDays.map((days) => z.literal(days)));
export type PairingLifetime = z.infer<typeof PairingLifetimeSchema>;

export const PairInfoSchema = z.object({ pairing: z.literal(true), name: z.string() });
export const ComputerCodeRequestSchema = z.object({
  days: PairingLifetimeSchema.default(365),
});
export const ComputerCodeSchema = z.object({
  code: z.string(),
  expiresAt: z.number(),
  days: PairingLifetimeSchema,
});
export const ComputerPairRequestSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(80),
});
export const ComputerPairResultSchema = z.object({
  token: z.string(),
  deviceId: z.string(),
  expiresAt: z.number(),
});
export const ComputersSchema = z.object({
  devices: z.array(DeviceSchema),
  /** Set when repeated wrong codes deleted the live code. Cleared by the next new code. */
  lockedOutAt: z.number().nullable(),
});
