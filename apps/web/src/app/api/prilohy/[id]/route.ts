import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requireCurrentContext} from '@/lib/auth-context';
import {createAdminClient} from '@/lib/supabase/admin';

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  const url=new URL(request.url);
  const attachment=z.uuid().safeParse((await params).id);
  const ticket=z.uuid().safeParse(url.searchParams.get('ticket'));
  const organization=z.uuid().safeParse(url.searchParams.get('org'));
  if (!attachment.success || !ticket.success || !organization.success) return new Response('Nenalezeno',{status:404});
  const context=await requireCurrentContext(organization.data);
  const {data,error}=await context.supabase.rpc('gab_download_file',{o:organization.data,t:ticket.data,a:attachment.data}).maybeSingle();
  if (error || !data) return new Response('Nenalezeno',{status:404});
  const file=data as {object_path:string;original_filename:string};
  try {
    const {data:signed,error:signedError}=await createAdminClient().storage.from('gabriela-private')
      .createSignedUrl(file.object_path,60,{download:file.original_filename});
    if (signedError || !signed) return new Response('Soubor není dostupný',{status:404});
    return NextResponse.redirect(signed.signedUrl,{headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});
  } catch { return new Response('Soubor není dostupný',{status:503}); }
}
