import { handleApi } from './api';
import assets from './assets.generated.json';

export default {
  async fetch(request: Request, env: Parameters<typeof handleApi>[1]) {
    const api = await handleApi(request, env);
    if (api) return api;
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const path = new URL(request.url).pathname;
    const asset = (assets as Record<string, { body: string; type: string }>)[path === '/' ? '/index.html' : path];
    if (!asset) return new Response('Not found', { status: 404 });
    const body = Uint8Array.from(atob(asset.body), c => c.charCodeAt(0));
    return new Response(request.method === 'HEAD' ? null : body, { headers: {
      'Content-Type': asset.type,
      'Cache-Control': path.startsWith('/assets/') ? 'private, max-age=31536000, immutable' : 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    } });
  },
};
