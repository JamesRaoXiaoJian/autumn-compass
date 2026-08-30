import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({
  root: webRoot,
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const catalog = await vite.ssrLoadModule('/src/lib/jobCatalog.ts');

after(async () => {
  await vite.close();
});

function job(overrides = {}) {
  return {
    id: 'seed-job',
    company: '示例科技',
    logo: '示',
    logoTone: '#111827',
    title: '旧岗位名',
    department: '平台研发',
    location: '深圳',
    type: '2027 届校招 · 全职',
    status: '收藏',
    priority: 'A',
    deadline: '',
    nextStep: '核验岗位',
    url: 'https://example.com/old',
    source: '官方岗位页',
    tags: ['Java', '分布式系统'],
    recruitmentStatus: '已开放',
    maintenanceStatus: '无需维护',
    season: '2027 届秋招',
    verifiedAt: '2026-08-24',
    recruitmentNote: '旧说明',
    evidenceUrl: 'https://example.com/old',
    ...overrides,
  };
}

test('catalog revision is positive, explicit, and strictly one-way', () => {
  assert.equal(catalog.parseStoredJobCatalogRevision(null), 0);
  assert.equal(catalog.parseStoredJobCatalogRevision('not-json'), 0);
  assert.equal(catalog.parseStoredJobCatalogRevision('7'), 7);
  assert.equal(catalog.shouldApplyJobCatalogRevision(8, 7), true);
  assert.equal(catalog.shouldApplyJobCatalogRevision(8, 8), false);
  assert.equal(catalog.shouldApplyJobCatalogRevision(7, 8), false);
  assert.equal(catalog.mergeJobCatalogRevisionValues('8', '11'), '11');
  assert.equal(catalog.mergeJobCatalogRevisionValues('12', '11'), '12');
  assert.throws(() => catalog.mergeJobCatalogRevisionValues(null, '11'), /版本格式无效/);
});

test('same-day seed refresh preserves workflow and explicitly edited fields', () => {
  const initial = job({
    title: '后端开发工程师',
    url: 'https://example.com/new',
    evidenceUrl: 'https://example.com/new',
    recruitmentNote: '同日重新核验后的说明',
    notes: 'seed note',
  });
  const stored = job({
    status: '面试',
    statusHistory: [
      { fromStatus: null, toStatus: '收藏', changedAt: '2026-08-19T02:00:00.000Z' },
      { fromStatus: '收藏', toStatus: '面试', changedAt: '2026-08-24T02:00:00.000Z' },
    ],
    priority: 'S',
    appliedAt: '2026-08-20',
    nextStep: '准备二面',
    notes: '我的面试备注',
    referralUrl: 'https://example.com/referral',
    maintenanceStatus: '自动维护',
    userEditedAt: '2026-08-24T10:00:00.000Z',
    editedFields: ['notes', 'referralUrl', 'maintenanceStatus'],
  });
  const manual = job({ id: 'manual-job', title: '手动添加岗位', userEditedAt: '2026-08-24T11:00:00.000Z' });

  const [merged, preservedManual] = catalog.mergeCatalogJobs([initial], [stored, manual]);
  assert.equal(merged.title, initial.title);
  assert.equal(merged.url, initial.url);
  assert.equal(merged.recruitmentNote, initial.recruitmentNote);
  assert.equal(merged.status, '面试');
  assert.deepEqual(merged.statusHistory, stored.statusHistory);
  assert.equal(merged.priority, 'S');
  assert.equal(merged.appliedAt, '2026-08-20');
  assert.equal(merged.nextStep, '准备二面');
  assert.equal(merged.notes, '我的面试备注');
  assert.equal(merged.referralUrl, 'https://example.com/referral');
  assert.equal(merged.maintenanceStatus, '自动维护');
  assert.equal(preservedManual.id, 'manual-job');
  assert.equal(preservedManual.title, '手动添加岗位');
});

test('legacy catalog records remain without fabricated status dates', () => {
  assert.equal(catalog.normalizeJob(job()).statusHistory, undefined);
});

test('legacy edit without editedFields remains fully user-owned', () => {
  const initial = job({ title: '新版目录岗位名', url: 'https://example.com/new' });
  const legacyStored = job({
    title: '用户旧版自定义岗位名',
    url: 'https://example.com/custom',
    userEditedAt: '2026-08-20T09:00:00.000Z',
  });
  const [merged] = catalog.mergeCatalogJobs([initial], [legacyStored]);
  assert.equal(merged.title, legacyStored.title);
  assert.equal(merged.url, legacyStored.url);
});

test('an explicitly edited nextStep survives when workflow status is unchanged', () => {
  const initial = job({ nextStep: '新版目录默认建议' });
  const stored = job({
    nextStep: '用户自定义准备事项',
    userEditedAt: '2026-08-24T12:00:00.000Z',
    editedFields: ['nextStep'],
  });
  const [merged] = catalog.mergeCatalogJobs([initial], [stored]);
  assert.equal(merged.status, initial.status);
  assert.equal(merged.nextStep, stored.nextStep);
});

test('private application metadata survives removal from the public seed', () => {
  const initial = job({
    nextStep: '公开默认建议',
    notes: undefined,
    referralUrl: undefined,
    referralCode: undefined,
    referralNote: undefined,
  });
  const stored = job({
    nextStep: '本地准备事项',
    notes: '本地岗位备注',
    referralUrl: 'https://example.com/private-referral',
    referralCode: 'LOCAL-CODE',
    referralNote: '本地内推说明',
  });

  const [merged] = catalog.mergeCatalogJobs([initial], [stored]);
  assert.equal(merged.nextStep, stored.nextStep);
  assert.equal(merged.notes, stored.notes);
  assert.equal(merged.referralUrl, stored.referralUrl);
  assert.equal(merged.referralCode, stored.referralCode);
  assert.equal(merged.referralNote, stored.referralNote);
});
