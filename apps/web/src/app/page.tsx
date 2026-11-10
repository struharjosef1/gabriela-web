import Link from 'next/link';

export default function HomePage() {
  return <main className="landing">
    <header className="landing-header container">
      <Link href="/" className="brand"><span className="brand-mark">G</span><span>GABRIELA<small>2026</small></span></Link>
      <Link className="button secondary" href="/login">Přihlásit se</Link>
    </header>
    <section className="hero container">
      <div><span className="eyebrow">Správa bytových domů</span>
      <h1>Domy, lidé a opravy na jednom místě.</h1>
      <p>Přehled jednotek a provozních požadavků s jasnou odpovědností, termínem a historií.</p>
      <Link className="button" href="/login">Otevřít GABRIELU</Link></div>
      <section className="hero-panel"><span className="eyebrow">Jak to funguje</span>
        <h2>Od nahlášení po potvrzení opravy</h2>
        <ol className="landing-steps">
          <li>Obyvatel nahlásí problém.</li><li>Správce stanoví termín a přidělí technika.</li>
          <li>Technik doplní výsledek a obyvatel ho potvrdí.</li><li>Správce uzavře požadavek a zkontroluje historii.</li>
        </ol>
      </section>
    </section>
  </main>;
}
