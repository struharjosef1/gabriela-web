const PLACEHOLDER = 'YOUR_PROJECT';

export function getPublicSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key || url.includes(PLACEHOLDER) || key.includes('REPLACE_ME')) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  return { url, key };
}
