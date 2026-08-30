import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WorkspaceDatabase } from './database.mjs';
import { RecruitmentMaintenanceScope } from './recruitment-maintenance-scope.mjs';
import {
  HttpError,
  parseBootstrapBody,
  parseDeleteBody,
  parseItemBody,
  parseReplaceBody,
  readJsonBody,
} from './validation.mjs';

// The workspace contains resume PII. Restrict SQLite, WAL, SHM, and any other
// files created by this process even when a custom database directory is used.
process.umask(0o077);

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const serverDirectory = path.resolve(moduleDirectory, '..');
const defaultDataRoot = process.platform === 'win32'
  ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
  : (process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'));
const defaultDatabasePath = path.join(defaultDataRoot, 'autumn-compass', 'workspace.sqlite');
const host = process.env.AUTUMN_COMPASS_API_HOST || process.env.AUTUMN_COMPASS_SERVER_HOST || '127.0.0.1';
const port = Number(process.env.AUTUMN_COMPASS_API_PORT || process.env.AUTUMN_COMPASS_SERVER_PORT || 4174);
const databasePath = path.resolve(process.env.AUTUMN_COMPASS_DB_PATH || defaultDatabasePath);
const staticDirectory = path.resolve(process.env.AUTUMN_COMPASS_WEB_DIST || path.join(serverDirectory, '..', 'web', 'dist'));
const serveWeb = /^(?:1|true|yes)$/iu.test(process.env.AUTUMN_COMPASS_SERVE_WEB || '')
  || Boolean(process.env.AUTUMN_COMPASS_WEB_DIST);

if (host !== '127.0.0.1') {
  throw new Error('AUTUMN_COMPASS_API_HOST 必须是 127.0.0.1；请通过 VS Code 或 SSH 端口转发跨设备访问。');
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('AUTUMN_COMPASS_API_PORT 必须是 1–65535 的整数。');
}
if (serveWeb && !fs.existsSync(path.join(staticDirectory, 'index.html'))) {
  throw new Error(`启用了 Web 托管，但找不到 ${path.join(staticDirectory, 'index.html')}`);
}

const workspace = new WorkspaceDatabase(databasePath, {
  enforcePrivateDirectory: !process.env.AUTUMN_COMPASS_DB_PATH,
});
const recruitmentMaintenanceScope = new RecruitmentMaintenanceScope(
  databasePath,
  () => workspace.snapshot(),
);
const eventClients = new Set();

const refreshRecruitmentMaintenanceScope = () => {
  try {
    return recruitmentMaintenanceScope.refresh();
  } catch (error) {
    // The SQLite mutation is already committed at this point, so reporting the
    // request as failed would invite an unsafe retry. Keep the workspace
    // authoritative and make the projection failure visible in server logs.
    console.error('无法刷新脱敏招聘维护投影：', error);
    return null;
  }
};
refreshRecruitmentMaintenanceScope();

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
};

const isAllowedHost = (hostHeader) => {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false;
  try {
    const { hostname } = new URL(`http://${hostHeader}`);
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
};

const applyCommonHeaders = (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Vary', 'Origin');
  const origin = request.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Last-Event-ID, Cache-Control');
  }
};

const sendJson = (request, response, status, payload, extraHeaders = {}) => {
  applyCommonHeaders(request, response);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
};

const sendError = (request, response, error) => {
  const isKnown = error instanceof HttpError;
  const status = isKnown ? error.status : 500;
  const code = isKnown ? error.code : 'INTERNAL_ERROR';
  const message = isKnown ? error.message : '服务器内部错误。';
  if (!isKnown) console.error(error);
  sendJson(request, response, status, {
    error: {
      code,
      message,
      ...(isKnown && error.details ? { details: error.details } : {}),
    },
  });
};

