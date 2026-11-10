import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const url=new URL(request.url);
  const origin=process.env.NEXT_PUBLIC_APP_URL || url.origin;
  const supabase=await createClient();
  const code=url.searchParams.get('code');
  const token_hash=url.searchParams.get('token_hash');
  const type=url.searchParams.get('type') as EmailOtpType | null;
  const result=code ? await supabase.auth.exchangeCodeForSession(code)
    : token_hash && (type==='invite' || type==='recovery' || type==='email')
      ? await supabase.auth.verifyOtp({token_hash,type}) : null;
  if (result && !result.error) await supabase.rpc('gab_record_session');
  return NextResponse.redirect(new URL(result && !result.error ? '/ucet' : '/login?error=link',origin));
}
