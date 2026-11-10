import Link from 'next/link';
import {supportGrant} from '@/app/actions';
import { notFound } from 'next/navigation';
import { date,directory,href,localDay,lookup,personName,rows,rpcRows,selectStatus,closedStatuses,str,ticketColumns,type Query } from '@/lib/data';
import { roleLabels,type CurrentContext } from '@/lib/auth-context';
import { Command,Empty,Feedback,Field,Heading,SelectField } from './WorkForms';
import { TicketTable } from './TicketViews';

export async function Overview({context,query}:{context:CurrentContext;query:Query}) {
  const o=context.organizationId;
  const [{buildings,units},tickets,notifications]=await Promise.all([
    directory(context),rows(context,'tickets',ticketColumns,{order:'created_at',all:true}),
    rows(context,'notifications','id,title,read_at,created_at',{order:'created_at',all:true})
  ]);
  const active=tickets.filter(t=>!closedStatuses.has(selectStatus(t)));
  const overdue=active.filter(t=>!!t.due_at && Date.parse(String(t.due_at))<Date.now());
  const today=localDay(new Date());
  const due=active.filter(t=>t.due_at && localDay(t.due_at)>=today).sort((a,b)=>String(a.due_at).localeCompare(String(b.due_at)));
  const emergencies=active.filter(t=>(t.priorities as {code?:string}|null)?.code==='emergency');
  const cards=[
    {label:'Otevřené požadavky',count:active.length,tone:'blue',link:href('/dashboard/tikety',o)},
    {label:'Po termínu',count:overdue.length,tone:'orange',link:href('/dashboard/tikety',o,{stav:'overdue'})},
    {label:context.manages ? 'Objekty ve správě' : 'Moje jednotky',count:context.manages ? buildings.length : units.length,tone:'teal',
      link:href(context.manages ? '/dashboard/objekty' : '/dashboard/jednotky',o)},
    {label:'Nepřečtená oznámení',count:notifications.filter(n=>!n.read_at).length,tone:'blue',link:href('/dashboard/oznameni',o)}
  ].filter((_,index)=>index!==2 || context.role!=='technician');
  return <>
    <Heading tag="Řídicí panel" title="Přehled organizace" description={context.organizationName+' · '+roleLabels[context.role]}/>
    <Feedback query={query}/>
    <div className="metric-grid">{cards.map(card=><Link key={card.label} href={card.link} className={'metric-card '+card.tone}>
      <div><span>{card.label}</span><strong>{card.count}</strong></div></Link>)}</div>
    {emergencies.length>0 && <section className="panel danger-panel"><h2>Havarijní požadavky</h2>
      <TicketTable tickets={emergencies.slice(0,5)} buildings={buildings} organization={o}/></section>}
    {overdue.length>0 && <section className="panel"><h2>Po termínu</h2><TicketTable tickets={overdue.slice(0,5)} buildings={buildings} organization={o}/></section>}
    <section className="panel"><h2>Nejbližší termíny</h2><TicketTable tickets={due.slice(0,5)} buildings={buildings} organization={o}/></section>
    <section className="panel"><div className="panel-head"><h2>Poslední požadavky</h2><Link href={href('/dashboard/tikety',o)}>Celá evidence →</Link></div>
      <TicketTable tickets={tickets.slice(0,8)} buildings={buildings} organization={o}/></section>
  </>;
}

export async function NotificationsView({context,query}:{context:CurrentContext;query:Query}) {
  const o=context.organizationId,back='/dashboard/oznameni';
  const list=await rows(context,'notifications','id,title,ticket_id,read_at,created_at',{order:'created_at',all:true});
  return <><Heading tag="Komunikace" title="Oznámení"/><Feedback query={query}/>
    <section className="panel record-list">{!list.length && <Empty>Zatím bez oznámení.</Empty>}
      {list.map(item=><article className="record inline-form" key={item.id}>
        <div><h3>{str(item,'title')}</h3><p>{date(item.created_at,true)} · {item.read_at ? 'Přečtené' : 'Nové'}</p>
          {item.ticket_id!=null && <Link href={href('/dashboard/tikety/'+item.ticket_id,o)}>Otevřít požadavek →</Link>}</div>
        {!item.read_at && <Command organization={o} back={back} operation="notification.read" values={{id:item.id}}>
          <button className="button secondary">Označit jako přečtené</button></Command>}
      </article>)}
    </section></>;
}

