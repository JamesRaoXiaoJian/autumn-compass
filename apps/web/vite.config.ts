import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function loopbackHost(variableName: string, fallback: string) {
  const configured = process.env[variableName] || fallback;
  if (!['127.0.0.1', 'localhost'].includes(configured)) {
    throw new Error(`${variableName} 只允许 127.0.0.1 或 localhost。`);
  }
  return '127.0.0.1';
}

function port(variableName: string, fallback: number) {
  const configured = process.env[variableName] || String(fallback);
  if (!/^\d+$/.test(configured)) {
    throw new Error(`${variableName} 只允许 1–65535 之间的十进制整数。`);
  }
  const parsed = Number(configured);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${variableName} 只允许 1–65535 之间的十进制整数。`);
  }
  return parsed;
}

const webHost = loopbackHost('AUTUMN_COMPASS_HOST', '127.0.0.1');
const webPort = port('AUTUMN_COMPASS_PORT', 5173);
const apiHost = loopbackHost('AUTUMN_COMPASS_API_HOST', '127.0.0.1');
const apiPort = port('AUTUMN_COMPASS_API_PORT', 4174);

const securityHeaders = {
  'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: webHost,
    port: webPort,
    strictPort: true,
    headers: securityHeaders,
    proxy: {
      '/api': {
        target: `http://${apiHost}:${apiPort}`,
        changeOrigin: false,
      },
    },
  },
  preview: {
    headers: securityHeaders,
  },
});
