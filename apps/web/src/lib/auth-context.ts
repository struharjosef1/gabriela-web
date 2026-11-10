import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPublicSupabaseEnv } from '@/lib/supabase/env';

export const roleLabels: Record<string, string> = {
  organization_owner: 'Vlastník organizace', manager: 'Správce', resident: 'Obyvatel', technician: 'Technik'
};

export async function requireSession() {
  try {
    getPublicSupabaseEnv();
  } catch {
    redirect('/login?error=configuration');
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect('/login');
  return { supabase, user: data.user };
}

export async function requireCurrentContext(organizationId?: string) {
  const session = await requireSession();
  const { supabase, user } = session;
  const [{ data, error }, { data: assurance }] = await Promise.all([
    supabase.from('organization_members').select('organization_id,role,organizations!inner(id,name,is_active,archived_at)')
      .eq('user_id', user.id).eq('status', 'active').eq('organizations.is_active', true)
      .is('organizations.archived_at', null).order('organization_id'),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  ]);
  if (error) throw new Error('Nelze ověřit členství.');
  const memberships = (data ?? []).map(row => ({
    id: row.organization_id as string,
    role: row.role as string,
    name: (Array.isArray(row.organizations) ? row.organizations[0] : row.organizations)?.name as string
  }));
  if (!memberships.length) redirect('/ucet');
  const selected = organizationId ? memberships.find(item => item.id === organizationId) : memberships[0];
  if (!selected) redirect('/dashboard?error=denied');
  const roles = memberships.filter(item => item.id === selected.id).map(item => item.role);
  const role = ['organization_owner','manager','resident','technician'].find(item => roles.includes(item)) ?? selected.role;
  const manages = roles.includes('organization_owner') || roles.includes('manager');
  if (manages && assurance?.currentLevel !== 'aal2') redirect('/overeni');
  return {
    ...session, organizationId: selected.id, organizationName: selected.name, role, roles, manages,
    owner: roles.includes('organization_owner'),
    organizations: [...new Map(memberships.map(item => [item.id,item])).values()]
  };
}

export type CurrentContext = Awaited<ReturnType<typeof requireCurrentContext>>;
