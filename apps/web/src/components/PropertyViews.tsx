import { date,directory,href,lookup,param,personName,rows,str,type Query,type Row } from '@/lib/data';
import type { CurrentContext } from '@/lib/auth-context';
import { Command,Empty,Feedback,Field,Heading,SelectField } from './WorkForms';

const labels:Record<string,string>={resident:'Obyvatel',tenant:'Nájemce',subtenant:'Podnájemce',other:'Jiný uživatel',owner:'Vlastník'};
function opts(data:Row[],key='name') { return data.map(item=>({id:item.id,label:str(item,key)})); }

export async function PropertyView({context,view,query}:{context:CurrentContext;view:string;query:Query}) {
  const o=context.organizationId;
  const back='/dashboard/'+view;
  const {buildings,units}=await directory(context);
  const people=view==='lide' ? await rows(context,'persons','id,display_name,first_name,last_name,email,phone,person_type',{order:'display_name',all:true}) : [];
  const [occupancies,ownerships]=view==='lide' ? await Promise.all([
    rows(context,'unit_occupancies','id,unit_id,person_id,occupancy_type,valid_from,valid_to',{all:true}),
    rows(context,'unit_ownerships','id,unit_id,person_id,ownership_share,valid_from,valid_to',{all:true})
  ]) : [[],[]];
  const q=param(query,'q').trim().toLocaleLowerCase('cs');
  const filter=(...fields:unknown[])=>!q || fields.join(' ').toLocaleLowerCase('cs').includes(q);
  const selectedBuilding=param(query,'objekt');
  const shown=view==='objekty' ? buildings.filter(b=>filter(b.name,b.street,b.city,b.code))
    : view==='jednotky' ? units.filter(u=>(!selectedBuilding || u.building_id===selectedBuilding) && filter(u.unit_number,u.unit_type,lookup(buildings,u.building_id)))
    : people.filter(p=>filter(personName(p),p.email,p.phone));
  const canCreate=view==='objekty' ? context.owner : context.manages;
  const name=view==='objekty' ? 'Objekty' : view==='jednotky' ? 'Jednotky' : 'Lidé';
  const kind=view==='objekty' ? 'building' : view==='jednotky' ? 'unit' : 'person';
  return <>
    <Heading tag="Správa domu" title={name} description={view==='lide' ? 'Kontakty, vlastníci a uživatelé jednotek.' : 'Evidence domů a jejich prostor.'}/>
    <Feedback query={query}/>
    {canCreate && <details className="panel disclosure"><summary>{view==='objekty' ? 'Přidat objekt' : view==='jednotky' ? 'Přidat jednotku' : 'Přidat osobu'}</summary>
      <Command operation={kind+'.save'} organization={o} back={back}>
        <PropertyFields kind={kind} buildings={buildings} units={units} owner={context.owner}/>
        <button className="button">Přidat</button>
      </Command>
    </details>}
    <section className="panel">
      <form action={back} className="filter-grid">
        <input type="hidden" name="org" value={o}/>
        <Field label="Hledat" name="q" value={q}/>
        {view==='jednotky' && <SelectField label="Objekt" name="objekt" options={opts(buildings)} value={selectedBuilding} placeholder="Všechny objekty"/>}
        <button className="button secondary">Hledat</button>
      </form>
      {!shown.length && <Empty/>}
      <div className="record-list">{shown.map(item=>{
        const title=view==='objekty' ? str(item,'name') : view==='jednotky' ? str(item,'unit_number') : personName(item);
        const subtitle=view==='objekty' ? [item.street,item.city,item.postal_code].filter(Boolean).join(', ')
          : view==='jednotky' ? [lookup(buildings,item.building_id),item.floor_label,item.unit_type,item.area_m2 ? item.area_m2+' m²' : ''].filter(Boolean).join(' · ')
          : [item.email,item.phone].filter(Boolean).join(' · ');
        const rel=[...occupancies.filter(x=>x.person_id===item.id),...ownerships.filter(x=>x.person_id===item.id)];
        return <article key={item.id} className="record stack">
          <div><h3>{title}</h3><p>{subtitle}</p>
          {view==='objekty' && <a href={href('/dashboard/jednotky',o,{objekt:item.id})}>Zobrazit jednotky ({units.filter(u=>u.building_id===item.id).length})</a>}</div>
          {rel.length>0 && <div className="stack">{rel.map(r=><div className="inline-form" key={r.id}>
            <span>{lookup(units,r.unit_id,'unit_number') || 'Jednotka'} · {labels[str(r,'occupancy_type') || 'owner']} · {date(r.valid_from)} až {r.valid_to ? date(r.valid_to) : 'dosud'}</span>
            {context.manages && !r.valid_to && <details><summary>Ukončit vztah</summary>
              <Command operation="relation.end" organization={o} back={back} values={{id:r.id,kind:str(r,'occupancy_type')||'owner'}}>
                <Field label="Platnost do" name="valid_to" type="date" required/><button className="button secondary">Uložit</button>
              </Command></details>}
          </div>)}</div>}
          {context.manages && <details className="disclosure"><summary>Upravit údaje</summary>
            <Command operation={kind+'.save'} organization={o} back={back} values={{id:item.id,...(kind==='unit' ? {building_id:str(item,'building_id')} : {})}}>
              <PropertyFields kind={kind} item={item} buildings={buildings} units={units} owner={context.owner}/>
              <button className="button">Uložit</button>
            </Command>
          </details>}
          {context.manages && view==='lide' && <details className="disclosure"><summary>Přidat vztah k jednotce</summary>
            <Command operation="relation.add" organization={o} back={back} values={{person_id:item.id}}>
              <SelectField label="Jednotka" name="unit_id" options={opts(units,'unit_number')} required/>
              <SelectField label="Vztah" name="kind" options={Object.entries(labels).map(([id,label])=>({id,label}))} required/>
              <div className="form-grid">
                <Field label="Platnost od" name="valid_from" type="date" required/>
                <Field label="Platnost do" name="valid_to" type="date"/>
                <Field label="Podíl vlastníka (např. 0,5)" name="share" type="number" step="0.000001" min="0.000001"/>
              </div><button className="button">Přidat vztah</button>
            </Command>
          </details>}
          {(context.owner || kind==='unit' && context.manages) && <details><summary>Archivace</summary>
            <Command operation={kind+'.archive'} organization={o} back={back} values={{id:item.id}}>
              <button className="button ghost">Archivovat {title}</button>
            </Command>
          </details>}
        </article>;
      })}</div>
    </section>
  </>;
}

