import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import type { CurrentContext } from '@/lib/auth-context';
import { closedStatuses,date,directory,filterTickets,href,localDay,lookup,param,personName,rows,rpcRows,selectStatus,statusLabels,str,ticketColumns,transitions,type Query,type Row } from '@/lib/data';
import { StatusBadge } from './StatusBadge';
import { Command,Empty,Feedback,Field,Heading,SelectField } from './WorkForms';
import { TicketLocation } from './TicketForm';

function opts(data:Row[],key='name') { return data.map(item=>({id:item.id,label:str(item,key)})); }
function chip(row:Row,key:string) { return (row[key] as {name?:string}|null)?.name ?? '—'; }

export function TicketTable({tickets,buildings,organization}:{tickets:Row[];buildings:Row[];organization:string}) {
  if (!tickets.length) return <Empty>Žádné požadavky neodpovídají výběru.</Empty>;
  return <div className="table-wrap"><table className="data-table"><thead><tr>
    <th>Požadavek</th><th>Objekt</th><th>Stav</th><th>Priorita</th><th>Termín</th>
  </tr></thead><tbody>{tickets.map(ticket=><tr key={ticket.id}>
    <td><Link href={href('/dashboard/tikety/'+ticket.id,organization)}><b>{str(ticket,'title')}</b>
      <small>GAB-{str(ticket,'ticket_number')}</small></Link></td>
    <td>{lookup(buildings,ticket.building_id) || '—'}</td>
    <td><StatusBadge>{statusLabels[selectStatus(ticket)] ?? chip(ticket,'workflow_statuses')}</StatusBadge></td>
    <td><StatusBadge>{chip(ticket,'priorities')}</StatusBadge></td>
    <td>{date(ticket.due_at)}</td>
  </tr>)}</tbody></table></div>;
}

export async function TicketsView({context,query}:{context:CurrentContext;query:Query}) {
  const o=context.organizationId;
  const back='/dashboard/tikety';
  const [{buildings,units},tickets,categories,priorities,people]=await Promise.all([
    directory(context),rows(context,'tickets',ticketColumns,{order:'created_at',all:true}),
    rows(context,'ticket_categories','id,name,is_active',{order:'name',all:true}),
    rows(context,'priorities','id,name,code,is_active',{order:'rank',all:true}),
    context.manages ? rows(context,'persons','id,display_name,first_name,last_name',{order:'display_name',all:true}) : []
  ]);
  const filtered=filterTickets(tickets,query,buildings,units);
  const page=Math.max(1,Math.min(Math.ceil(filtered.length/25)||1,Number.parseInt(param(query,'strana'),10)||1));
  const activeParams=Object.fromEntries(['q','stav','priorita','objekt','jednotka','osoba','od','do'].map(key=>[key,param(query,key)]));
  const canCreate=context.owner || context.roles.includes('manager') || context.roles.includes('resident');
  return <>
    <Heading tag="Provoz" title={context.role==='technician' ? 'Přidělené požadavky' : 'Požadavky'}
      description="Sledujte stav, prioritu a termín každého požadavku." />
    <Feedback query={query}/>
    <section className="panel">
      <div className="panel-head"><h2>Evidence požadavků</h2><span className="badge gray">{filtered.length} záznamů</span></div>
      <form action={back} className="filter-grid">
        <input type="hidden" name="org" value={o}/>
        <Field label="Hledat" name="q" value={param(query,'q')} />
        <SelectField label="Stav" name="stav" placeholder="Všechny stavy" value={param(query,'stav')}
          options={[{id:'overdue',label:'Po termínu'},...Object.entries(statusLabels).filter(([id])=>id!=='cancelled').map(([id,label])=>({id,label}))]}/>
        <SelectField label="Priorita" name="priorita" placeholder="Všechny priority" value={param(query,'priorita')} options={opts(priorities)}/>
        <SelectField label="Objekt" name="objekt" placeholder="Všechny objekty" value={param(query,'objekt')} options={opts(buildings)}/>
        {units.length>0 && <SelectField label="Jednotka" name="jednotka" placeholder="Všechny jednotky" value={param(query,'jednotka')} options={opts(units,'unit_number')}/>}
        {people.length>0 && <SelectField label="Oznamovatel" name="osoba" placeholder="Všichni oznamovatelé" value={param(query,'osoba')}
          options={people.map(person=>({id:person.id,label:personName(person)}))}/>}
        <Field label="Vytvořeno od" name="od" type="date" value={param(query,'od')}/>
        <Field label="Vytvořeno do" name="do" type="date" value={param(query,'do')}/>
        <button className="button">Použít filtry</button><Link href={href(back,o)} className="button ghost">Zrušit filtry</Link>
      </form>
      <TicketTable tickets={filtered.slice((page-1)*25,page*25)} buildings={buildings} organization={o}/>
      <div className="inline-form pager">
        {page>1 && <Link href={href(back,o,{...activeParams,strana:String(page-1)})}>← Předchozí</Link>}
        {filtered.length>25 && <span>Strana {page} / {Math.ceil(filtered.length/25)}</span>}
        {page*25<filtered.length && <Link href={href(back,o,{...activeParams,strana:String(page+1)})}>Další →</Link>}
        {context.manages && ['csv','xlsx','pdf'].map(format=><a key={format} className="button ghost" href={href('/api/export',o,{...activeParams,format})}>Stáhnout {format.toUpperCase()}</a>)}
      </div>
    </section>
    {canCreate && <section className="panel" id="novy"><h2>Nahlásit požadavek</h2>
      {!buildings.length || !categories.some(x=>x.is_active) || !priorities.some(x=>x.is_active) ?
        <Empty>K založení požadavku potřebujete dostupný objekt a vyplněné číselníky.</Empty> :
        <Command operation="ticket.create" organization={o} back={back}>
          <Field label="Název požadavku" name="title" required maxLength={200}/>
          <TicketLocation buildings={opts(buildings)} resident={!context.manages}
            units={units.map(unit=>({id:unit.id,label:str(unit,'unit_number'),buildingId:str(unit,'building_id')}))}/>
          <div className="form-grid">
            <SelectField label="Kategorie" name="category_id" options={opts(categories.filter(x=>x.is_active))} required/>
            <SelectField label="Priorita" name="priority_id" options={opts(priorities.filter(x=>x.is_active))}
              value={priorities.find(x=>x.code==='normal')?.id} required/>
          </div>
          <label>Popis<textarea name="description" rows={4} required maxLength={10000}/></label>
          <p className="muted">Při ohrožení zdraví nebo majetku kontaktujte havarijní službu nebo tísňovou linku.</p>
          <button className="button">Založit požadavek</button>
        </Command>}
    </section>}
  </>;
}

