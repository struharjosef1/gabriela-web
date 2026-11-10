import Link from 'next/link';
import {requireSession} from '@/lib/auth-context';
import {date,type Row} from '@/lib/data';
import {MfaForm} from '@/components/MfaForm';
import {z} from 'zod';

export const dynamic='force-dynamic';

export default async function SupportPage({searchParams}:{searchParams:Promise<{grant?:string}>}) {
  const {supabase}=await requireSession();
  const {data:assurance}=await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assurance?.currentLevel!=='aal2') {
    const {data}=await supabase.auth.mfa.listFactors();
    return <main className="account-page"><section className="panel stack"><h1>Ověření pro podporu</h1>
      <MfaForm returnPath="/podpora" verifiedFactor={data?.totp.find(f=>f.status==='verified')?.id}/>
      <Link href="/ucet">Můj účet</Link></section></main>;
  }
  const grant=z.uuid().safeParse((await searchParams).grant);
  const [{data},{data:platform},{data:diagnostics,error}]=await Promise.all([
    supabase.rpc('gab_my_support_grants'),supabase.rpc('gab_platform_summary'),
    grant.success ? supabase.rpc('gab_support_diagnostics',{g:grant.data}) : Promise.resolve({data:null,error:null})
  ]);
  const grants=(data ?? []) as Row[];
  return <main className="account-page"><section className="panel stack">
    <span className="eyebrow">GABRIELA / Systém</span><h1>Podpora a diagnostika</h1>
    {platform && <p>Aktivní organizace: {platform.organizations} · Chyby doručení: {platform.email_failures}</p>}
    {grants.map(item=><div key={item.id} className="record">
      <h2>{String(item.organization_name)}</h2>
      <p>Rozsah: souhrnná diagnostika · Platnost do {date(item.ends_at,true)}</p>
      <a href={'/podpora?grant='+item.id}>Zobrazit diagnostiku</a>
    </div>)}
    {!grants.length && !platform && <p>Pro tento účet není dostupná provozní role ani platná žádost o podporu.</p>}
    {diagnostics && <dl className="detail-list">
      <div><dt>Objekty</dt><dd>{diagnostics.objects}</dd></div>
      <div><dt>Jednotky</dt><dd>{diagnostics.units}</dd></div>
      <div><dt>Požadavky</dt><dd>{diagnostics.tickets}</dd></div>
      <div><dt>Chyby doručení</dt><dd>{diagnostics.email_errors}</dd></div>
    </dl>}
    {error && <p className="form-error" role="alert">Přístup vypršel nebo byl odvolán.</p>}
    <Link href="/ucet">Můj účet</Link>
  </section></main>;
}
