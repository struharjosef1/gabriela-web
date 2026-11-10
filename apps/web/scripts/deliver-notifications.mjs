import {createClient} from '@supabase/supabase-js';

const {NEXT_PUBLIC_SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:key,
  NEXT_PUBLIC_APP_URL:app,RESEND_API_KEY:emailKey,NOTIFICATIONS_FROM:from}=process.env;
if (!url || !key || !app || !emailKey || !from) {
  console.error('Chybí konfigurace databáze nebo doručování.');
  process.exit(1);
}
const site=new URL('/dashboard/oznameni',app);
if (site.protocol!=='https:' && site.hostname!=='localhost') throw new Error('Adresa aplikace musí používat HTTPS.');
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
async function rpc(name,params) {
  const {data,error}=await client.rpc(name,params);
  if (error) throw new Error(name+' failed: '+error.code);
  return data;
}
async function deliver(item) {
  let success=false;
  let provider_id=null;
  let failure='network';
  try {
    const response=await fetch('https://api.resend.com/emails',{
      method:'POST',signal:AbortSignal.timeout(15000),
      headers:{Authorization:'Bearer '+emailKey,'Content-Type':'application/json','Idempotency-Key':'gabriela/'+item.id},
      body:JSON.stringify({from,to:[item.recipient],subject:'Nové oznámení v aplikaci GABRIELA',
        text:'V aplikaci máte nové provozní oznámení. Pro podrobnosti se přihlaste: '+site.href})
    });
    success=response.ok;
    if (success) provider_id=(await response.json()).id ?? null;
    else failure='provider_http_'+response.status;
  } catch {
    failure='delivery_timeout_or_network';
  }
  await rpc('gab_finish_email',{delivery:item.id,lease:item.lease,success,provider_id,failure:success ? null : failure});
  return success;
}
await rpc('gab_enqueue_overdue');
let sent=0,failed=0;
for(let batch=0;batch<6;batch++){
  const items=await rpc('gab_claim_email');
  if (!items?.length) break;
  for(const item of items) (await deliver(item)) ? sent++ : failed++;
}
console.log(JSON.stringify({sent,failed}));
