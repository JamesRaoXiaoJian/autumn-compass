import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

const source = await readFile(new URL('../src/lib/markdownPolicy.ts', import.meta.url), 'utf8');
const { code } = await transformWithOxc(source, 'markdownPolicy.ts');
const policy = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('Markdown links and images accept safe web and relative URLs', () => {
  assert.equal(policy.normalizeMarkdownUrl(' https://Example.com/jobs/42 ', 'link'), 'https://example.com/jobs/42');
  assert.equal(policy.normalizeMarkdownUrl('http://example.com/diagram.png', 'image'), 'http://example.com/diagram.png');
  assert.equal(policy.normalizeMarkdownUrl('mailto:test@example.com', 'link'), 'mailto:test@example.com');
  assert.equal(policy.normalizeMarkdownUrl('#evidence-1', 'link'), '#evidence-1');
  assert.equal(policy.normalizeMarkdownUrl('/assets/diagram.svg', 'image'), '/assets/diagram.svg');
  assert.equal(policy.normalizeMarkdownUrl('./diagram.svg', 'image'), './diagram.svg');
});

test('Markdown URLs reject executable, local, protocol-relative, and malformed values', () => {
  const unsafeUrls = [
    'javascript:alert(1)',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'file:///etc/passwd',
    'blob:https://example.com/id',
    'ftp://example.com/file',
    '//example.com/tracker.png',
    'https:\\example.com\\tracker.png',
    'java\u0000script:alert(1)',
  ];

  for (const url of unsafeUrls) {
    assert.equal(policy.normalizeMarkdownUrl(url, 'link'), null, url);
    assert.equal(policy.normalizeMarkdownUrl(url, 'image'), null, url);
  }

  assert.equal(policy.normalizeMarkdownUrl('mailto:test@example.com', 'image'), null);
  assert.equal(policy.normalizeMarkdownUrl('#figure', 'image'), null);
});

test('Markdown URL transform uses separate link and image policies', () => {
  assert.equal(policy.markdownUrlTransform('https://example.com/jobs/42', 'href'), 'https://example.com/jobs/42');
  assert.equal(policy.markdownUrlTransform('javascript:alert(1)', 'href'), '');
  assert.equal(policy.markdownUrlTransform('data:image/png;base64,AAAA', 'src'), '');
  assert.equal(policy.markdownUrlTransform('https://example.com/figure.png', 'src'), 'https://example.com/figure.png');
  assert.equal(policy.markdownUrlTransform('value', 'unknown'), '');
});

test('Markdown titles and previews remove block markers without discarding inline formatting', () => {
  assert.equal(
    policy.normalizeMarkdownTitle('  # **后端项目证据簿** `$p_{99}$`\n补充  '),
    '**后端项目证据簿** `$p_{99}$` 补充',
  );

  const preview = policy.normalizeMarkdownPreview(`
## 核心证据

| 维度 | 结论 |
| --- | --- |
| 分布式系统 | 相关 |

\`\`\`ts
const unsafeDetail = '<script>';
\`\`\`

![架构图](https://example.com/diagram.png)

$$a_t = \\pi(o_t)$$
`);

  assert.equal(preview.includes('#'), false);
  assert.equal(preview.includes('|'), false);
  assert.equal(preview.includes('https://'), false);
  assert.equal(preview.includes('代码片段'), true);
  assert.equal(preview.includes('架构图'), true);
  assert.equal(preview.includes('公式'), true);
});