const auditNames:Record<string,string> = {
  'organization.provision':'Založení organizace','ticket.create':'Založení požadavku',
  'ticket.transition':'Změna stavu','ticket.assign':'Přidělení technika','ticket.message':'Zpráva',
  'ticket.confirm':'Potvrzení výsledku','ticket.dispute':'Rozpor výsledku','ticket.schedule':'Změna termínu či priority',
  'invitation.create':'Vytvoření pozvánky','invitation.accept':'Přijetí pozvánky','invitation.revoke':'Odvolání pozvánky',
  'auth.login':'Přihlášení','support.grant':'Povolení podpory','support.revoke':'Odvolání podpory','support.diagnostics':'Zobrazení diagnostiky','member.revoke':'Odebrání role','audit.export':'Export požadavků','attachment.add':'Přiložení souboru','attachment.download':'Stažení přílohy'
};

export async function AuditView({context,query}:{context:CurrentContext;query:Query}) {
  if (!context.manages) notFound();
  const o=context.organizationId;
  const [events,members]=await Promise.all([
    rows(context,'audit_logs','id,action,actor_user_id,ticket_id,entity_type,created_at',{order:'created_at'}),
    rpcRows(context,'gab_member_directory')
  ]);
  return <><Heading tag="Správa a bezpečnost" title="Audit změn" description="Posledních 200 událostí v rozsahu vašeho oprávnění."/>
    <Feedback query={query}/>
    <section className="panel">{!events.length ? <Empty/> : <div className="table-wrap"><table className="data-table">
      <thead><tr><th>Čas</th><th>Událost</th><th>Uživatel</th><th>Záznam</th></tr></thead>
      <tbody>{events.map(e=><tr key={e.id}><td>{date(e.created_at,true)}</td><td>{auditNames[str(e,'action')] ?? str(e,'action')}</td>
        <td>{str(members.find(m=>m.user_id===e.actor_user_id),'email') || (e.actor_user_id===context.user.id ? 'Vy' : 'Účastník / systém')}</td>
        <td>{e.ticket_id!=null ? <Link href={href('/dashboard/tikety/'+e.ticket_id,o)}>Požadavek</Link> : str(e,'entity_type')}</td></tr>)}</tbody>
    </table></div>}</section></>;
}

