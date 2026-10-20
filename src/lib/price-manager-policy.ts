import {createHmac,timingSafeEqual} from "node:crypto";
import {z} from "zod";
import {currentRoleAccess} from "./current-role-access";
export const priceManagerRequestSchema=z.object({id:z.string().min(1).max(100),facilityId:z.string().min(1).max(100),revision:z.number().int().nonnegative(),approverId:z.string().min(1).max(100),reference:z.string().trim().min(5).max(200),confirmed:z.literal(true)}).strict();
export const priceManagerVerifySchema=z.object({challengeId:z.uuid(),facilityId:z.string().min(1).max(100),code:z.string().regex(/^\d{6}$/),confirmed:z.literal(true)}).strict();
export const priceManagerContactSchema=z.object({phone:z.string().trim().regex(/^\+[1-9]\d{7,14}$/).or(z.literal("")),consent:z.literal(true)}).strict();
export function canApprovePrice(assignments:Parameters<typeof currentRoleAccess>[0],facilityId:string){return ["reservation_prices.view","reservations.manage","billing.view","reservation_prices.approve"].every(permission=>currentRoleAccess(assignments,permission,facilityId).allowed);}
export function priceApprovalCodeHash(id:string,code:string){const secret=process.env.AUTH_SECRET;if(!secret||secret.length<32)throw Error("PRICE_OTP_CONFIG_REQUIRED");return createHmac("sha256",secret).update(`price-manager:${id}:${code}`).digest("hex");}
export function matchesPriceApprovalCode(id:string,code:string,hash:string){const actual=priceApprovalCodeHash(id,code);return /^[a-f0-9]{64}$/.test(hash)&&timingSafeEqual(Buffer.from(actual),Buffer.from(hash));}
export function requireUsablePriceChallenge(challenge:{status:string;expiresAt:Date;attempts:number;consumedAt:Date|null},now=new Date()){if(challenge.status!=="SENT"||challenge.consumedAt||challenge.attempts>=5||challenge.expiresAt<=now)throw Error("PRICE_OTP_INVALID");}
