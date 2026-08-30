import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

const source = await readFile(new URL('../src/lib/safeUrl.ts', import.meta.url), 'utf8');
const { code } = await transformWithOxc(source, 'safeUrl.ts');
const safeUrl = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('optional web URLs accept empty values and normalize HTTP(S) links', () => {
  assert.equal(safeUrl.normalizeOptionalWebUrl(''), '');
  assert.equal(safeUrl.normalizeOptionalWebUrl('   '), '');
  assert.equal(safeUrl.normalizeOptionalWebUrl('https://example.com/jobs?id=42'), 'https://example.com/jobs?id=42');
  assert.equal(safeUrl.normalizeOptionalWebUrl(' HTTP://Example.COM/jobs '), 'http://example.com/jobs');
});

test('optional web URLs reject executable, local, relative, and malformed links', () => {
  const unsafeUrls = [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.com/jobs',
    '//example.com/jobs',
    '/jobs/42',
    'example.com/jobs',
    'https://',
  ];

  for (const url of unsafeUrls) {
    assert.equal(safeUrl.normalizeOptionalWebUrl(url), null, url);
    assert.equal(safeUrl.getSafeWebUrl(url), '', url);
  }
});

test('preferred links skip an unsafe referral URL and use the safe job URL', () => {
  assert.equal(
    safeUrl.firstSafeWebUrl('javascript:alert(1)', 'https://example.com/jobs/42'),
    'https://example.com/jobs/42',
  );
  assert.equal(safeUrl.firstSafeWebUrl('data:text/plain,unsafe', 'file:///tmp/job'), '');
});
