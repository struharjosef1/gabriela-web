import Link from 'next/link';
import { requireSession,roleLabels } from '@/lib/auth-context';
import { acceptInvitation,changePassword,revokeSessions,saveNotificationPreferences,signOut } from '../actions';

type Invitation={id:string;organization_id:string;organization_name:string;role:string};

export const dynamic="force-dynamic";

export default async function AccountPage({searchParams}:{searchParams:Promise<{saved?:string;error?:string}>}) {
  const {supabase,user}=await requireSession();
  const [{data,error},{data:preferences}]=await Promise.all([
    supabase.rpc('gab_pending_invitations'),
    supabase.from('user_preferences').select('in_app_notifications,email_notifications').eq('user_id',user.id).maybeSingle()
  ]);
  const query=await searchParams;
  return <main className="account-page"><section className="panel stack">
    <span className="eyebrow">GABRIELA / Účet</span><h1>Můj účet</h1><p>{user.email}</p>
    {query.saved && <p className="notice" role="status">Změna byla uložena.</p>}
    {(query.error || error) && <p className="form-error" role="alert">Změnu se nepodařilo uložit. Zkontrolujte heslo nebo platnost pozvánky.</p>}
    <h2>Pozvánky do organizací</h2>
    {(data as Invitation[] | null)?.map(item=><form className="inline-form" key={item.id} action={acceptInvitation}>
      <input type="hidden" name="id" value={item.id}/><input type="hidden" name="organization" value={item.organization_id}/>
      <span>{item.organization_name} · {roleLabels[item.role]}</span><button className="button">Přijmout</button>
    </form>)}
    {!data?.length && <p>Nemáte žádnou nevyřízenou pozvánku.</p>}
    <h2>Oznámení</h2>
    <form action={saveNotificationPreferences} className="stack">
      <label className="check-label"><input type="checkbox" name="in_app" value="true" defaultChecked={preferences?.in_app_notifications ?? true}/> V aplikaci</label>
      <label className="check-label"><input type="checkbox" name="email" value="true" defaultChecked={preferences?.email_notifications ?? true}/> E-mailem</label>
      <button className="button secondary">Uložit oznámení</button>
    </form>
    <h2>Nastavení hesla</h2>
    <form className="stack" action={changePassword}>
      <label>Nové heslo (alespoň 12 znaků)<input name="password" type="password" minLength={12} maxLength={128} required autoComplete="new-password" /></label>
      <label>Zopakujte heslo<input name="confirm" type="password" minLength={12} maxLength={128} required autoComplete="new-password" /></label>
      <button className="button">Uložit heslo</button>
    </form>
    <div className="inline-form"><form action={revokeSessions}><button className="button secondary">Ukončit ostatní relace</button></form>
      <form action={signOut}><button className="button ghost">Odhlásit se</button></form></div>
    <Link href="/dashboard">Otevřít přehled →</Link>
    <Link href="/podpora">Podpora a diagnostika</Link>
  </section></main>;
}
