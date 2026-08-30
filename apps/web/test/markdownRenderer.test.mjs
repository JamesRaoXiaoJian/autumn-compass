import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({
  root: webRoot,
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
});
const { MarkdownPreview, MarkdownRenderer, MarkdownTitle } = await vite.ssrLoadModule('/src/components/MarkdownRenderer.tsx');

after(async () => {
  await vite.close();
});

function render(Component, source) {
  return renderToStaticMarkup(createElement(Component, { source }));
}

function count(html, pattern) {
  return html.match(pattern)?.length ?? 0;
}

test('document Markdown renders GFM, fenced code, formulas, and images', () => {
  const html = render(MarkdownRenderer, `
# 岗位判断总览

包含 **粗体**、~~删除线~~、\`service.handle()\` 和 [岗位链接](https://example.com/jobs/backend)。

- [x] 已核验职责
- [ ] 待核验团队

| 维度 | 岗位 A | 结论 |
| :--- | :---: | ---: |
| 分布式系统 | 直接相关 | 保留 |

\`\`\`ts
export const result = await service.handle(request);
\`\`\`

内联公式 $QPS = N / t$。

$$
P_{99} = \\operatorname{quantile}_{0.99}(T)
$$

![后端服务数据流](/assets/backend-flow.svg "架构图")
`);

  assert.match(html, /<h3[^>]*markdown-heading--1/);
  assert.match(html, /<strong>粗体<\/strong>/);
  assert.match(html, /<del>删除线<\/del>/);
  assert.match(html, /class="contains-task-list"/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /class="markdown-table-scroll"/);
  assert.match(html, /<table>/);
  assert.match(html, /class="language-ts"/);
  assert.match(html, /markdown-code-block__language">ts/);
  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-display"/);
  assert.match(html, /<math xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML"/);
  assert.match(html, /src="\/assets\/backend-flow\.svg"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /decoding="async"/);
  assert.match(html, /referrerPolicy="no-referrer"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noreferrer noopener"/);
});

test('title Markdown stays inline and removes nested interactions', () => {
  const html = render(
    MarkdownTitle,
    '# **后端项目证据簿** [岗位](https://example.com/jobs/backend) `service` $p_{99}$ ![图](https://example.com/figure.png)',
  );

  assert.match(html, /^<span class="markdown-inline">/);
  assert.match(html, /<strong>后端项目证据簿<\/strong>/);
  assert.match(html, /<code>service<\/code>/);
  assert.match(html, /class="katex"/);
  assert.equal(/<(?:p|h[1-6]|ul|ol|li|table|pre|a|img|input)\b/u.test(html), false);
  assert.equal(html.includes('https://example.com'), false);
});

test('preview Markdown removes noisy block syntax and remains non-interactive', () => {
  const html = render(MarkdownPreview, `
## 对比
| 岗位 | 结论 |
| --- | --- |
| A | **保留** |

\`\`\`ts
const detail = 'long';
\`\`\`
`);

  assert.match(html, /对比/);
  assert.match(html, /<strong>保留<\/strong>/);
  assert.match(html, /代码片段/);
  assert.equal(html.includes('|'), false);
  assert.equal(/<(?:p|table|pre|a|img|input)\b/u.test(html), false);
});

test('raw HTML and unsafe URLs cannot create executable or remote-loading nodes', () => {
  const html = render(MarkdownRenderer, `
<script>alert('raw')</script>

<img src="x" onerror="alert('raw image')">

[危险链接](javascript:alert('link'))

![危险图片](data:image/svg+xml,%3Csvg%20onload%3Dalert(1)%3E)
`);

  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('onerror'), false);
  assert.equal(html.includes('javascript:'), false);
  assert.equal(html.includes('data:image'), false);
  assert.equal(html.includes('href='), false);
  assert.equal(html.includes('src='), false);
  assert.match(html, /markdown-link--blocked/);
  assert.match(html, /markdown-image--blocked/);
});

test('invalid formulas stay contained instead of crashing the note reader', () => {
  const html = render(MarkdownRenderer, '无效公式：$\\notARealCommand{$');
  assert.match(html, /markdown-body/);
  assert.match(html, /katex-error/);
});

test('standalone multiline square brackets render as one display formula', () => {
  const html = render(MarkdownRenderer, String.raw`[
|\widehat Y-Y|
\le
|E_X|,|W^\top|
+|X|,|E_W^\top|
+|E_X|,|E_W^\top|.
]`);

  assert.equal(count(html, /class="katex-display"/gu), 1);
  assert.equal(count(html, /<annotation encoding="application\/x-tex">/gu), 1);
  assert.match(html, /<math[^>]*display="block"/u);
  assert.match(html, /\\widehat Y-Y/u);
  assert.match(html, /E_W\^\\top/u);
  assert.doesNotMatch(html, /katex-error/u);
});

test('LaTeX bracket delimiters render multiline display formulas', () => {
  const html = render(MarkdownRenderer, String.raw`\[
x_{t+1}=\pi_\theta(o_t)
\]`);

  assert.equal(count(html, /class="katex-display"/gu), 1);
  assert.equal(count(html, /<annotation encoding="application\/x-tex">/gu), 1);
  assert.match(html, /<math[^>]*display="block"/u);
  assert.doesNotMatch(html, /katex-error/u);
});

test('clear bare TeX identifiers render inline without rewriting surrounding prose', () => {
  const html = render(
    MarkdownRenderer,
    String.raw`累计误差E_{\mathrm{acc}}与投影W^\top需要控制。`,
  );

  assert.equal(count(html, /class="katex"/gu), 2);
  assert.equal(count(html, /class="katex-display"/gu), 0);
  assert.match(html, /<annotation encoding="application\/x-tex">E_\{\\mathrm\{acc\}\}<\/annotation>/u);
  assert.match(html, /累计误差/u);
  assert.match(html, /需要控制/u);
});

test('compatibility math inference leaves code and links untouched', () => {
  const inlineHtml = render(MarkdownRenderer, '行内代码 `E_{\\mathrm{acc}}` 不转换。');
  const fencedHtml = render(MarkdownRenderer, [
    '```tex',
    '[',
    String.raw`E_{\mathrm{acc}}`,
    ']',
    '```',
  ].join('\n'));
  const linkHtml = render(
    MarkdownRenderer,
    String.raw`[E_{\mathrm{acc}} 文档](https://example.com/docs/E_acc?job_code=1)`,
  );

  assert.ok(inlineHtml.includes('<code>E_{\\mathrm{acc}}</code>'));
  assert.doesNotMatch(inlineHtml, /class="katex/u);
  assert.match(fencedHtml, /class="language-tex"/u);
  assert.doesNotMatch(fencedHtml, /class="katex/u);
  assert.match(linkHtml, /href="https:\/\/example\.com\/docs\/E_acc\?job_code=1"/u);
  assert.doesNotMatch(linkHtml, /class="katex/u);
});

test('compatibility math inference rejects ordinary underscores and bracketed prose', () => {
  const html = render(MarkdownRenderer, String.raw`snake_case、job_code、notes_v2.md、E_acc，_仍然是强调_。

[
这是一段普通说明
]`);

  assert.doesNotMatch(html, /class="katex/u);
  assert.match(html, /snake_case/u);
  assert.match(html, /job_code/u);
  assert.match(html, /<em>仍然是强调<\/em>/u);
  assert.match(html, /这是一段普通说明/u);
});
