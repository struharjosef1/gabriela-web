import Link from 'next/link';
import { signOut } from '@/app/actions';
import { roleLabels,type CurrentContext } from '@/lib/auth-context';
import { href } from '@/lib/data';

const navigation=[
  ['','Přehled','◈'],['objekty','Objekty','▦'],['jednotky','Jednotky','▤'],['lide','Lidé','♙'],
  ['tikety','Požadavky','◫'],['oznameni','Oznámení','♢'],['audit','Audit','≡'],['nastaveni','Nastavení','⚙']
] as const;

export function DashboardShell({context,view,children}:{context:CurrentContext;view:string;children:React.ReactNode}) {
  const links=navigation.filter(([id])=>(id!=='audit' || context.manages) && (id!=='nastaveni' || context.owner)
    && (context.role!=='technician' || !['objekty','jednotky','lide'].includes(id)));
  return <div className="app-shell">
    <aside className="sidebar">
      <Link href={href('/dashboard',context.organizationId)} className="brand sidebar-brand">
        <span className="brand-mark">G</span><span>GABRIELA<small>2026</small></span>
      </Link>
      <div className="org-switch"><small>ORGANIZACE</small><b>{context.organizationName}</b><span>{roleLabels[context.role]}</span>
        {context.organizations.length>1 && <details><summary>Přepnout organizaci</summary>
          {context.organizations.map(org=><Link key={org.id} href={href('/dashboard',org.id)}>{org.name}</Link>)}
        </details>}
      </div>
      <nav className="side-nav" aria-label="Hlavní navigace">{links.map(([id,label,icon])=>
        <Link key={id} aria-current={view===id ? 'page' : undefined} className={view===id ? 'active' : ''}
          href={href('/dashboard'+(id ? '/'+id : ''),context.organizationId)}><i aria-hidden="true">{icon}</i>{label}</Link>)}
      </nav>
      <div className="sidebar-footer"><Link href="/ucet">Můj účet</Link>
        <form action={signOut}><button aria-label="Odhlásit se" title="Odhlásit se">↪</button></form>
      </div>
    </aside>
    <div className="app-main">
      <header className="topbar">
        <form className="global-search" action="/dashboard/tikety">
          <input type="hidden" name="org" value={context.organizationId}/>
          <label className="sr-only" htmlFor="global-search">Hledat požadavek</label>
          <input id="global-search" name="q" placeholder="Hledat požadavek…" />
          <button className="search-button" aria-label="Hledat">⌕</button>
        </form>
        {context.role!=='technician' && <Link className="button compact" href={href('/dashboard/tikety',context.organizationId)+'#novy'}>+ Nový požadavek</Link>}
      </header>
      <main className="dashboard-content" id="obsah">
        {process.env.NEXT_PUBLIC_GABRIELA_TRIAL==='true' && <p className="notice">Zkušební prostředí se smyšlenými daty</p>}
        {children}
      </main>
    </div>
  </div>;
}
