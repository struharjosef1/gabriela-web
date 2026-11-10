'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireCurrentContext, requireSession } from '@/lib/auth-context';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';

const uuid = z.uuid();
const allowed = new Set([
  'notification.read','invitation.create','invitation.revoke','invitation.send','member.revoke','manager.assign','manager.unassign',
  'organization.update','catalog.init','category.save','priority.sla',
  'building.save','building.archive','unit.save','unit.archive','person.save','person.archive','relation.add','relation.end',
  'ticket.create','ticket.transition','ticket.assign','ticket.schedule','ticket.message','ticket.confirm','ticket.dispute'
]);

function siteUrl(path: string) {
  const origin = process.env.NEXT_PUBLIC_APP_URL;
  if (!origin) throw new Error('Chybí nastavení adresy aplikace');
  return new URL(path, origin).toString();
}

function formValue(form: FormData, key: string) {
  return String(form.get(key) ?? '').trim();
}

function backPath(value: string, organizationId: string) {
  const path = /^\/dashboard(?:\/(?:objekty|jednotky|lide|tikety|oznameni|audit|nastaveni)(?:\/[a-f0-9-]{36})?)?$/.test(value)
    ? value : '/dashboard';
  return new URL(path + '?org=' + organizationId, 'http://localhost');
}

export async function command(form: FormData) {
  const operation = formValue(form,'operation');
  const organization = uuid.safeParse(formValue(form,'organization'));
  if (!organization.success || !allowed.has(operation)) redirect('/dashboard?error=invalid');
  const { supabase, owner } = await requireCurrentContext(organization.data);
  const destination = backPath(formValue(form,'back'), organization.data);
  const request = uuid.safeParse(formValue(form,'request_id'));
  if (!request.success) redirect(destination.pathname + destination.search + '&error=invalid');
  const payload: Record<string,string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value==='string' && /^[a-z_]+$/.test(key) && !['operation','organization','request_id','back'].includes(key)) {
      payload[key] = value.trim();
    }
  }
  if (payload.due_at && /^\d{4}-\d{2}-\d{2}$/.test(payload.due_at)) {
    const day = payload.due_at;
    const evening = new Date(day+'T21:59:59Z');
    if (Number.isNaN(evening.getTime()) || evening.toISOString().slice(0,10)!==day) {
      redirect(destination.pathname + destination.search + '&error=invalid');
    }
    const hour = Number(new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Prague',hour:'2-digit',hourCycle:'h23'}).format(evening));
    evening.setUTCHours(evening.getUTCHours()+(23-hour));
    payload.due_at=evening.toISOString();
  }
  let errorCode: string | undefined;
  let result: { id?: string } | null = null;
  if (operation==='invitation.send') {
    if (!owner) errorCode='denied';
    else {
      const {data,error}=await supabase.rpc('gab_list_invitations',{o:organization.data});
      const invite = (data ?? []).find((row: {id:string}) => row.id===payload.id);
      if (error || !invite || invite.accepted_at || invite.revoked_at || new Date(invite.expires_at)<new Date()) errorCode='invalid';
      else {
        try {
          const admin = createAdminClient();
          const {error: inviteError} = await admin.auth.admin.inviteUserByEmail(invite.email, {
            redirectTo: siteUrl('/auth/potvrdit')
          });
          if (inviteError) errorCode=inviteError.code==='email_exists' || inviteError.code==='user_already_exists' ? 'existing' : 'mail';
        } catch { errorCode='mail'; }
      }
    }
  } else {
    const { data, error } = await supabase.rpc('gab_command', {
      operation, o: organization.data, payload, request_id: request.data
    });
    result=data;
    if (error) {
      errorCode=error.message==='GAB_REASON' ? 'reason'
        : error.message==='GAB_DUE' ? 'due' : error.message==='GAB_CATALOG' ? 'catalog'
        : error.code==='42501' ? 'denied' : error.code==='23505' ? 'duplicate'
        : error.code==='23503' ? 'dependencies' : error.code?.startsWith('22') ? 'invalid' : 'save';
    }
  }
  if (errorCode) destination.searchParams.set('error',errorCode);
  else {
    if (operation==='ticket.create' && result?.id) destination.pathname='/dashboard/tikety/'+result.id;
    destination.searchParams.set('saved','1');
    revalidatePath('/dashboard','layout');
  }
  redirect(destination.pathname + destination.search);
}

export async function acceptInvitation(form: FormData) {
  const {supabase}=await requireSession();
  const id=uuid.safeParse(formValue(form,'id'));
  const o=uuid.safeParse(formValue(form,'organization'));
  if (!id.success || !o.success) redirect('/ucet?error=invalid');
  const {error}=await supabase.rpc('gab_command',{
    operation:'invitation.accept',o:o.data,payload:{id:id.data},request_id:randomUUID()
  });
  if (error) redirect('/ucet?error=denied');
  redirect('/dashboard?org='+o.data);
}

export async function signOut() {
  const {supabase}=await requireSession();
  await supabase.auth.signOut({scope:'local'});
  redirect('/login');
}

export async function resetPassword(form: FormData) {
  const email=z.email().safeParse(formValue(form,'email'));
  if (!email.success) redirect('/obnova-hesla?error=invalid');
  try {
    const supabase=await createClient();
    const {error}=await supabase.auth.resetPasswordForEmail(email.data,{redirectTo:siteUrl('/auth/potvrdit')});
    if (error && error.status!==400) throw error;
  } catch {
    redirect('/obnova-hesla?error=mail');
  }
  redirect('/obnova-hesla?sent=1');
}

export async function changePassword(form: FormData) {
  const {supabase}=await requireSession();
  const password=String(form.get('password') ?? '');
  if (password.length<12 || password.length>128 || password!==form.get('confirm')) redirect('/ucet?error=password');
  const {error}=await supabase.auth.updateUser({password});
  if (error) redirect('/ucet?error=password');
  redirect('/ucet?saved=1');
}

export async function revokeSessions() {
  const {supabase}=await requireSession();
  const {error}=await supabase.auth.signOut({scope:'others'});
  redirect(error ? '/ucet?error=save' : '/ucet?saved=1');
}

export async function saveNotificationPreferences(form:FormData) {
  const {supabase}=await requireSession();
  const {error}=await supabase.rpc('gab_set_notification_preferences',{
    in_app:form.get('in_app')==='true',email:form.get('email')==='true'
  });
  redirect(error ? '/ucet?error=save' : '/ucet?saved=1');
}

export async function supportGrant(form:FormData) {
  const o=uuid.safeParse(formValue(form,'organization'));
  if (!o.success) redirect('/dashboard?error=invalid');
  const {supabase,owner}=await requireCurrentContext(o.data);
  if (!owner) redirect('/dashboard?error=denied');
  const id=formValue(form,'id');
  const duration=Number(formValue(form,'minutes'));
  const result=id ? await supabase.rpc('gab_support_revoke',{o:o.data,g:id})
    : await supabase.rpc('gab_support_grant',{o:o.data,operator_email:formValue(form,'email'),
      reason_text:formValue(form,'reason'),reference:formValue(form,'reference'),minutes:duration});
  redirect('/dashboard/nastaveni?org='+o.data+(result.error ? '&error=invalid' : '&saved=1'));
}
