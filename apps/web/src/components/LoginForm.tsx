'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const supabase = createClient();
      const result = await supabase.auth.signInWithPassword({ email, password });

      if (result.error) {
        setError('Přihlášení se nezdařilo. Zkontrolujte e-mail a heslo.');
        return;
      }

      await supabase.rpc('gab_record_session');
      router.replace('/dashboard');
      router.refresh();
    } catch (caught) {
      if (caught instanceof Error && caught.message === 'SUPABASE_NOT_CONFIGURED') {
        setError('Aplikace není připojena k Supabase. Doplňte veřejnou konfiguraci prostředí.');
      } else {
        setError('Přihlášení se nepodařilo dokončit.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      {process.env.NEXT_PUBLIC_GABRIELA_TRIAL==='true' && <section className="record stack" aria-label="Zkušební účty">
        <b>Zkušební prostředí</b><p>Vyberte roli. Změny se po ukončení ukázky smažou.</p>
        <div className="inline-form">
          {[['owner','Vlastník'],['manager','Správce'],['resident','Obyvatel'],['tech','Technik']].map(([id,label])=>
            <button type="button" className="button secondary compact" key={id}
              onClick={()=>{setEmail(id+'@gabriela.test');setPassword('Local-Test-Password!');}}>{label}</button>)}
        </div>
      </section>}
      <label>
        E-mail
        <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Heslo
        <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Zadejte heslo" />
      </label>
      <div className="login-options">
        <span />
        <a className="link-button" href="/obnova-hesla">Zapomenuté heslo</a>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button full" disabled={loading}>{loading ? 'Přihlašuji…' : 'Přihlásit se'}</button>
    </form>
  );
}
