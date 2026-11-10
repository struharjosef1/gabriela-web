import { requireCurrentContext } from '@/lib/auth-context';
import { param,type Query } from '@/lib/data';
import { DashboardShell } from '@/components/DashboardShell';
import { Overview } from '@/components/OperationsViews';

export default async function Dashboard({searchParams}:{searchParams:Promise<Query>}) {
  const query=await searchParams;
  const context=await requireCurrentContext(param(query,'org')||undefined);
  return <DashboardShell context={context} view=""><Overview context={context} query={query}/></DashboardShell>;
}
