import {z} from 'zod';
export const discoverySources=['Unknown','Google ad','Google organic search','Facebook ad','Facebook organic','Instagram ad','Instagram organic','Referral','Roadside signage','Other'] as const;
export const marketProfileSchema=z.object({gender:z.enum(['UNKNOWN','FEMALE','MALE','SELF_DESCRIBED','PREFER_NOT_TO_SAY']).default('UNKNOWN'),storageUse:z.enum(['UNKNOWN','PERSONAL','BUSINESS','MIXED']).default('UNKNOWN'),discoverySource:z.enum(discoverySources).default('Unknown')}).strict();
export type LeadMarketProfile=z.infer<typeof marketProfileSchema>;
