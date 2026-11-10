import {createHash,randomUUID} from 'node:crypto';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireCurrentContext} from '@/lib/auth-context';
import {createAdminClient} from '@/lib/supabase/admin';
import {detectMedia,maxFileSize,readUpload,scan} from '@/lib/uploads';

export const runtime='nodejs';
export async function POST(request:Request) {
  const url=new URL(request.url);
  const origin=process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin : url.origin;
  if (request.headers.get('origin')!==origin) return new Response('Zakázáno',{status:403});
  const organization=z.uuid().safeParse(url.searchParams.get('org'));
  const ticket=z.uuid().safeParse(url.searchParams.get('ticket'));
  if (!organization.success || !ticket.success) return new Response('Neplatný požadavek',{status:400});
  const context=await requireCurrentContext(organization.data);
  const back=new URL('/dashboard/tikety/'+ticket.data,origin);
  back.searchParams.set('org',organization.data);
  function result(error?:string) {
    back.searchParams.set(error ? 'error' : 'saved',error ?? '1');
    return NextResponse.redirect(back,303);
  }
  const {data,error}=await context.supabase.from('tickets').select('id').eq('id',ticket.data)
    .eq('organization_id',organization.data).maybeSingle();
  if (error || !data) return new Response('Nenalezeno',{status:404});
  let form:FormData;
  try { form=await readUpload(request); } catch { return result('file'); }
  const file=form.get('file');
  if (!(file instanceof File) || !file.size || file.size>maxFileSize) return result('file');
  const filename=file.name.replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,180);
  const bytes=Buffer.from(await file.arrayBuffer());
  const mime=detectMedia(filename,bytes);
  if (!mime) return result('file');
  const check=await scan(bytes);
  if (check!=='clean') return result(check==='unavailable' ? 'scan' : 'file');
  const assurance=await context.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const key=organization.data+'/'+ticket.data+'/'+randomUUID();
  try {
    const admin=createAdminClient();
    const bucket=admin.storage.from('gabriela-private');
    const {error:uploadError}=await bucket.upload(key,bytes,{contentType:mime,upsert:false,cacheControl:'0'});
    if (uploadError) return result('file');
    const {error:linkError}=await admin.rpc('gab_attach_scanned_file',{
      o:organization.data,t:ticket.data,actor:context.user.id,assurance:assurance.data?.currentLevel ?? 'aal1',
      object_key:key,file_name:filename,media_type:mime,file_size:bytes.length,digest:createHash('sha256').update(bytes).digest('hex')
    });
    if (linkError) { await bucket.remove([key]); return result('file'); }
    return result();
  } catch { return result('file'); }
}
