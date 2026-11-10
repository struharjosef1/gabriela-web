import { requireCurrentContext } from '@/lib/auth-context';
import { param,type Query } from '@/lib/data';
import { DashboardShell } from '@/components/DashboardShell';
import { TicketDetail } from '@/components/TicketViews';

export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Query>}) {
  const [{id},query]=await Promise.all([params,searchParams]);
  const context=await requireCurrentContext(param(query,'org')||undefined);
  return <DashboardShell context={context} view="tikety"><TicketDetail context={context} query={query} id={id}/></DashboardShell>;
}
