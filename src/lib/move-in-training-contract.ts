import { z } from "zod";
export const trainingActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("toggle"), enabled: z.boolean(), version: z.number().int().nonnegative() }),
  z.object({ action: z.literal("start"), facilityId: z.string().min(1) }),
  z.object({ action: z.enum(["unit", "agreement", "payment", "identity", "photo", "preview", "approve", "reject", "handover", "reset"]), facilityId: z.string().min(1), version: z.number().int().positive(), value: z.string().max(100).optional() }),
]);
export type TrainingAction = z.infer<typeof trainingActionSchema>;
export type TrainingState = { unit: string | null; agreement: boolean; paid: number; identity: boolean; photo: "MISSING" | "WAITING_REVIEW" | "REJECTED" | "APPROVED"; previewed: boolean; handedOverAt: string | null };
export const initialTrainingState = (): TrainingState => ({ unit:null, agreement:false, paid:0, identity:false, photo:"MISSING", previewed:false, handedOverAt:null });
export const trainingUnits = [{ id:"DEMO-01", name:"Demo unit 01", rent:100 }, { id:"DEMO-02", name:"Demo unit 02", rent:150 }];
export function trainingRequired(state: TrainingState) { return trainingUnits.find(unit => unit.id === state.unit)?.rent ?? 0; }
export function trainingReady(state: TrainingState) { return Boolean(state.unit && state.agreement && state.paid >= trainingRequired(state) && state.identity && state.photo === "APPROVED"); }
export function advanceTraining(state: TrainingState, action: string, value?: string): TrainingState {
  const next = { ...state };
  if (state.handedOverAt) throw new Error("TRAINING_FINISHED");
  if (action === "unit") {
    if (!trainingUnits.some(unit => unit.id === value) || state.agreement) throw new Error("TRAINING_STEP_REQUIRED");
    next.unit = value!;
  } else if (action === "agreement") {
    if (!state.unit || value !== "confirmed") throw new Error("TRAINING_STEP_REQUIRED");
    next.agreement = true;
  } else if (action === "payment") {
    const amount = Number(value);
    if (!state.agreement || !Number.isFinite(amount) || amount <= 0 || amount > 10000 || Math.abs(amount*100-Math.round(amount*100)) > 0.00001) throw new Error("TRAINING_STEP_REQUIRED");
    next.paid = Math.round((state.paid + amount)*100)/100;
  } else if (action === "identity") {
    if (!state.agreement || state.paid < trainingRequired(state) || value !== "confirmed") throw new Error("TRAINING_STEP_REQUIRED");
    next.identity = true;
  } else if (action === "photo") {
    if (!state.identity || value !== "validated-sample") throw new Error("TRAINING_STEP_REQUIRED");
    next.photo = "WAITING_REVIEW"; next.previewed = false;
  } else if (action === "preview") {
    if (state.photo !== "WAITING_REVIEW") throw new Error("TRAINING_STEP_REQUIRED");
    next.previewed = true;
  } else if (action === "approve" || action === "reject") {
    if (state.photo !== "WAITING_REVIEW" || !state.previewed) throw new Error("TRAINING_STEP_REQUIRED");
    next.photo = action === "approve" ? "APPROVED" : "REJECTED";
  } else if (action === "handover") {
    if (!trainingReady(state) || value !== "confirmed") throw new Error("TRAINING_STEP_REQUIRED");
    next.handedOverAt = new Date().toISOString();
  } else throw new Error("TRAINING_STEP_REQUIRED");
  return next;
}
