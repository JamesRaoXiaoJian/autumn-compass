import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HttpError,
  limits,
  parseBootstrapBody,
  parseDeleteBody,
  parseItemBody,
  parseReplaceBody,
  validateItems,
  validateValue,
} from '../src/validation.mjs';

test('bootstrap accepts only autumn-compass string entries', () => {
  assert.deepEqual(
    { ...parseBootstrapBody({ items: { 'autumn-compass-jobs': '[]' }, clientId: 'browser-a' }).items },
    { 'autumn-compass-jobs': '[]' },
  );
});

test('foreign keys and non-string values are rejected', () => {
  assert.throws(() => validateItems({ unrelated: 'value' }), (error) => error instanceof HttpError && error.code === 'INVALID_KEY');
  assert.throws(() => validateItems({ 'autumn-compass-jobs': [] }), (error) => error instanceof HttpError && error.code === 'INVALID_VALUE');
});

test('write payloads reject unknown fields', () => {
  assert.throws(
    () => parseItemBody({ key: 'autumn-compass-jobs', value: '[]', clientId: 'a', surprise: true }),
    (error) => error instanceof HttpError && error.code === 'UNKNOWN_FIELD',
  );
});

test('item, delete and replace payloads accept optional baseRevision', () => {
  assert.equal(parseItemBody({ key: 'autumn-compass-jobs', value: '[]', clientId: 'a', baseRevision: 3 }).baseRevision, 3);
  assert.equal(parseDeleteBody({ key: 'autumn-compass-jobs', clientId: 'a', baseRevision: 3 }).baseRevision, 3);
  assert.equal(parseReplaceBody({ items: {}, clientId: 'a', baseRevision: 3 }).baseRevision, 3);
});

test('invalid revisions are rejected', () => {
  assert.throws(
    () => parseReplaceBody({ items: {}, clientId: 'a', baseRevision: -1 }),
    (error) => error instanceof HttpError && error.code === 'INVALID_REVISION',
  );
});

test('single values allow the note archive above 4 MiB but remain capped at 8 MiB', () => {
  assert.equal(limits.maxValueBytes, 8 * 1024 * 1024);
  assert.equal(validateValue('x'.repeat(4 * 1024 * 1024 + 1)).length, 4 * 1024 * 1024 + 1);
  assert.throws(
    () => validateValue('x'.repeat(limits.maxValueBytes + 1)),
    (error) => error instanceof HttpError && error.code === 'VALUE_TOO_LARGE',
  );
});
