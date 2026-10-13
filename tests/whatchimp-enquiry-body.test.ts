import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWhatChimpBody } from '../src/lib/whatchimp-enquiry-body';

test('native form fields preserve customer quotes, newlines, Unicode and phone plus signs', async () => {
  const input = { action: 'update', phone: '+27810000001', value: 'Two "large" boxes\nCafé stock \\ tools' };
  const encoded = new URLSearchParams(input).toString();
  assert.deepEqual(await parseWhatChimpBody(encoded, 'application/x-www-form-urlencoded'), input);
  const form = new FormData();
  for (const [name, value] of Object.entries(input)) form.set(name, value);
  const request = new Request('http://localhost', { method: 'POST', body: form });
  assert.deepEqual(await parseWhatChimpBody(await request.text(), request.headers.get('content-type')), input);
});

test('ambiguous duplicate fields and file uploads are refused; JSON remains compatible', async () => {
  await assert.rejects(parseWhatChimpBody('action=start&action=submit', 'application/x-www-form-urlencoded'), SyntaxError);
  const form = new FormData(); form.set('value', new Blob(['not a text field']), 'answer.txt');
  const request = new Request('http://localhost', { method: 'POST', body: form });
  await assert.rejects(parseWhatChimpBody(await request.text(), request.headers.get('content-type')), SyntaxError);
  await assert.rejects(parseWhatChimpBody('text', 'text/plain'), SyntaxError);
  assert.deepEqual(await parseWhatChimpBody('{"action":"probe"}', 'application/json'), { action: 'probe' });
});
