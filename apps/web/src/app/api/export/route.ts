import {randomUUID} from 'node:crypto';
import {requireCurrentContext} from '@/lib/auth-context';
import {date,directory,filterTickets,lookup,rows,selectStatus,statusLabels,str,ticketColumns,type Query} from '@/lib/data';
import {csv,pdf,xlsx,type ExportRow} from '@/lib/exports';

export const runtime='nodejs';

const contentTypes:Record<string,string>={
  csv:'text/csv; charset=utf-8',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf:'application/pdf'
};

export async function GET(request:Request) {
  const query=Object.fromEntries(new URL(request.url).searchParams) as Query;
  const format=typeof query.format==='string' ? query.format : 'csv';
  const mime=contentTypes[format];
  if (!Object.hasOwn(contentTypes,format) || !mime) return new Response('Neznámý formát',{status:400});
  const context=await requireCurrentContext(typeof query.org==='string' ? query.org : undefined);
  if (!context.manages) return new Response('Zakázáno',{status:403});
  const [{buildings,units},tickets]=await Promise.all([directory(context),rows(context,'tickets',ticketColumns,{all:true,order:'created_at'})]);
  const filtered=filterTickets(tickets,query,buildings,units);
  if (filtered.length>5000) return new Response('Upřesněte filtr. Export má limit 5 000 požadavků.',{status:422});
  const lines:ExportRow[]=[
    ['Číslo','Název','Objekt','Jednotka','Stav','Priorita','Termín','Vytvořeno'],
    ...filtered.map(t=>['GAB-'+str(t,'ticket_number'),str(t,'title'),lookup(buildings,t.building_id),
      lookup(units,t.unit_id,'unit_number'),statusLabels[selectStatus(t)] ?? '',
      (t.priorities as {name?:string}|null)?.name ?? '',date(t.due_at),date(t.created_at)])
  ];
  let output:string|ArrayBuffer;
  try {
    if (format==='csv') output=csv(lines);
    else {
      const file=format==='pdf' ? await pdf(lines,context.organizationName) : xlsx(lines);
      output=Uint8Array.from(file).buffer;
    }
  } catch { return new Response('Export se nepodařilo vytvořit',{status:500}); }
  const {error}=await context.supabase.rpc('gab_command',{
    operation:'audit.export',o:context.organizationId,payload:{format,count:filtered.length},request_id:randomUUID()
  });
  if (error) return new Response('Export nelze zapsat do auditu',{status:503});
  return new Response(output,{headers:{
    'Content-Type':mime,'Content-Disposition':'attachment; filename="gabriela-pozadavky.'+format+'"',
    'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'
  }});
}
