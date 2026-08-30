import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

const source = await readFile(new URL('../src/lib/jobSort.ts', import.meta.url), 'utf8');
const { code } = await transformWithOxc(source, 'jobSort.ts');
const jobSort = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('display order prioritizes S then A then B before company and job title', () => {
  const jobs = [
    { id: 'beta-10', priority: 'B', company: 'Beta Systems', title: 'Backend Role 10' },
    { id: 'alpha-2', priority: 'B', company: 'Alpha Systems', title: 'Backend Role 2' },
    { id: 'beta-2', priority: 'B', company: 'Beta Systems', title: 'Backend Role 2' },
    { id: 'a-priority', priority: 'A', company: 'Zeta Systems', title: 'Platform Engineer' },
    { id: 's-priority', priority: 'S', company: 'Zeta Systems', title: 'Backend Engineer' },
  ];

  assert.deepEqual(
    jobSort.sortJobsForDisplay(jobs).map((job) => job.id),
    ['s-priority', 'a-priority', 'alpha-2', 'beta-2', 'beta-10'],
  );
});

test('Chinese company names use pinyin collation', () => {
  const jobs = [
    { id: 'mingchuan', priority: 'B', company: '明川科技', title: '后端开发工程师' },
    { id: 'yuanhai', priority: 'B', company: '远海科技', title: '后端开发工程师' },
    { id: 'anyun', priority: 'B', company: '安云科技', title: '后端开发工程师' },
    { id: 'beichen', priority: 'B', company: '北辰科技', title: '后端开发工程师' },
  ];

  assert.deepEqual(
    jobSort.sortJobsForDisplay(jobs).map((job) => job.company),
    ['安云科技', '北辰科技', '明川科技', '远海科技'],
  );
});

test('priority remains the first key even when it splits one company across tiers', () => {
  const jobs = [
    { id: 'acme-b', priority: 'B', company: 'Acme', title: 'B role' },
    { id: 'beta-a', priority: 'A', company: 'Beta', title: 'A role' },
    { id: 'acme-s', priority: 'S', company: 'Acme', title: 'S role' },
    { id: 'legacy', priority: 'legacy', company: 'Aardvark', title: 'Legacy role' },
  ];

  assert.deepEqual(
    jobSort.sortJobsForDisplay(jobs).map((job) => job.id),
    ['acme-s', 'beta-a', 'acme-b', 'legacy'],
  );
});

test('display sorting is non-mutating and uses the id as a deterministic final key', () => {
  const jobs = [
    { id: 'second', priority: 'A', company: '同一公司', title: '同一岗位' },
    { id: 'first', priority: 'A', company: '同一公司', title: '同一岗位' },
  ];
  const sorted = jobSort.sortJobsForDisplay(jobs);

  assert.notStrictEqual(sorted, jobs);
  assert.deepEqual(jobs.map((job) => job.id), ['second', 'first']);
  assert.deepEqual(sorted.map((job) => job.id), ['first', 'second']);
});