const writeSse = (response, eventName, payload, id) => {
  if (id !== undefined) response.write(`id: ${id}\n`);
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const broadcast = (event) => {
  if (!event) return;
  for (const response of eventClients) {
    try {
      writeSse(response, 'workspace', event, event.revision);
    } catch {
      eventClients.delete(response);
      response.destroy();
    }
  }
};

const handleEvents = (request, response) => {
  if (!isAllowedOrigin(request.headers.origin)) {
    sendJson(request, response, 403, { error: { code: 'ORIGIN_FORBIDDEN', message: '不允许的请求来源。' } });
    return;
  }
  if (eventClients.size >= 100) {
    sendJson(request, response, 503, { error: { code: 'TOO_MANY_CLIENTS', message: '实时连接数已达到上限。' } }, { 'Retry-After': '5' });
    return;
  }

  applyCommonHeaders(request, response);
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders?.();
  const snapshot = workspace.snapshot();
  response.write('retry: 2000\n');
  writeSse(response, 'ready', {
    type: 'ready', revision: snapshot.revision, updatedAt: snapshot.updatedAt, initialized: snapshot.initialized,
  }, snapshot.revision);
  eventClients.add(response);

  const close = () => eventClients.delete(response);
  request.on('close', close);
  response.on('close', close);
  response.on('error', close);
};

const handleApi = async (request, response, pathname) => {
  if (!isAllowedOrigin(request.headers.origin)) {
    sendJson(request, response, 403, { error: { code: 'ORIGIN_FORBIDDEN', message: '不允许的请求来源。' } });
    return;
  }
  if (request.method === 'OPTIONS') {
    applyCommonHeaders(request, response);
    response.writeHead(204, { 'Cache-Control': 'no-store', 'Access-Control-Max-Age': '600' });
    response.end();
    return;
  }

  if (request.method === 'GET' && pathname === '/api/health') {
    const snapshot = workspace.snapshot();
    sendJson(request, response, 200, {
      ok: true,
      service: 'autumn-compass-server',
      revision: snapshot.revision,
      updatedAt: snapshot.updatedAt,
      initialized: snapshot.initialized,
      uptimeSeconds: Math.floor(process.uptime()),
    });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/workspace') {
    sendJson(request, response, 200, workspace.snapshot());
    return;
  }

  if (request.method === 'GET' && pathname === '/api/recruitment-maintenance-scope') {
    sendJson(request, response, 200, recruitmentMaintenanceScope.current());
    return;
  }

  if (request.method === 'GET' && pathname === '/api/events') {
    handleEvents(request, response);
    return;
  }

  if (request.method === 'POST' && pathname === '/api/workspace/bootstrap') {
    const { items, clientId } = parseBootstrapBody(await readJsonBody(request));
    const result = workspace.bootstrap(items, clientId);
    refreshRecruitmentMaintenanceScope();
    broadcast(result.event);
    sendJson(request, response, result.response.imported ? 201 : 200, result.response);
    return;
  }

  if (request.method === 'PUT' && pathname === '/api/workspace/item') {
    const result = workspace.putItem(parseItemBody(await readJsonBody(request)));
    refreshRecruitmentMaintenanceScope();
    broadcast(result.event);
    sendJson(request, response, 200, result.response);
    return;
  }

  if (request.method === 'DELETE' && pathname === '/api/workspace/item') {
    const result = workspace.deleteItem(parseDeleteBody(await readJsonBody(request)));
    refreshRecruitmentMaintenanceScope();
    broadcast(result.event);
    sendJson(request, response, 200, result.response);
    return;
  }

  if (request.method === 'PUT' && pathname === '/api/workspace') {
    const result = workspace.replace(parseReplaceBody(await readJsonBody(request)));
    refreshRecruitmentMaintenanceScope();
    broadcast(result.event);
    sendJson(request, response, 200, result.response);
    return;
  }

  sendJson(request, response, 404, { error: { code: 'NOT_FOUND', message: 'API 路由不存在。' } });
};

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
]);

const handleStatic = async (request, response, pathname) => {
  if (!serveWeb || !['GET', 'HEAD'].includes(request.method)) {
    sendJson(request, response, 404, { error: { code: 'NOT_FOUND', message: '路由不存在。' } });
    return;
  }

  let relativePath;
  try {
    relativePath = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    sendJson(request, response, 400, { error: { code: 'INVALID_PATH', message: '路径编码无效。' } });
    return;
  }

  let filePath = path.resolve(staticDirectory, relativePath || 'index.html');
  if (filePath !== staticDirectory && !filePath.startsWith(`${staticDirectory}${path.sep}`)) {
    sendJson(request, response, 403, { error: { code: 'PATH_FORBIDDEN', message: '路径不允许访问。' } });
    return;
  }

  let stats;
  try {
    stats = await fs.promises.stat(filePath);
  } catch {
    stats = null;
  }
  if (!stats?.isFile()) {
    if (path.extname(filePath)) {
      sendJson(request, response, 404, { error: { code: 'NOT_FOUND', message: '静态资源不存在。' } });
      return;
    }
    filePath = path.join(staticDirectory, 'index.html');
    stats = await fs.promises.stat(filePath);
  }

  applyCommonHeaders(request, response);
  response.writeHead(200, {
    'Content-Type': mimeTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  if (request.method === 'HEAD') response.end();
  else fs.createReadStream(filePath).pipe(response);
};

const server = http.createServer(async (request, response) => {
  try {
    if (!isAllowedHost(request.headers.host)) {
      sendJson(request, response, 400, { error: { code: 'HOST_FORBIDDEN', message: 'Host 必须是本机回环地址。' } });
      return;
    }
    const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);
    if (url.pathname.startsWith('/api/')) await handleApi(request, response, url.pathname);
    else await handleStatic(request, response, url.pathname);
  } catch (error) {
    if (!response.headersSent) sendError(request, response, error);
    else response.destroy(error);
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;

const heartbeat = setInterval(() => {
  for (const response of eventClients) response.write(': keep-alive\n\n');
}, 25_000);
heartbeat.unref();

const shutdown = (signal) => {
  console.log(`\n收到 ${signal}，正在关闭 Autumn Compass server…`);
  clearInterval(heartbeat);
  for (const response of eventClients) response.end();
  server.close(() => {
    workspace.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5_000).unref();
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

server.listen(port, host, () => {
  console.log(`Autumn Compass server: http://${host.includes(':') ? `[${host}]` : host}:${port}`);
  console.log(`SQLite: ${databasePath}`);
  console.log(serveWeb ? `Web: ${staticDirectory}` : 'Web 托管未启用（设置 AUTUMN_COMPASS_SERVE_WEB=1 可启用）。');
});
