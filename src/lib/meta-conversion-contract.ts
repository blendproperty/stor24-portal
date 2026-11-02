import { z } from 'zod';

// Separate from CRM journey attribution: never export advertising cookies there.
export const metaConversionConsent = z.object({
  version: z.literal('stor24-meta-server-v1'),
  consent: z.literal('granted'),
  page: z.enum(['/','/quote','/contact','/micro-warehousing','/book','/micro-warehousing/book','/storage/midpoint','/micro-warehousing/midpoint']),
  fbp: z.string().regex(/^fb\.1\.\d{13}\.\d{1,16}$/),
  fbc: z.string().regex(/^fb\.1\.\d{13}\.[A-Za-z0-9_-]{20,500}$/).optional(),
}).strict();
export type MetaConversionConsent = z.infer<typeof metaConversionConsent>;
