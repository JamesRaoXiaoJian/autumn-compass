import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildRecruitmentMaintenanceScope,
  recruitmentMaintenanceScopeFilename,
  recruitmentWorkspaceKeys,
  writeRecruitmentMaintenanceScopeAtomic,
} from '../src/recruitment-maintenance-scope.mjs';

test('maintenance scope includes only recruitment data and tombstones', () => {
  const scope = buildRecruitmentMaintenanceScope({
    revision: 7,
    updatedAt: '2026-08-21T06:30:00.000Z',
    initialized: true,
    items: {
      [recruitmentWorkspaceKeys.jobs]: JSON.stringify([
        {
          id: 'target-example',
          company: '示例云科',
          title: '后端开发工程师',
          department: '平台研发',
          location: '深圳',
          url: 'https://jobs.example/position/1',
          referralUrl: 'https://example.com/private-referral',
          referralCode: 'LOCAL-ONLY-CODE',
          tags: ['Java', 2, '分布式系统'],
          recruitmentStatus: '已开放',
          maintenanceStatus: '无需维护',
          status: '已投递',
          statusHistory: [{ fromStatus: '收藏', toStatus: '已投递', changedAt: '2026-08-21T02:00:00.000Z' }],
          priority: 'S',
          appliedAt: '2026-08-21',
          nextStep: '准备面试',
          notes: '私人准备笔记',
          referralNote: '私人内推联系人说明',
          recruitmentNote: '用户自由填写的招聘备注',
          dateSourceNote: '用户自由填写的日期备注',
        },
        {
          id: 'job-user-created',
          company: '手动公司',
          title: '手动岗位',
          status: '收藏',
          userEditedAt: '2026-08-21T06:00:00.000Z',
          editedFields: ['company', 'notes'],
        },
      ]),
      [recruitmentWorkspaceKeys.deletedJobIds]: JSON.stringify(['target-deleted', 'target-deleted', '', 1]),
      [recruitmentWorkspaceKeys.deletedJobFingerprints]: JSON.stringify([
        'code:示例云科:abc-1',
        'code:示例云科:abc-1',
        'url:https://jobs.example/position/2',
      ]),
      'autumn-compass-resume-document': JSON.stringify({ profile: { phone: 'private-resume-value' } }),
      'autumn-compass-notes': JSON.stringify([{ body: 'private note' }]),
    },
  }, '2026-08-21T06:31:00.000Z');

  assert.equal(scope.workspaceRevision, 7);
  assert.equal(scope.version, 2);
  assert.equal(scope.generatedAt, '2026-08-21T06:31:00.000Z');
  assert.equal(scope.jobs.length, 2);
  assert.deepEqual({ ...scope.jobs[0] }, {
    id: 'target-example',
    company: '示例云科',
    title: '后端开发工程师',
    department: '平台研发',
    location: '深圳',
    url: 'https://jobs.example/position/1',
    tags: ['Java', '分布式系统'],
    recruitmentStatus: '已开放',
    maintenanceStatus: '无需维护',
    userMaintained: false,
  });
  assert.equal(scope.jobs[1].userMaintained, true);
  for (const forbidden of [
    'status', 'statusHistory', 'priority', 'appliedAt', 'nextStep', 'notes', 'referralUrl', 'referralCode', 'referralNote',
    'recruitmentNote', 'dateSourceNote', 'userEditedAt', 'editedFields',
  ]) {
    assert.equal(Object.hasOwn(scope.jobs[0], forbidden), false);
    assert.equal(Object.hasOwn(scope.jobs[1], forbidden), false);
  }
  assert.deepEqual(scope.deletedJobIds, ['target-deleted']);
  assert.deepEqual(scope.deletedJobFingerprints, [
    'code:示例云科:abc-1',
    'url:https://jobs.example/position/2',
  ]);
  const serialized = JSON.stringify(scope);
  assert.doesNotMatch(serialized, /private-resume-value|private-referral|LOCAL-ONLY-CODE|private note|私人准备笔记|私人内推联系人|自由填写/u);
});

test('maintenance scope file is replaced atomically with private permissions', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'autumn-compass-scope-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, recruitmentMaintenanceScopeFilename);

  writeRecruitmentMaintenanceScopeAtomic(filePath, { version: 1, workspaceRevision: 1, jobs: [] });
  writeRecruitmentMaintenanceScopeAtomic(filePath, { version: 1, workspaceRevision: 2, jobs: [{ id: 'new' }] });

  assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).workspaceRevision, 2);
  assert.deepEqual(fs.readdirSync(directory), [recruitmentMaintenanceScopeFilename]);
  if (process.platform !== 'win32') assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
});
