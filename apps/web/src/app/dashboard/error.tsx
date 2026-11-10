'use client';

export default function DashboardError({reset}:{reset:()=>void}) {
  return <main className="account-page"><section className="panel">
    <h1>Přehled se nepodařilo načíst</h1>
    <p>Zkontrolujte připojení a zkuste stránku načíst znovu.</p>
    <button className="button" onClick={reset}>Načíst znovu</button>
  </section></main>;
}
