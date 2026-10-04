/** Bounds for Pay Now hints and verification, independent of financial settlement. */
export const PAY_NOW_CALLBACK_BYTES = 64 * 1024;
export const PAY_NOW_RESPONSE_BYTES = 64 * 1024;
export const PAY_NOW_CALLBACK_TIMEOUT_MS = 10_000;
export const PAY_NOW_VERIFICATION_TIMEOUT_MS = 15_000;
export const PAY_NOW_VERIFICATIONS_PER_PROCESS = 4;

export function payNowIdentifier(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !/[\s\x00-\x1f\x7f]/.test(value);
}

/** A deadline also bounds streamed bodies and transports which ignore cancellation. */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new Error("NETCASH_REQUEST_TIMEOUT"));
    if (signal.aborted) { void work.catch(() => undefined); aborted(); return; }
    signal.addEventListener("abort", aborted, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

export async function boundedPayNowBody(message: Request | Response, maximum: number, signal: AbortSignal) {
  if (Number(message.headers.get("content-length")) > maximum) {
    void message.body?.cancel().catch(() => undefined);
    throw new Error("NETCASH_BODY_TOO_LARGE");
  }
  const reader = message.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error("NETCASH_BODY_TOO_LARGE");
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally {
    // Never await cancellation: an untrusted stalled source can stall cancel too.
    void reader.cancel().catch(() => undefined);
    chunks.length = 0;
  }
}

export async function payNowCallback(request: Request) {
  const body = await boundedPayNowBody(request, PAY_NOW_CALLBACK_BYTES, AbortSignal.timeout(PAY_NOW_CALLBACK_TIMEOUT_MS));
  const form = new URLSearchParams(body);
  if (!form.size || form.size > 64) throw new Error("NETCASH_PAYLOAD_INVALID");
  for (const [key, value] of form) {
    if (key.length > 100 || value.length > 4096) throw new Error("NETCASH_PAYLOAD_INVALID");
  }
  for (const key of ["Reference", "RequestTrace"]) {
    const values = form.getAll(key);
    if (values.length > 1 || (values.length === 1 && !payNowIdentifier(values[0]))) throw new Error("NETCASH_PAYLOAD_INVALID");
  }
  return Object.fromEntries(form.entries());
}

let verifications = 0;
/** No waiting queue or automatic retry. Shared by every Pay Now verifier in this process. */
export async function boundedPayNowVerification<T>(work: () => Promise<T>): Promise<T> {
  if (verifications >= PAY_NOW_VERIFICATIONS_PER_PROCESS) throw new Error("NETCASH_TRANSACTION_STATUS_BUSY");
  verifications++;
  try { return await work(); }
  finally { verifications--; }
}
