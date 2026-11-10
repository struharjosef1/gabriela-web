import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {actors,asActor,createDatabase} from './db-fixture.mjs';

export async function seed(db) {
  for(const [name,id] of Object.entries(actors)){
    await db.query('insert into auth.users values ($1,$2,now())',[id,name+'@gabriela.test']);
  }
  const org=async(actor,name)=>(await db.query('select gab_provision_organization($1,$2) as id',[actors[actor],name])).rows[0].id;
  const a=await org('owner','Bytová správa Javor');
  const b=await org('owner2','Oddělená organizace');
  const command=(actor,operation,o,payload,requestId=randomUUID(),aal='aal2')=>asActor(db,actor,async tx=>
    (await tx.query('select gab_command($1,$2,$3,$4) as result',[operation,o,JSON.stringify(payload),requestId])).rows[0].result.id,aal);
  const house=await command('owner','building.save',a,{name:'Javorová 18',street:'Javorová 18',city:'Brno'});
  const otherHouse=await command('owner','building.save',a,{name:'Nepřidělený dům'});
  const foreignHouse=await command('owner2','building.save',b,{name:'Cizí dům'});
  async function invite(user,role,fields={}){
    const id=await command('owner','invitation.create',a,{email:user+'@gabriela.test',role,...fields});
    await command(user,'invitation.accept',a,{id},randomUUID(),'aal1');
    return id;
  }
  await invite('manager','manager',{building_id:house});
  const unit=await command('manager','unit.save',a,{building_id:house,name:'Byt 12',floor:'2',unit_type:'Byt'});
  const person=await command('manager','person.save',a,{unit_id:unit,name:'Zkušební obyvatel',email:'resident@gabriela.test'});
  await invite('resident','resident',{person_id:person});
  await invite('tech','technician');
  const category=(await db.query('select id from ticket_categories where organization_id=$1 order by id limit 1',[a])).rows[0].id;
  const priority=(await db.query("select id from priorities where organization_id=$1 and code='normal'",[a])).rows[0].id;
  return {a,b,house,otherHouse,foreignHouse,unit,person,category,priority,command};
}

