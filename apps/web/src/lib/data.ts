import type { CurrentContext } from '@/lib/auth-context';

export const statusLabels:Record<string,string> = {
  new:'Nové',accepted:'Přijato',assessment:'Čeká na posouzení',in_progress:'Pracuje se na tom',
  waiting_vendor:'Čeká na dodavatele',waiting_user:'Čeká na uživatele',resolved:'Vyřešeno',
  closed:'Uzavřeno',rejected:'Zamítnuto',canceled:'Stornováno',cancelled:'Stornováno'
};

export const transitions:Record<string,string[]> = {
  new:['accepted','rejected','canceled'],accepted:['assessment','in_progress','waiting_user','waiting_vendor'],
  assessment:['in_progress','waiting_user','waiting_vendor','rejected'],
  in_progress:['waiting_user','waiting_vendor','resolved'],waiting_user:['in_progress','resolved'],
  waiting_vendor:['in_progress','resolved'],resolved:['closed','in_progress']
};

export const closedStatuses = new Set(['closed','rejected','canceled','cancelled']);

export type Row={id:string;[key:string]:unknown};
export type Query=Record<string,string|string[]|undefined>;
export function param(query:Query,key:string) {
  const value=query[key];
  return typeof value==='string' ? value : '';
}
export function str(row:Row | undefined,key:string) {
  return String(row?.[key] ?? '');
}
export function lookup(rows:Row[],id:unknown,key='name') {
  return str(rows.find(row=>row.id===id),key);
}
export function date(value:unknown,showTime=false) {
  if (!value || Number.isNaN(Date.parse(String(value)))) return '—';
  return new Intl.DateTimeFormat('cs-CZ',{
    timeZone:'Europe/Prague',dateStyle:'medium',...(showTime ? {timeStyle:'short' as const} : {})
  }).format(new Date(String(value)));
}
export function localDay(value:unknown) {
  if (!value || Number.isNaN(Date.parse(String(value)))) return '';
  return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(String(value)));
}
export function href(path:string,organizationId:string,params:Record<string,string>={}) {
  return path+'?'+new URLSearchParams({org:organizationId,...params}).toString();
}
export function selectStatus(ticket:Row) {
  const status=ticket.workflow_statuses as {code?:string;name?:string} | null;
  return status?.code || '';
}
export function personName(person:Row) {
  return str(person,'display_name') || [str(person,'first_name'),str(person,'last_name')].filter(Boolean).join(' ');
}

export async function rows(context:CurrentContext,table:string,columns:string,options:{order?:string;ticket?:string;all?:boolean}={}):Promise<Row[]> {
  const output:Row[]=[];
  let offset=0;
  for (;;) {
    let query=context.supabase.from(table).select(columns).eq('organization_id',context.organizationId);
    if (options.ticket) query=query.eq('ticket_id',options.ticket);
    const {data,error}=await query.order(options.order ?? 'id',{ascending:!['created_at','changed_at'].includes(options.order ?? '')})
      .order('id').range(offset,offset+199);
    if (error) throw new Error('Nelze načíst data '+table);
    const page=(data ?? []) as unknown as Row[];
    output.push(...page);
    if (page.length<200 || !options.all) return output;
    offset+=page.length;
  }
}

export async function rpcRows(context:CurrentContext,name:string):Promise<Row[]> {
  const {data,error}=await context.supabase.rpc(name,{o:context.organizationId});
  if (error) throw new Error('Nelze načíst údaje organizace.');
  return (data ?? []) as Row[];
}
export const ticketColumns='id,ticket_number,title,description,building_id,unit_id,category_id,priority_id,reporter_person_id,reporter_user_id,created_at,due_at,resolution_summary,resolution_confirmed_at,resolution_disputed_at,workflow_statuses(code,name),priorities(code,name),ticket_categories(name)';

export async function directory(context:CurrentContext) {
  const [buildings,units]=await Promise.all([
    rows(context,'buildings','id,name,street,city,postal_code,code',{order:'name',all:true}),
    rows(context,'units','id,building_id,unit_number,floor_label,unit_type,area_m2,status',{order:'unit_number',all:true})
  ]);
  return {buildings,units};
}

export function filterTickets(tickets:Row[],query:Query,buildings:Row[]=[],units:Row[]=[]) {
  const q=param(query,'q').trim().toLocaleLowerCase('cs');
  const status=param(query,'stav');
  const building=param(query,'objekt');
  const priority=param(query,'priorita');
  const unit=param(query,'jednotka');
  const person=param(query,'osoba');
  const from=param(query,'od');
  const to=param(query,'do');
  return tickets.filter(ticket=>{
    const day=localDay(ticket.created_at);
    return (!q || [ticket.title,ticket.description,'GAB-'+ticket.ticket_number,lookup(buildings,ticket.building_id),lookup(units,ticket.unit_id,'unit_number')]
      .join(' ').toLocaleLowerCase('cs').includes(q))
      && (!status || status==='overdue' ? (!status || (!closedStatuses.has(selectStatus(ticket)) && !!ticket.due_at && Date.parse(String(ticket.due_at))<Date.now()))
        : selectStatus(ticket)===status)
      && (!building || ticket.building_id===building)
      && (!priority || ticket.priority_id===priority) && (!unit || ticket.unit_id===unit)
      && (!person || ticket.reporter_person_id===person) && (!from || day>=from) && (!to || day<=to);
  });
}
