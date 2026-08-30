(() => {
  if (window.__autumnCompassLoaded) return;
  window.__autumnCompassLoaded = true;

  const rules = [
    { key: 'idNumber', patterns: [/身份证/, /证件号码?/, /identity.?number/, /id.?card/, /national.?id/] },
    { key: 'currentCity', patterns: [/现居/, /当前.*城市/, /居住.*城市/, /current.*(city|location)/, /residen/] },
    { key: 'availableDate', patterns: [/到岗/, /入职日期/, /available.*date/, /start.*date/, /earliest.*start/] },
    { key: 'expectedSalary', patterns: [/期望薪资/, /预期薪资/, /expected.*salary/, /salary.*expect/, /期望月薪/] },
    { key: 'graduationYear', patterns: [/毕业.*(时间|年份|日期)/, /graduat.*(year|date)/, /completion.*date/] },
    { key: 'targetRole', patterns: [/目标岗位/, /求职意向/, /意向职位/, /desired.*(role|position)/, /target.*(role|position)/] },
    { key: 'skills', patterns: [/专业技能/, /技能特长/, /技术栈/, /technical.*skills/, /^skills$/] },
    { key: 'workAuthorization', patterns: [/工作许可/, /工作资格/, /签证状态/, /work.*authori/, /visa.*status/, /right.*to.*work/] },
    { key: 'linkedin', patterns: [/linkedin/] },
    { key: 'github', patterns: [/github/, /代码仓库/] },
    { key: 'website', patterns: [/个人.*(网站|主页|作品集)/, /portfolio/, /personal.*(site|website|url)/, /homepage/] },
    { key: 'birthday', patterns: [/出生日期/, /生日/, /birth.*(day|date)/, /date.*of.*birth/, /dob/] },
    { key: 'phone', patterns: [/手机/, /联系电话/, /电话号码/, /phone/, /mobile/, /tel\b/] },
    { key: 'email', patterns: [/电子邮箱/, /邮箱/, /e.?mail/] },
    { key: 'school', patterns: [/毕业院校/, /学校名称/, /就读学校/, /院校/, /university/, /college/, /school/] },
    { key: 'major', patterns: [/所学专业/, /专业名称/, /major/, /专业/] },
    { key: 'degree', patterns: [/最高学历/, /学历层次/, /学位/, /degree/, /education.*level/] },
    { key: 'gender', patterns: [/性别/, /gender/, /sex\b/] },
    { key: 'city', patterns: [/期望.*(城市|地点)/, /意向.*(城市|地点)/, /工作地点/, /preferred.*(city|location)/, /location.*preference/] },
    { key: 'summary', patterns: [/个人简介/, /自我介绍/, /自我评价/, /summary/, /about.*(you|me)/, /bio/, /profile/] },
    { key: 'fullName', patterns: [/^姓名$/, /姓名/, /真实姓名/, /full.?name/, /candidate.?name/, /^name$/] },
  ];

  const normalize = (value) => String(value || '')
    .toLowerCase()
    .replace(/[\s_\-:：*（）()【】\[\].]/g, '');

  function textFor(element) {
    const parts = [
      element.name,
      element.id,
      element.placeholder,
      element.getAttribute('aria-label'),
      element.getAttribute('autocomplete'),
      element.getAttribute('data-field'),
      element.getAttribute('data-testid'),
    ];
    if (element.labels) parts.push(...Array.from(element.labels).map((label) => label.innerText));
    const closestLabel = element.closest('label');
    if (closestLabel) parts.push(closestLabel.innerText);
    const container = element.closest('.form-item, .form-group, .field, [class*="formItem"], [class*="form-item"]');
    if (container) {
      const label = container.querySelector('label, .label, [class*="label"]');
      if (label) parts.push(label.textContent);
    }
    const previous = element.previousElementSibling;
    if (previous && previous.textContent && previous.textContent.length < 80) parts.push(previous.textContent);
    return parts.filter(Boolean).join(' ');
  }

  function infer(element) {
    const raw = textFor(element);
    const normalized = normalize(raw);
    let best = { key: null, confidence: 0 };
    for (const rule of rules) {
      for (const pattern of rule.patterns) {
        const rawMatch = raw.toLowerCase().match(pattern);
        const normalizedMatch = normalized.match(pattern);
        if (!rawMatch && !normalizedMatch) continue;
        const matchText = (rawMatch || normalizedMatch)[0];
        let score = 72;
        if (normalize(matchText) === normalized) score = 98;
        else if (normalized.length <= normalize(matchText).length + 5) score = 92;
        else if (element.name && normalize(element.name).includes(normalize(matchText))) score = 88;
        if (score > best.confidence) best = { key: rule.key, confidence: score };
      }
    }
    const autocomplete = (element.getAttribute('autocomplete') || '').toLowerCase();
    const autoMap = { name: 'fullName', tel: 'phone', email: 'email', bday: 'birthday', 'address-level2': 'currentCity', url: 'website' };
    if (autoMap[autocomplete] && best.confidence < 95) best = { key: autoMap[autocomplete], confidence: 96 };
    return { ...best, label: raw.trim().replace(/\s+/g, ' ').slice(0, 90) || element.tagName.toLowerCase() };
  }

  function eligibleFields() {
    const fields = Array.from(document.querySelectorAll('input, textarea, select, [contenteditable="true"]'));
    const seenRadioGroups = new Set();
    return fields.filter((element) => {
      if (element.disabled || element.readOnly) return false;
      if (element instanceof HTMLInputElement) {
        const type = element.type.toLowerCase();
        if (['hidden', 'password', 'file', 'submit', 'button', 'reset', 'image'].includes(type)) return false;
        if (/captcha|验证码|verification.?code/i.test(textFor(element))) return false;
        if (type === 'radio' && element.name) {
          if (seenRadioGroups.has(element.name)) return false;
          seenRadioGroups.add(element.name);
        }
        if (type === 'checkbox') return false;
      }
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  function currentValue(element) {
    if (element instanceof HTMLInputElement && element.type === 'radio') {
      const group = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(element.name)}"]`);
      return Array.from(group).some((radio) => radio.checked);
    }
    if (element.isContentEditable) return element.innerText.trim();
    return String(element.value || '').trim();
  }

  function nativeSet(element, value) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
  }

  function emit(element) {
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function bestOption(select, rawValue) {
    const wanted = normalize(rawValue);
    const aliases = {
      男: ['男', 'male', 'm'], 女: ['女', 'female', 'f'],
      本科: ['本科', 'bachelor', 'undergraduate'], 硕士: ['硕士', 'master', 'postgraduate'], 博士: ['博士', 'phd', 'doctor'],
    };
    const candidates = [rawValue, ...(aliases[rawValue] || [])].map(normalize);
    return Array.from(select.options).find((option) => candidates.includes(normalize(option.value)) || candidates.includes(normalize(option.text)))
      || Array.from(select.options).find((option) => candidates.some((value) => normalize(option.text).includes(value) || value.includes(normalize(option.text))))
      || Array.from(select.options).find((option) => normalize(option.value).includes(wanted));
  }

  function setRadio(element, rawValue) {
    if (!element.name) return false;
    const wanted = normalize(rawValue);
    const groups = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(element.name)}"]`));
    const aliases = rawValue === '男' ? ['男', 'male', 'm'] : rawValue === '女' ? ['女', 'female', 'f'] : [rawValue];
    const wantedValues = aliases.map(normalize);
    const target = groups.find((radio) => {
      const label = radio.labels ? Array.from(radio.labels).map((item) => item.innerText).join(' ') : '';
      const candidate = normalize(`${radio.value} ${label} ${radio.closest('label')?.innerText || ''}`);
      return wantedValues.some((value) => candidate === value || candidate.includes(value)) || candidate.includes(wanted);
    });
    if (!target) return false;
    target.click();
    emit(target);
    return true;
  }

  function setField(element, rawValue) {
    const value = String(rawValue);
    if (element instanceof HTMLSelectElement) {
      const option = bestOption(element, value);
      if (!option) return false;
      element.value = option.value;
      emit(element);
      return true;
    }
    if (element instanceof HTMLInputElement && element.type === 'radio') return setRadio(element, value);
    if (element.isContentEditable) {
      element.focus();
      element.innerText = value;
      emit(element);
      return true;
    }
    let finalValue = value;
    if (element instanceof HTMLInputElement) {
      if (element.type === 'date') finalValue = value.slice(0, 10);
      if (element.type === 'month' && /^\d{4}/.test(value)) finalValue = value.slice(0, 7);
      nativeSet(element, finalValue);
    } else if (element instanceof HTMLTextAreaElement) nativeSet(element, finalValue);
    else return false;
    emit(element);
    return true;
  }

  function highlight(element, success) {
    const target = element.closest('.form-item, .form-group, .field') || element;
    const previousOutline = target.style.outline;
    const previousOffset = target.style.outlineOffset;
    target.style.outline = `2px solid ${success ? '#5c67d9' : '#e09a54'}`;
    target.style.outlineOffset = '2px';
    target.style.transition = 'outline-color .2s ease';
    window.setTimeout(() => {
      target.style.outline = previousOutline;
      target.style.outlineOffset = previousOffset;
    }, 2300);
  }

  function scan() {
    const fields = eligibleFields().map((element) => {
      const match = infer(element);
      return {
        element,
        key: match.key,
        label: match.label,
        confidence: match.confidence,
        valuePresent: Boolean(currentValue(element)),
        tag: element instanceof HTMLInputElement ? `input:${element.type}` : element.tagName.toLowerCase(),
      };
    });
    return fields;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'SCAN_FORM') {
      const fields = scan();
      sendResponse({
        ok: true,
        total: fields.length,
        matched: fields.filter((field) => field.key).length,
        fields: fields.map(({ element: _element, ...field }) => field),
      });
      return;
    }

    if (message?.type === 'AUTOFILL') {
      const fields = scan();
      let filled = 0;
      let skipped = 0;
      for (const field of fields) {
        if (!field.key || !message.profile?.[field.key]) {
          skipped += 1;
          if (message.settings?.highlight && !field.key) highlight(field.element, false);
          continue;
        }
        if (message.settings?.onlyEmpty && currentValue(field.element)) {
          skipped += 1;
          continue;
        }
        const success = setField(field.element, message.profile[field.key]);
        if (success) filled += 1;
        else skipped += 1;
        if (message.settings?.highlight) highlight(field.element, success);
      }
      sendResponse({
        ok: true,
        total: fields.length,
        matched: fields.filter((field) => field.key).length,
        filled,
        skipped,
        fields: fields.map(({ element: _element, ...field }) => field),
      });
      return;
    }
  });
})();