export async function TicketDetail({context,query,id}:{context:CurrentContext;query:Query;id:string}) {
  if (!z.uuid().safeParse(id).success) notFound();
  const o=context.organizationId;
  const back='/dashboard/tikety/'+id;
  const {data,error}=await context.supabase.from('tickets').select(ticketColumns).eq('id',id).eq('organization_id',o).maybeSingle();
  if (error) throw new Error('Nelze načíst požadavek.');
  if (!data) notFound();
  const ticket=data as unknown as Row;
  const [{buildings,units},messages,assignments,attachments,{data:manage,error:permissionError}]=await Promise.all([
    directory(context),rows(context,'ticket_messages','id,body,visibility,author_user_id,created_at',{ticket:id,order:'created_at',all:true}),
    rows(context,'ticket_assignments','id,assignee_user_id,assigned_at,unassigned_at',{ticket:id,all:true}),
    rows(context,'ticket_attachments','id,file_object_id,visibility,created_at',{ticket:id,order:'created_at',all:true}),
    context.supabase.rpc('gab_can_manage_ticket',{i:id})
  ]);
  if (permissionError) throw new Error('Nelze ověřit přístup.');
  const [members,history,priorities]=manage ? await Promise.all([
    rpcRows(context,'gab_member_directory'),
    rows(context,'ticket_status_history','id,changed_at,change_reason,from_status_id,to_status_id',{ticket:id,order:'changed_at',all:true}),
    rows(context,'priorities','id,name,is_active',{order:'rank',all:true})
  ]) : [[],[],[]];
  const statuses=manage ? await rows(context,'workflow_statuses','id,name',{all:true}) : [];
  const state=selectStatus(ticket);
  const own=ticket.reporter_user_id===context.user.id;
  const assigned=assignments.some(x=>x.assignee_user_id===context.user.id && !x.unassigned_at);
  const allowed=manage ? (transitions[state] ?? (context.owner && closedStatuses.has(state) ? ['in_progress'] : []))
    : assigned && state==='in_progress' ? ['resolved'] : [];
  const props={organization:o,back,values:{id}};
  return <>
    <Link className="breadcrumb" href={href('/dashboard/tikety',o)}>← Požadavky</Link>
    <Heading tag={'GAB-'+str(ticket,'ticket_number')} title={str(ticket,'title')}
      description={[lookup(buildings,ticket.building_id),lookup(units,ticket.unit_id,'unit_number'),date(ticket.created_at,true)].filter(Boolean).join(' · ')}/>
    <Feedback query={query}/>
    <div className="detail-grid">
      <section className="panel stack">
        <div className="inline-form"><StatusBadge>{statusLabels[state] ?? chip(ticket,'workflow_statuses')}</StatusBadge>
          <StatusBadge>{chip(ticket,'priorities')}</StatusBadge><span>{chip(ticket,'ticket_categories')}</span></div>
        <h2>Popis požadavku</h2><p className="preserve">{str(ticket,'description')}</p>
        <dl className="detail-list"><div><dt>Termín</dt><dd>{date(ticket.due_at)}</dd></div>
          <div><dt>Řešitel</dt><dd>{assignments.filter(x=>!x.unassigned_at).map(x=>
            str(members.find(m=>m.user_id===x.assignee_user_id),'email') || (x.assignee_user_id===context.user.id ? 'Vy' : 'Přidělený technik')
          ).join(', ') || 'Nepřiděleno'}</dd></div></dl>
        {ticket.resolution_summary!=null && <><h3>Výsledek</h3><p className="preserve">{str(ticket,'resolution_summary')}</p></>}
        {ticket.resolution_confirmed_at!=null && <p className="notice">Výsledek potvrzen {date(ticket.resolution_confirmed_at,true)}.</p>}
      </section>
      <section className="panel stack"><h2>Další krok</h2>
        {allowed.length>0 && <Command {...props} operation="ticket.transition">
          <SelectField label="Nový stav" name="status" required options={allowed.map(key=>({id:key,label:statusLabels[key] ?? key}))}/>
          <label>Zdůvodnění nebo shrnutí výsledku<textarea name="reason" maxLength={2000} rows={2}/></label>
          {manage && <Field label="Termín další kontroly při čekání" name="due_at" type="date"/>}
          <button className="button">Uložit stav</button>
        </Command>}
        {own && state==='resolved' && <div className="stack">
          {!ticket.resolution_confirmed_at && <Command {...props} operation="ticket.confirm"><button className="button">Potvrdit výsledek</button></Command>}
          <Command {...props} operation="ticket.dispute"><Field label="Co je potřeba dořešit?" name="reason" required maxLength={2000}/>
            <button className="button secondary">Vrátit k řešení</button></Command>
        </div>}
        {manage && !closedStatuses.has(state) && <>
          <Command {...props} operation="ticket.assign">
            <SelectField label="Technik" name="user_id" required options={members.filter(x=>x.role==='technician' && x.status==='active')
              .map(x=>({id:str(x,'user_id'),label:str(x,'email')}))}/>
            <button className="button secondary">Přidělit technika</button>
          </Command>
          <Command {...props} operation="ticket.schedule">
            <Field label="Termín" name="due_at" type="date" value={localDay(ticket.due_at)}/>
            <SelectField label="Priorita" name="priority_id" options={opts(priorities.filter(x=>x.is_active))} value={str(ticket,'priority_id')}/>
            <button className="button secondary">Uložit termín a prioritu</button>
          </Command>
        </>}
        {!allowed.length && !manage && !(own && state==='resolved') && <Empty>Pro vaši roli nyní není potřeba změna stavu.</Empty>}
      </section>
      <section className="panel stack"><h2>Komunikace</h2>
        {!messages.length && <Empty>Zatím bez zpráv.</Empty>}
        {messages.map(message=><article className="message-card" key={message.id}>
          <div className="inline-form"><b>{message.author_user_id===context.user.id ? 'Vy' : 'Účastník požadavku'}</b>
            <span>{date(message.created_at,true)}</span>{message.visibility==='internal' && <span className="badge orange">Interní</span>}</div>
          <p className="preserve">{str(message,'body')}</p></article>)}
        <Command {...props} operation="ticket.message">
          <label>Nová zpráva<textarea name="body" required maxLength={10000} rows={3}/></label>
          {manage && <div className="stack"><label className="check-label"><input type="checkbox" name="internal" value="true"/> Interní poznámka</label>
            <label className="check-label"><input type="checkbox" name="technician_visible" value="true"/> Interní poznámku může číst přidělený technik</label></div>}
          <button className="button">Přidat zprávu</button>
        </Command>
      </section>
      <section className="panel stack"><h2>Přílohy</h2>
        {!attachments.length && <Empty>Zatím bez příloh.</Empty>}
        {attachments.map((attachment,index)=><a key={attachment.id} href={href('/api/prilohy/'+attachment.id,o,{ticket:id})}>
          Stáhnout přílohu {attachments.length-index} · {date(attachment.created_at,true)}</a>)}
        {process.env.NEXT_PUBLIC_GABRIELA_TRIAL==='true' ? <p className="muted">Přílohy jsou dostupné po připojení soukromého úložiště a kontroly souborů.</p> :
        <form action={href('/api/prilohy',o,{ticket:id})} method="post" encType="multipart/form-data" className="stack">
          <label>Soubor do 20 MB<input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx" required/></label>
          <button className="button secondary">Přiložit soubor</button>
        </form>}
      </section>
      {manage && <section className="panel stack"><h2>Historie stavů</h2>
        {history.map(item=><article className="message-card" key={item.id}><b>{lookup(statuses,item.to_status_id) || 'Změna stavu'}</b>
          <span> · {date(item.changed_at,true)}</span><p>{str(item,'change_reason')}</p></article>)}
      </section>}
    </div>
  </>;
}
