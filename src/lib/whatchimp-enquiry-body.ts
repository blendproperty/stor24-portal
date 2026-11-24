/** Decode native provider form fields without interpolating user text into JSON. */
export async function parseWhatChimpBody(body: string, contentType: string | null) {
  const type = contentType?.split(';', 1)[0].trim().toLowerCase();
  if (!type || type === 'application/json') return JSON.parse(body);
  if (type !== 'application/x-www-form-urlencoded' && type !== 'multipart/form-data') throw new SyntaxError('Unsupported enquiry content type');
  let form: FormData;
  try { form = await new Response(body, { headers: { 'Content-Type': contentType! } }).formData(); }
  catch { throw new SyntaxError('Invalid enquiry form'); }
  const values: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (typeof value !== 'string' || Object.hasOwn(values, name)) throw new SyntaxError('Enquiry fields must be unique text values');
    Object.defineProperty(values, name, { value: value.replace(/\r\n/g, '\n'), enumerable: true });
  }
  return values;
}
export async function boundedEnquiryBody(request: Request) {
  if (Number(request.headers.get('content-length')) > 8192) throw Error('INTAKE_BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > 8192) {
      await reader.cancel();
      throw Error('INTAKE_BODY_TOO_LARGE');
    }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
