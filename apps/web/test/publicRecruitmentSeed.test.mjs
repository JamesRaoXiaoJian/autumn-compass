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
const recruitment = await vite.ssrLoadModule('/src/data/recruitment.ts');

after(async () => {
  await vite.close();
});

test('public seed is limited to three companies and six backend roles', () => {
  const jobs = recruitment.initialJobs;
  const expectedCompanies = ['字节跳动', '小米集团', '美团'];
  const companyCounts = Object.fromEntries(
    expectedCompanies.map((company) => [company, jobs.filter((job) => job.company === company).length]),
  );

  assert.equal(jobs.length, 6);
  assert.deepEqual([...new Set(jobs.map((job) => job.company))].sort(), expectedCompanies.sort());
  assert.deepEqual(companyCounts, { 字节跳动: 2, 小米集团: 2, 美团: 2 });
  assert.equal(recruitment.retiredJobIdentities.length, 0);

  jobs.forEach((job) => {
    assert.match(job.title, /后端|服务端|服务器端/u);
    assert.match(job.type, /2027.*全职/u);
    assert.doesNotMatch(`${job.title} ${job.type}`, /实习|社招|博士后/u);
    assert.equal(job.linkType, '具体岗位');
    assert.equal(job.recruitmentStatus, '已开放');
    assert.equal(job.maintenanceStatus, '无需维护');
    assert.match(job.url, /^https:\/\//u);
    assert.equal(job.referralUrl, undefined);
    assert.equal(job.referralCode, undefined);
    assert.equal(job.referralNote, undefined);
  });
});
