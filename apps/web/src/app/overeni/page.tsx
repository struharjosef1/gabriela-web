import { requireSession } from '@/lib/auth-context';
import { MfaForm } from '@/components/MfaForm';
import { signOut } from '../actions';

export const dynamic="force-dynamic";

export default async function VerifyPage() {
  const {supabase}=await requireSession();
  const {data}=await supabase.auth.mfa.listFactors();
  return <main className="account-page"><section className="panel">
    <span className="eyebrow">GABRIELA / Účet</span><h1>Dvoufázové ověření</h1>
    <p>Vlastník a správce ověřují přístup k údajům organizace kódem z ověřovací aplikace.</p>
    <MfaForm verifiedFactor={data?.totp.find(item=>item.status==='verified')?.id} />
    <form action={signOut}><button className="button ghost">Odhlásit se</button></form>
  </section></main>;
}
