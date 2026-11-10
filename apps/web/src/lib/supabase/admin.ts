import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { getPublicSupabaseEnv } from './env';

export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Admin configuration unavailable');
  return createClient(getPublicSupabaseEnv().url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
