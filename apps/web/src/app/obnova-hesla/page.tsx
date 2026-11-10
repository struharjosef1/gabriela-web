import Link from 'next/link';
import { resetPassword } from '../actions';

export default async function ResetPage({searchParams}:{searchParams:Promise<{sent?:string;error?:string}>}) {
  const {sent,error}=await searchParams;
  return <main className="account-page"><section className="panel">
    <span className="eyebrow">GABRIELA / Účet</span><h1>Obnova hesla</h1>
    {sent ? <p role="status">Pokud k adrese existuje účet, obdržíte odkaz pro obnovu hesla.</p> :
    <form action={resetPassword} className="stack">
      {error && <p role="alert" className="form-error">Požadavek se nepodařilo odeslat. Zkontrolujte adresu a zkuste to znovu.</p>}
      <label>E-mail<input type="email" name="email" required autoComplete="email" /></label>
      <button className="button">Poslat odkaz</button>
    </form>}
    <Link className="back-link" href="/login">← Přihlášení</Link>
  </section></main>;
}
