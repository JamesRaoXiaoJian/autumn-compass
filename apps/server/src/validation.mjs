import { Buffer } from 'node:buffer';

export const limits = Object.freeze({
  // A 12 MiB workspace is embedded as JSON strings during full restore, so
  // escaping can make the HTTP body materially larger than the raw values.
  maxBodyBytes: 32 * 1024 * 1024,
  maxItems: 512,
  maxKeyBytes: 256,
  // Interview-note archives share one canonical key and now exceed 4 MiB;
  // retain a bounded ceiling below the 12 MiB whole-workspace limit.
  maxValueBytes: 8 * 1024 * 1024,
  maxWorkspaceBytes: 12 * 1024 * 1024,
  maxClientIdBytes: 128,
});

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const isPlainObject = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
);

const assertExactFields = (value, required, optional = []) => {
  if (!isPlainObject(value)) {
    throw new HttpError(400, 'INVALID_BODY', '请求体必须是 JSON 对象。');
  }

  const allowed = new Set([...required, ...optional]);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new HttpError(400, 'UNKNOWN_FIELD', `不支持的字段：${field}`);
    }
  }
  for (const field of required) {
    if (!Object.hasOwn(value, field)) {
      throw new HttpError(400, 'MISSING_FIELD', `缺少必填字段：${field}`);
    }
  }
};

export const validateKey = (key) => {
  if (typeof key !== 'string' || !key.startsWith('autumn-compass-') || key.length === 'autumn-compass-'.length) {
    throw new HttpError(400, 'INVALID_KEY', '键必须是非空的 autumn-compass-* 字符串。');
  }
  if (/[\u0000-\u001f\u007f]/u.test(key)) {
    throw new HttpError(400, 'INVALID_KEY', '键不能包含控制字符。');
  }
  if (Buffer.byteLength(key, 'utf8') > limits.maxKeyBytes) {
    throw new HttpError(413, 'KEY_TOO_LARGE', `键不能超过 ${limits.maxKeyBytes} 字节。`);
  }
  return key;
};

export const validateValue = (value) => {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'INVALID_VALUE', 'workspace 值必须是字符串。');
  }
  if (Buffer.byteLength(value, 'utf8') > limits.maxValueBytes) {
    throw new HttpError(413, 'VALUE_TOO_LARGE', `单个值不能超过 ${limits.maxValueBytes} 字节。`);
  }
  return value;
};

export const validateItems = (items) => {
  if (!isPlainObject(items)) {
    throw new HttpError(400, 'INVALID_ITEMS', 'items 必须是键值对象。');
  }

  const entries = Object.entries(items);
  if (entries.length > limits.maxItems) {
    throw new HttpError(413, 'TOO_MANY_ITEMS', `workspace 最多包含 ${limits.maxItems} 条记录。`);
  }

  let totalBytes = 0;
  const normalized = Object.create(null);
  for (const [key, value] of entries) {
    validateKey(key);
    validateValue(value);
    totalBytes += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8');
    if (totalBytes > limits.maxWorkspaceBytes) {
      throw new HttpError(413, 'WORKSPACE_TOO_LARGE', `workspace 总大小不能超过 ${limits.maxWorkspaceBytes} 字节。`);
    }
    normalized[key] = value;
  }

  return normalized;
};

export const validateClientId = (clientId) => {
  if (typeof clientId !== 'string' || clientId.trim().length === 0) {
    throw new HttpError(400, 'INVALID_CLIENT_ID', 'clientId 必须是非空字符串。');
  }
  if (/[\u0000-\u001f\u007f]/u.test(clientId) || Buffer.byteLength(clientId, 'utf8') > limits.maxClientIdBytes) {
    throw new HttpError(400, 'INVALID_CLIENT_ID', `clientId 不能包含控制字符且不能超过 ${limits.maxClientIdBytes} 字节。`);
  }
  return clientId;
};

export const validateBaseRevision = (baseRevision) => {
  if (baseRevision === undefined) return undefined;
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    throw new HttpError(400, 'INVALID_REVISION', 'baseRevision 必须是非负安全整数。');
  }
  return baseRevision;
};

export const parseBootstrapBody = (body) => {
  assertExactFields(body, ['items', 'clientId']);
  return {
    items: validateItems(body.items),
    clientId: validateClientId(body.clientId),
  };
};

export const parseItemBody = (body) => {
  assertExactFields(body, ['key', 'value', 'clientId'], ['baseRevision']);
  return {
    key: validateKey(body.key),
    value: validateValue(body.value),
    clientId: validateClientId(body.clientId),
    baseRevision: validateBaseRevision(body.baseRevision),
  };
};

export const parseDeleteBody = (body) => {
  assertExactFields(body, ['key', 'clientId'], ['baseRevision']);
  return {
    key: validateKey(body.key),
    clientId: validateClientId(body.clientId),
    baseRevision: validateBaseRevision(body.baseRevision),
  };
};

export const parseReplaceBody = (body) => {
  assertExactFields(body, ['items', 'clientId'], ['baseRevision']);
  return {
    items: validateItems(body.items),
    clientId: validateClientId(body.clientId),
    baseRevision: validateBaseRevision(body.baseRevision),
  };
};

export const readJsonBody = (request) => {
  const contentType = request.headers['content-type'] ?? '';
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type 必须是 application/json。');
  }

  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > limits.maxBodyBytes) {
    throw new HttpError(413, 'BODY_TOO_LARGE', `请求体不能超过 ${limits.maxBodyBytes} 字节。`);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    request.on('data', (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > limits.maxBodyBytes) {
        fail(new HttpError(413, 'BODY_TOO_LARGE', `请求体不能超过 ${limits.maxBodyBytes} 字节。`));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw.trim().length === 0) {
          throw new HttpError(400, 'EMPTY_BODY', '请求体不能为空。');
        }
        resolve(JSON.parse(raw));
      } catch (error) {
        if (error instanceof HttpError) reject(error);
        else reject(new HttpError(400, 'INVALID_JSON', '请求体不是有效 JSON。'));
      }
    });
    request.on('error', (error) => fail(new HttpError(400, 'REQUEST_ERROR', error.message)));
    request.on('aborted', () => fail(new HttpError(400, 'REQUEST_ABORTED', '请求在完成前中止。')));
  });
};
