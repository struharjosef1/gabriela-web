'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';

type Factor = {id:string;qr?:string;secret?:string};

export function MfaForm({verifiedFactor,returnPath="/dashboard"}:{verifiedFactor?:string | undefined;returnPath?:"/dashboard"|"/podpora"}) {
  const [factor,setFactor]=useState<Factor | null>(verifiedFactor ? {id:verifiedFactor} : null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const router=useRouter();

  async function enroll() {
    setBusy(true);setError('');
    try {
      const client=createClient();
      const {data,error}=await client.auth.mfa.enroll({factorType:'totp'});
      if (error || !data) throw new Error();
      setFactor({id:data.id,qr:data.totp.qr_code,secret:data.totp.secret});
    } catch { setError('Ověření se nepodařilo nastavit.'); }
    finally { setBusy(false); }
  }

  async function verify(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!factor) return;
    const code=String(new FormData(event.currentTarget).get('code') ?? '').trim();
    setBusy(true);setError('');
    try {
      const {error}=await createClient().auth.mfa.challengeAndVerify({factorId:factor.id,code});
      if (error) throw new Error();
      router.replace(returnPath);
      router.refresh();
    } catch { setError('Kód se nepodařilo ověřit. Použijte aktuální kód z aplikace.'); }
    finally { setBusy(false); }
  }

  return <div className="stack">
    {error && <p role="alert" className="form-error">{error}</p>}
    {!factor ? <button className="button" disabled={busy} onClick={enroll}>Nastavit ověřovací aplikaci</button> :
      <form onSubmit={verify} className="stack">
        {factor.qr && <><p>Naskenujte kód v ověřovací aplikaci.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="QR kód pro nastavení ověřovací aplikace" src={factor.qr} width="180" height="180" />
          <p>Ruční klíč <code>{factor.secret}</code></p></>}
        <label>Šestimístný kód<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required /></label>
        <button className="button" disabled={busy}>Ověřit a pokračovat</button>
      </form>}
  </div>;
}
