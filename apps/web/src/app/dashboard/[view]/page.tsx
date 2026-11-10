import { notFound } from 'next/navigation';
import { requireCurrentContext } from '@/lib/auth-context';
import { param,type Query } from '@/lib/data';
import { DashboardShell } from '@/components/DashboardShell';
import { TicketsView } from '@/components/TicketViews';
import { PropertyView } from '@/components/PropertyViews';
import { AuditView,NotificationsView,SettingsView } from '@/components/OperationsViews';

export default async function View({params,searchParams}:{params:Promise<{view:string}>;searchParams:Promise<Query>}) {
  const [{view},query]=await Promise.all([params,searchParams]);
  const context=await requireCurrentContext(param(query,'org')||undefined);
  let page;
  if (view==='tikety') page=<TicketsView context={context} query={query}/>;
  else if (view==='oznameni') page=<NotificationsView context={context} query={query}/>;
  else if (view==='nastaveni') page=<SettingsView context={context} query={query}/>;
  else if (view==='audit') page=<AuditView context={context} query={query}/>;
  else if (['objekty','jednotky','lide'].includes(view) && context.role!=='technician') page=<PropertyView context={context} view={view} query={query}/>;
  else notFound();
  return <DashboardShell context={context} view={view}>{page}</DashboardShell>;
}