export async function SettingsView({context,query}:{context:CurrentContext;query:Query}) {
  if (!context.owner) notFound();
  const o=context.organizationId,back='/dashboard/nastaveni';
  const [{buildings},people,members,invites,assignments,categories,priorities,deliveries,supportGrants]=await Promise.all([
    directory(context),rows(context,'persons','id,display_name,first_name,last_name',{all:true}),
    rpcRows(context,'gab_member_directory'),rpcRows(context,'gab_list_invitations'),
    rows(context,'building_manager_assignments','id,user_id,building_id,revoked_at',{all:true}),
    rows(context,'ticket_categories','id,name,is_active',{order:'name',all:true}),
    rows(context,'priorities','id,name,response_minutes,resolution_minutes',{order:'rank',all:true}),
    rpcRows(context,'gab_delivery_overview'),
    rows(context,'support_access_grants','id,reason,support_ticket_reference,status,ends_at',{order:'created_at'})
  ]);
  const props={organization:o,back};
  return <>
    <Heading tag="Správa a bezpečnost" title="Nastavení organizace"/>
    <Feedback query={query}/>
    <section className="panel stack"><h2>Organizace</h2>
      <Command {...props} operation="organization.update"><Field label="Název" name="name" value={context.organizationName} required maxLength={160}/>
        <button className="button">Uložit název</button></Command>
    </section>
    <section className="panel stack"><h2>Pozvánky a členové</h2>
      <Command {...props} operation="invitation.create">
        <div className="form-grid">
          <Field label="E-mail" name="email" type="email" required maxLength={254}/>
          <SelectField label="Role" name="role" options={['manager','resident','technician'].map(id=>({id,label:roleLabels[id] ?? id}))} required/>
          <SelectField label="Objekt (správce)" name="building_id" options={buildings.map(b=>({id:b.id,label:str(b,'name')}))}/>
          <SelectField label="Evidovaná osoba (obyvatel)" name="person_id" options={people.map(p=>({id:p.id,label:personName(p)}))}/>
        </div><button className="button">Vytvořit pozvánku</button>
      </Command>
      {invites.map(i=><article className="record inline-form" key={i.id}><div><b>{str(i,'email')}</b>
        <p>{roleLabels[str(i,'role')]} · {i.accepted_at ? 'Přijatá' : i.revoked_at ? 'Odvolaná' : 'Platnost do '+date(i.expires_at)}</p></div>
        {!i.accepted_at && !i.revoked_at && Date.parse(str(i,'expires_at'))>Date.now() && <>
          <Command {...props} operation="invitation.send" values={{id:i.id}}><button className="button secondary">Poslat e-mailem</button></Command>
          <Command {...props} operation="invitation.revoke" values={{id:i.id}}><button className="button ghost">Odvolat</button></Command>
        </>}
      </article>)}
      <h3>Členové</h3>
      {members.map(m=><div className="record inline-form" key={m.id}><span>{str(m,'email')} · {roleLabels[str(m,'role')]} · {m.status==='active' ? 'Aktivní' : 'Neaktivní'}</span>
        {m.status==='active' && m.role!=='organization_owner' && m.user_id!==context.user.id &&
          <Command {...props} operation="member.revoke" values={{id:m.id}}><button className="button ghost">Odebrat roli</button></Command>}
      </div>)}
    </section>
    <section className="panel stack"><h2>Přiřazení správců</h2>
      <Command {...props} operation="manager.assign"><div className="form-grid">
        <SelectField label="Správce" name="user_id" required options={members.filter(m=>m.role==='manager' && m.status==='active')
          .map(m=>({id:str(m,'user_id'),label:str(m,'email')}))}/>
        <SelectField label="Objekt" name="building_id" required options={buildings.map(b=>({id:b.id,label:str(b,'name')}))}/>
        </div><button className="button">Přiřadit</button></Command>
      {assignments.filter(a=>!a.revoked_at).map(a=><div className="record inline-form" key={a.id}>
        <span>{lookup(buildings,a.building_id) || 'Objekt'} · {str(members.find(m=>m.user_id===a.user_id),'email')}</span>
        <Command {...props} operation="manager.unassign" values={{id:a.id}}><button className="button ghost">Odebrat přiřazení</button></Command>
      </div>)}
    </section>
    <section className="panel stack"><h2>Dočasná podpora</h2>
      <p>Pracovník podpory může po ověření vidět souhrnnou diagnostiku organizace po určenou dobu.</p>
      <form action={supportGrant} className="stack">
        <input type="hidden" name="organization" value={o}/>
        <div className="form-grid"><Field label="E-mail pracovníka" name="email" type="email" required/>
          <Field label="Číslo požadavku podpory" name="reference" required maxLength={80}/>
          <Field label="Důvod" name="reason" required maxLength={500}/>
          <Field label="Platnost v minutách (nejvýše 240)" name="minutes" type="number" min="1" value="60" required/>
        </div><button className="button">Povolit diagnostiku</button>
      </form>
      {supportGrants.map(g=><div key={g.id} className="record inline-form">
        <span>{str(g,'support_ticket_reference')} · {str(g,'reason')} · do {date(g.ends_at,true)}</span>
        {g.status==='active' && Date.parse(str(g,'ends_at'))>Date.now() && <form action={supportGrant}>
          <input type="hidden" name="organization" value={o}/><input type="hidden" name="id" value={g.id}/>
          <button className="button ghost">Odvolat přístup</button>
        </form>}
      </div>)}
    </section>
    <section className="panel stack"><h2>Doručování oznámení</h2>
      {!deliveries.length && <Empty>Zatím bez e-mailových oznámení.</Empty>}
      {deliveries.map(d=><div key={d.id} className="record">
        <b>{str(d,'title')}</b><p>{({pending:'Čeká na odeslání',sent:'Odeslané',failed:'Chyba doručení',cancelled:'Zrušené'} as Record<string,string>)[str(d,'status')]}
        {' · '}{str(d,'attempt_count')} pokusů · {date(d.updated_at,true)}</p>
      </div>)}
    </section>
    <section className="panel stack"><h2>Kategorie a priority</h2>
      <Command {...props} operation="catalog.init"><button className="button secondary">Doplnit výchozí číselníky</button></Command>
      <Command {...props} operation="category.save"><Field label="Název nové kategorie" name="name" required maxLength={80}/>
        <button className="button">Přidat kategorii</button></Command>
      {categories.map(c=><details className="record" key={c.id}><summary>{str(c,'name')} · {c.is_active ? 'Aktivní' : 'Neaktivní'}</summary>
        <Command {...props} operation="category.save" values={{id:c.id}}>
          <Field label="Název kategorie" name="name" required value={str(c,'name')} maxLength={80}/>
          <SelectField label="Dostupnost" name="active" required value={String(c.is_active)}
            options={[{id:'true',label:'Aktivní'},{id:'false',label:'Neaktivní'}]}/>
          <button className="button secondary">Uložit kategorii</button></Command>
      </details>)}
      {priorities.map(p=><details className="record" key={p.id}><summary>{str(p,'name')}</summary>
        <Command {...props} operation="priority.sla" values={{id:p.id}}>
          <div className="form-grid"><Field label="Cíl reakce (minuty)" name="response" type="number" min="0" value={str(p,'response_minutes')}/>
            <Field label="Cíl vyřešení (minuty)" name="resolution" type="number" min="0" value={str(p,'resolution_minutes')}/></div>
          <button className="button secondary">Uložit cíle</button></Command>
      </details>)}
    </section>
  </>;
}