function PropertyFields({kind,item,buildings,units,owner}:{kind:string;item?:Row;buildings:Row[];units:Row[];owner:boolean}) {
  return <div className="form-grid">
    <Field label={kind==='unit' ? 'Označení jednotky' : kind==='person' ? 'Jméno nebo název' : 'Název domu'}
      name="name" required maxLength={kind==='unit' ? 120 : 180} value={item ? kind==='person' ? personName(item) : str(item,kind==='unit' ? 'unit_number' : 'name') : undefined}/>
    {kind==='building' && <>
      <Field label="Ulice a číslo" name="street" value={str(item,'street')} maxLength={180}/>
      <Field label="Město" name="city" value={str(item,'city')} maxLength={120}/>
      <Field label="PSČ" name="postal_code" value={str(item,'postal_code')} maxLength={20}/>
      <Field label="Interní kód" name="code" value={str(item,'code')} maxLength={40}/>
    </>}
    {kind==='unit' && <>
      {!item && <SelectField label="Objekt" name="building_id" options={opts(buildings)} required/>}
      <Field label="Podlaží" name="floor" value={str(item,'floor_label')} maxLength={40}/>
      <Field label="Typ jednotky" name="unit_type" value={str(item,'unit_type')} maxLength={80}/>
      <Field label="Plocha v m²" name="area" type="number" step="0.01" min="0" value={str(item,'area_m2')}/>
    </>}
    {kind==='person' && <>
      <SelectField label="Typ osoby" name="person_type" value={str(item,'person_type')||'natural'}
        options={[{id:'natural',label:'Fyzická osoba'},{id:'legal',label:'Právnická osoba'}]} required/>
      <Field label="E-mail" name="email" type="email" value={str(item,'email')} maxLength={254}/>
      <Field label="Telefon" name="phone" type="tel" value={str(item,'phone')} maxLength={40}/>
      {!item && <SelectField label="Bydlí v jednotce" name="unit_id" options={opts(units,'unit_number')} required={!owner} placeholder="Bez přiřazení"/>}
    </>}
  </div>;
}
