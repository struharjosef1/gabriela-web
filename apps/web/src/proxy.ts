import {createServerClient} from '@supabase/ssr';
import {NextResponse,type NextRequest} from 'next/server';

export async function proxy(request:NextRequest) {
  const path=request.nextUrl.pathname;
  const protectedPage=path==='/dashboard' || path.startsWith('/dashboard/') || ['/ucet','/overeni','/podpora'].includes(path);
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let response=NextResponse.next({request});
  if (!url || !key || url.includes('YOUR_PROJECT') || key.includes('REPLACE_ME')) {
    return protectedPage ? NextResponse.redirect(new URL('/login?error=configuration',request.url)) : response;
  }
  const supabase=createServerClient(url,key,{
    cookies:{
      getAll:()=>request.cookies.getAll(),
      setAll:items=>{
        items.forEach(({name,value})=>request.cookies.set(name,value));
        response=NextResponse.next({request});
        items.forEach(({name,value,options})=>response.cookies.set(name,value,options));
      }
    }
  });
  const {data,error}=await supabase.auth.getUser();
  const destination=protectedPage && (error || !data.user) ? '/login'
    : path==='/login' && data.user ? '/dashboard' : null;
  if (destination) {
    const redirect=NextResponse.redirect(new URL(destination,request.url));
    response.cookies.getAll().forEach(cookie=>redirect.cookies.set(cookie));
    return redirect;
  }
  response.headers.set('Cache-Control','private, no-store');
  return response;
}

export const config={matcher:['/dashboard/:path*','/ucet','/overeni','/podpora','/login','/api/export','/api/prilohy/:path*']};
