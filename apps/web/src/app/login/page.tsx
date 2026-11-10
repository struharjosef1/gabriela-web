import Link from 'next/link';
import { LoginForm } from '@/components/LoginForm';

export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const {error}=await searchParams;
  return <main className="login-page"><section className="login-branding">
    <Link href="/" className="brand light"><span className="brand-mark">G</span><span>GABRIELA<small>2026</small></span></Link>
    <div><span className="eyebrow light">Přehledná správa domů</span><h1>Vítejte zpět.</h1>
      <p>Objekty, jednotky, provozní požadavky a komunikace v jednom přehledu.</p></div>
  </section><section className="login-card"><div><h2>Přihlášení</h2>
    {error==='configuration' && <p role="alert" className="form-error">Připojení k účtům organizace zatím není nastavené.</p>}
    {error==='link' && <p role="alert" className="form-error">Odkaz vypršel nebo už byl použit.</p>}
    <LoginForm /><Link className="back-link" href="/">← Zpět na úvodní stránku</Link>
  </div></section></main>;
}
