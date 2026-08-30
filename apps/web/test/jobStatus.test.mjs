import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

const source = await readFile(new URL('../src/lib/jobStatus.ts', import.meta.url), 'utf8');
const { code } = await transformWithOxc(source, 'jobStatus.ts');
const jobStatus = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('pipeline stages retain the legacy terminal value and expose the clearer label', () => {
  assert.deepEqual(jobStatus.jobStatusOptions, ['收藏', '已投递', '笔试', '面试', 'Offer', '已结束']);
  assert.equal(jobStatus.getJobStatusLabel('已结束'), '流程终止');
  assert.equal(jobStatus.getJobStatusLabel('面试'), '面试');
});

test('new jobs record their actual initial stage without inventing an earlier favorite', () => {
  const favoriteAt = '2026-08-29T01:15:00.000Z';
  const favorite = jobStatus.appendJobStatusTransition(undefined, null, '收藏', favoriteAt);
  assert.deepEqual(favorite, [{ fromStatus: null, toStatus: '收藏', changedAt: favoriteAt }]);

  const appliedAt = '2026-08-29T01:16:00.000Z';
  const applied = jobStatus.appendJobStatusTransition(undefined, null, '已投递', appliedAt);
  assert.deepEqual(applied, [{ fromStatus: null, toStatus: '已投递', changedAt: appliedAt }]);
});

test('real transitions append in order while unchanged status does not create an event', () => {
  const changes = [
    ['2026-08-29T01:00:00.000Z', null, '收藏'],
    ['2026-08-29T02:00:00.000Z', '收藏', '已投递'],
    ['2026-08-30T03:00:00.000Z', '已投递', '收藏'],
    ['2026-09-01T04:00:00.000Z', '收藏', '已投递'],
  ];
  let history = [];
  for (const [changedAt, fromStatus, toStatus] of changes) {
    history = jobStatus.appendJobStatusTransition(history, fromStatus, toStatus, changedAt);
  }
  assert.equal(history.length, 4);
  assert.deepEqual(history.map((change) => change.toStatus), ['收藏', '已投递', '收藏', '已投递']);

  const unchanged = jobStatus.appendJobStatusTransition(
    history,
    '已投递',
    '已投递',
    '2026-09-02T05:00:00.000Z',
  );
  assert.deepEqual(unchanged, history);
});

test('legacy and malformed history stays non-fatal without fabricating dates', () => {
  assert.deepEqual(jobStatus.normalizeJobStatusHistory(undefined), []);
  assert.equal(jobStatus.getCurrentJobStatusChange({ status: '收藏' }), undefined);

  const valid = { fromStatus: '收藏', toStatus: '已投递', changedAt: '2026-08-29T02:00:00.000Z' };
  const normalized = jobStatus.normalizeJobStatusHistory([
    valid,
    { fromStatus: '已投递', toStatus: '未知阶段', changedAt: '2026-08-29T03:00:00.000Z' },
    { fromStatus: '收藏', toStatus: '已投递', changedAt: 'not-a-date' },
    null,
  ]);
  assert.deepEqual(normalized, [valid]);
  assert.notEqual(normalized[0], valid);
  assert.equal(jobStatus.isJobStatusHistory(normalized), true);
  assert.equal(jobStatus.isJobStatusHistory([{}]), false);
});

test('the board uses only the latest event when it matches the current stage', () => {
  const history = [
    { fromStatus: null, toStatus: '收藏', changedAt: '2026-08-28T10:00:00.000Z' },
    { fromStatus: '收藏', toStatus: '已投递', changedAt: '2026-08-29T10:00:00.000Z' },
  ];
  assert.equal(
    jobStatus.getCurrentJobStatusChange({ status: '已投递', statusHistory: history }).changedAt,
    history[1].changedAt,
  );
  assert.equal(jobStatus.getCurrentJobStatusChange({ status: '收藏', statusHistory: history }), undefined);
});

test('timestamps display as month/day in the selected local time zone', () => {
  const instant = '2026-08-28T16:30:00.000Z';
  assert.equal(jobStatus.formatJobStatusChangeDate(instant, 'Asia/Shanghai'), '08/29');
  assert.equal(jobStatus.formatJobStatusChangeFullDate(instant, 'Asia/Shanghai'), '2026年8月29日');
  assert.equal(jobStatus.formatJobStatusChangeDate('invalid', 'Asia/Shanghai'), '');
});