export async function exercise(db){
  const {a,b,house,otherHouse,foreignHouse,unit,person,category,priority,command}=await seed(db);
  const count=(actor,table,aal='aal2')=>asActor(db,actor,async tx=>Number((await tx.query('select count(*) as n from '+table)).rows[0].n),aal);
  assert.equal(await count('owner','buildings','aal1'),0,'Owner must complete MFA');
  assert.equal(await count('manager','buildings'),1,'Manager sees only assigned building');
  assert.equal(await count('resident','units'),1,'Resident sees own unit only');
  assert.equal(await count('tech','units'),0,'Technician cannot read units');
  await assert.rejects(command('manager','building.save',a,{id:otherHouse,name:'Pokus'}),e=>e.code==='42501');
  await assert.rejects(command('owner','unit.save',a,{building_id:foreignHouse,name:'Pokus'}),e=>e.code==='42501');
  const invitation=await command('owner','invitation.create',a,{email:'resident@gabriela.test',role:'resident',person_id:person});
  await assert.rejects(command('outsider','invitation.accept',a,{id:invitation}),e=>e.code==='42501');
  const requestId=randomUUID();
  const payload={building_id:house,unit_id:unit,category_id:category,priority_id:priority,title:'Nefunguje osvětlení',description:'Světlo na chodbě nesvítí'};
  const ticket=await command('resident','ticket.create',a,payload,requestId,'aal1');
  assert.equal(await command('resident','ticket.create',a,payload,requestId,'aal1'),ticket,'Retry returns original ticket');
  await assert.rejects(command('resident','ticket.create',a,{...payload,title:'Změna'},requestId),e=>e.code==='23505');
  await assert.rejects(command('resident','ticket.create',a,{...payload,building_id:otherHouse}),e=>e.code==='42501');
  assert.equal(await count('owner2','tickets'),0);
  assert.equal(await count('tech','tickets'),0);
  await assert.rejects(asActor(db,'owner2',tx=>tx.query('insert into ticket_watchers(organization_id,ticket_id,user_id) values($1,$2,$3)',[b,ticket,actors.owner2])),e=>e.code==='42501');
  await assert.rejects(command('manager','ticket.transition',a,{id:ticket,status:'closed'}),e=>e.code==='22023');
  const t=(actor,status,reason)=>command(actor,'ticket.transition',a,{id:ticket,status,reason});
  await t('manager','accepted');
  await command('manager','ticket.assign',a,{id:ticket,user_id:actors.tech});
  assert.equal(await count('tech','tickets'),1);
  await command('manager','ticket.message',a,{id:ticket,body:'Interní poznámka',internal:true});
  await command('manager','ticket.message',a,{id:ticket,body:'Zpráva pro technika',internal:true,technician_visible:true});
  assert.equal(await count('resident','ticket_messages'),0);
  assert.equal(await count('tech','ticket_messages'),1);
  await assert.rejects(command('resident','ticket.message',a,{id:ticket,body:'Neoprávněný interní zápis',internal:true}),e=>e.code==='42501');
  await assert.rejects(t('manager','waiting_vendor'),e=>e.message==='GAB_DUE');
  await command('manager','ticket.schedule',a,{id:ticket,due_at:'2026-11-30T22:59:59Z'});
  await t('manager','in_progress');
  await assert.rejects(t('tech','resolved'),e=>e.message==='GAB_REASON');
  await t('tech','resolved','Vyměněno svítidlo.');
  await command('resident','ticket.dispute',a,{id:ticket,reason:'Ještě nesvítí sousední část chodby.'});
  await t('tech','resolved','Druhé svítidlo vyměněno.');
  await command('resident','ticket.confirm',a,{id:ticket});
  await t('manager','closed');
  assert.equal(await count('manager','ticket_status_history'),7);
  assert.ok(await count('resident','notifications')>0);
  assert.equal(await count('owner2','audit_logs'),2);
  assert.equal(await count('resident','audit_logs'),0);
  await assert.rejects(asActor(db,'resident',tx=>tx.query('update tickets set title=$1 where id=$2',['Pokus',ticket])),e=>e.code==='42501');
  const args=[a,ticket,actors.resident,'aal1',a+'/'+ticket+'/'+randomUUID(),'overeni.png','image/png',32,'1'.repeat(64)];
  await assert.rejects(asActor(db,'resident',tx=>tx.query('select gab_attach_scanned_file($1,$2,$3,$4,$5,$6,$7,$8,$9)',args)),e=>e.code==='42501');
  const attachment=(await db.transaction(async tx=>{
    await tx.exec('set local role service_role');
    return tx.query('select gab_attach_scanned_file($1,$2,$3,$4,$5,$6,$7,$8,$9) as id',args);
  })).rows[0].id;
  const link=await asActor(db,'resident',tx=>tx.query('select * from gab_download_file($1,$2,$3)',[a,ticket,attachment]),'aal1');
  assert.equal(link.rows[0].original_filename,'overeni.png');
  await assert.rejects(asActor(db,'owner2',tx=>tx.query('select * from gab_download_file($1,$2,$3)',[a,ticket,attachment])),e=>e.code==='42501');
  const techMembership=(await db.query("select id from organization_members where organization_id=$1 and role='technician'",[a])).rows[0].id;
  await command('owner','member.revoke',a,{id:techMembership});
  assert.equal(await count('tech','tickets'),0);
  // Delivery lease and completion use a service identity and never send in the test.
  const service=(sql,params=[])=>db.transaction(async tx=>{
    await tx.exec('set local role service_role');
    return tx.query(sql,params);
  });
  const deliveries=(await service('select * from gab_claim_email()')).rows;
  assert.ok(deliveries.length>0);
  const delivery=deliveries[0];
  assert.equal((await service('select gab_finish_email($1,$2,false,null,$3) as ok',[delivery.id,delivery.lease,'test'])).rows[0].ok,true);
  assert.equal((await service('select gab_finish_email($1,$2,true,$3,null) as ok',[delivery.id,delivery.lease,'stale'])).rows[0].ok,false);
  assert.equal(await db.query("select count(*)::int as n from notification_deliveries where status='failed'").then(r=>r.rows[0].n),1);
  await db.query("insert into platform_user_roles(user_id,role) values($1,'support_operator')",[actors.outsider]);
  const grant=(await asActor(db,'owner',tx=>tx.query('select gab_support_grant($1,$2,$3,$4,$5) as id',
    [a,'outsider@gabriela.test','Kontrola fronty','TEST-1',20]))).rows[0].id;
  assert.equal(await count('outsider','tickets'),0);
  await assert.rejects(asActor(db,'outsider',tx=>tx.query('select gab_support_diagnostics($1)',[grant]),'aal1'),e=>e.code==='42501');
  const diagnostics=await asActor(db,'outsider',tx=>tx.query('select gab_support_diagnostics($1) as data',[grant]));
  assert.equal(diagnostics.rows[0].data.tickets,1);
  await asActor(db,'owner',tx=>tx.query('select gab_support_revoke($1,$2)',[a,grant]));
  await assert.rejects(asActor(db,'outsider',tx=>tx.query('select gab_support_diagnostics($1)',[grant])),e=>e.code==='42501');
  const audit=await count('owner','audit_logs');
  console.log('PASS: migration, invitations, MFA, building scope, tenant isolation, idempotence, status lifecycle, private notes, notification, attachment authorization, delivery retry, scoped support, revocation; audit entries: '+audit);
}

if (process.argv[1]===new URL(import.meta.url).pathname) {
  const db=await createDatabase();
  try { await exercise(db); }
  catch(e){console.error(e.message,e.code,e.where,e.internalQuery);process.exitCode=1;}
  finally {await db.close();}
}
