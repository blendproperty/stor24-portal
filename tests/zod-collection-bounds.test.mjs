import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

test('oversized bounded collections are rejected before visiting their elements', () => {
  let visited = 0;
  const element = z.preprocess(value => { visited++; return value; }, z.string());
  const values = Array.from({ length: 10000 }, (_, index) => index);
  const cases = [
    [z.array(element).max(2), values],
    [z.set(element).max(2), new Set(values)],
    [z.map(element, element).max(2), new Map(values.map(value => [value, value]))],
  ];
  for (const [schema, input] of cases) {
    const result = schema.safeParse(input);
    assert.equal(result.success, false);
    assert.equal(result.error.issues.length, 1);
    assert.equal(result.error.issues[0].code, 'too_big');
    assert.equal(visited, 0);
  }
  assert.deepEqual(z.array(z.string()).max(2).parse(['valid']), ['valid']);
});
