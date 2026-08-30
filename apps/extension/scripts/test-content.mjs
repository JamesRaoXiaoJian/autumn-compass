import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const manifest = JSON.parse(await readFile(new URL('../public/manifest.json', import.meta.url), 'utf8'));
assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'scripting', 'storage']);
assert.equal(manifest.host_permissions, undefined, 'extension must not request persistent host access');
assert.equal(manifest.content_scripts, undefined, 'content script must be injected only after a user action');

const html = `<!doctype html><html><body>
  <form>
    <div class="form-group"><label for="candidate-name">姓名</label><input id="candidate-name" name="candidateName" /></div>
    <div class="form-group"><label for="mobile">手机号</label><input id="mobile" placeholder="请输入联系电话" /></div>
    <div class="form-group"><label for="email">电子邮箱</label><input id="email" type="email" value="keep@example.com" /></div>
    <div class="form-group"><span class="label">性别</span><label><input type="radio" name="gender" value="male" />男</label><label><input type="radio" name="gender" value="female" />女</label></div>
    <div class="form-group"><label for="school">毕业院校</label><input id="school" /></div>
    <div class="form-group"><label for="degree">最高学历</label><select id="degree"><option value="">请选择</option><option value="bachelor">本科</option><option value="master">硕士</option></select></div>
    <div class="form-group"><label for="summary">个人简介</label><textarea id="summary"></textarea></div>
    <input type="password" name="password" />
    <input name="captcha" placeholder="验证码" />
  </form>
</body></html>`;

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://careers.example.com/apply' });
let messageListener;
dom.window.chrome = { runtime: { onMessage: { addListener(listener) { messageListener = listener; } } } };
dom.window.CSS ??= {};
dom.window.CSS.escape ??= (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');

const source = await readFile(new URL('../public/content.js', import.meta.url), 'utf8');
dom.window.eval(source);
assert.equal(typeof messageListener, 'function', 'content script should register a message listener');

const send = (message) => new Promise((resolve) => messageListener(message, {}, resolve));
const scan = await send({ type: 'SCAN_FORM' });
assert.equal(scan.ok, true);
assert.equal(scan.total, 7, 'password and captcha fields should be ignored');
assert.ok(scan.matched >= 7, `expected all fixture fields to match, received ${scan.matched}`);

let inputEvents = 0;
dom.window.document.querySelector('#candidate-name').addEventListener('input', () => { inputEvents += 1; });
const fill = await send({
  type: 'AUTOFILL',
  profile: {
    fullName: '林知远', phone: '00000000000', email: 'new@example.com', gender: '男', school: '示例大学',
    degree: '本科', summary: '热爱产品与技术。',
  },
  settings: { onlyEmpty: true, highlight: false },
});

assert.equal(fill.filled, 6, 'six empty fields should be filled');
assert.equal(dom.window.document.querySelector('#candidate-name').value, '林知远');
assert.equal(dom.window.document.querySelector('#mobile').value, '00000000000');
assert.equal(dom.window.document.querySelector('#email').value, 'keep@example.com', 'existing content should remain');
assert.equal(dom.window.document.querySelector('input[value="male"]').checked, true);
assert.equal(dom.window.document.querySelector('#degree').value, 'bachelor');
assert.equal(dom.window.document.querySelector('#summary').value, '热爱产品与技术。');
assert.equal(inputEvents, 1, 'framework-compatible input event should fire');

console.log(`content-script test passed: ${scan.matched}/${scan.total} matched, ${fill.filled} filled`);
