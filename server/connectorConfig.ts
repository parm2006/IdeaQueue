import { createClient } from '@supabase/supabase-js';

declare const process: { env: Record<string, string | undefined> };
export function connectorConfig() {
  return {
    url: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    serverKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    origin: (process.env.IDEAQUEUE_APP_URL ?? 'https://ideaqueue.vercel.app').replace(/\/$/, ''),
  };
}
export type ConnectorConfig = ReturnType<typeof connectorConfig>;
export function connectorClient(config: ConnectorConfig) {
  if (!config.url || !config.serverKey) throw new Error('Connector backend is not configured.');
  return createClient(config.url, config.serverKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
