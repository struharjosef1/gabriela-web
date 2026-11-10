import {createServer} from 'node:http';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {actors,asActor,createDatabase} from './db-fixture.mjs';
import {seed} from './lifecycle.mjs';

const db=await createDatabase();
const fixture=await seed(db);
const secret='only-a-local-test-secret';
const port=54321;
const allowed=new Set(['organizations','organization_members','buildings','units','persons','tickets','ticket_categories','priorities',
  'workflow_statuses','ticket_messages','ticket_assignments','ticket_status_history','ticket_attachments','notifications',
  'user_preferences','support_access_grants','audit_logs','unit_occupancies','unit_ownerships','building_manager_assignments']);
const relations={
  'organization_members.organizations':['organization_id','organizations'],
  'tickets.workflow_statuses':['status_id','workflow_statuses'],
  'tickets.priorities':['priority_id','priorities'],
  'tickets.ticket_categories':['category_id','ticket_categories']
};
const rpc={
  gab_command:['operation','o','payload','request_id'],gab_member_directory:['o'],gab_list_invitations:['o'],
  gab_pending_invitations:[],gab_delivery_overview:['o'],gab_can_manage_ticket:['i'],
  gab_set_notification_preferences:['in_app','email'],gab_record_session:[]
};
function user(actor) {
  return {id:actors[actor],email:actor+'@gabriela.test',email_confirmed_at:'2026-01-01T00:00:00Z',
    role:'authenticated',aud:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z',factors:[]};
}
function token(actor) {
  const parts=[{typ:'JWT',alg:'HS256'},{sub:actors[actor],aud:'authenticated',role:'authenticated',
    aal:['resident','tech'].includes(actor)?'aal1':'aal2',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,
    amr:[{method:'password',timestamp:Math.floor(Date.now()/1000)}]}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url'));
  return parts.join('.')+'.'+createHmac('sha256',secret).update(parts.join('.')).digest('base64url');
}
function identify(header) {
  const parts=header?.replace(/^Bearer /,'').split('.') ?? [];
  if(parts.length!==3) return;
  const expected=createHmac('sha256',secret).update(parts.slice(0,2).join('.')).digest();
  const supplied=Buffer.from(parts[2],'base64url');
  if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) return;
  const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());
  const actor=Object.keys(actors).find(key=>actors[key]===claims.sub);
  return {actor,aal:claims.aal};
}
function ident(x){
  if(!/^[a-z_][a-z0-9_]*$/.test(x)) throw new Error('Invalid identifier');
  return '"'+x+'"';
}
function columns(source) {
  return source.match(/[a-z_][a-z0-9_]*(?:!inner)?(?:\([a-z0-9_,]+\))?/g) ?? [];
}
function readQuery(table,params) {
  const args=[];
  const bind=value=>{args.push(value);return '$'+args.length;};
  const conditions=[];
  const joins=new Map();
  const cols=columns(params.get('select') ?? 'id').map(col=>{
    if(!col.includes('(')) return 't.'+ident(col);
    const [relation,list]=col.split('(');
    const [target,mode]=relation.split('!');
    const fk=relations[table+'.'+target];
    if(!fk) throw new Error('Unsupported relation');
    joins.set(target,(mode==='inner'?'join ':'left join ')+ident(fk[1])+' '+ident(target)+' on '+ident(target)+'.id=t.'+ident(fk[0]));
    return 'case when '+ident(target)+'.id is null then null else json_build_object('+list.slice(0,-1).split(',').map(k=>"'"+k+"',"+ident(target)+'.'+ident(k)).join(',')+') end as '+ident(target);
  });
  for(const [key,value] of params){
    if(['select','limit','offset','order'].includes(key))continue;
    const parts=key.split('.');
    const field=parts.length===2?ident(parts[0])+'.'+ident(parts[1]):'t.'+ident(key);
    if(value.startsWith('eq.')) conditions.push(field+'='+bind(value.slice(3)));
    else if(value==='is.null') conditions.push(field+' is null');
    else throw new Error('Unsupported filter '+key);
  }
  const order=params.get('order')?.split(',').map(value=>{
    const [key,direction]=value.split('.');
    return 't.'+ident(key)+(direction==='desc'?' desc':' asc');
  }).join(',');
  const sql='select '+cols.join(',')+' from public.'+ident(table)+' t '+[...joins.values()].join(' ')
    +(conditions.length?' where '+conditions.join(' and '):'')+(order?' order by '+order:'')
    +' limit '+bind(Number(params.get('limit')??1000))+' offset '+bind(Number(params.get('offset')??0));
  return {sql,args};
}
async function body(req) {
  let buffer='';
  for await (const part of req) buffer+=part;
  return buffer?JSON.parse(buffer):{};
}
const server=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:3100');
  res.setHeader('Access-Control-Allow-Headers','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Content-Type','application/json');
  function send(status,value){res.statusCode=status;res.end(JSON.stringify(value));}
  if(req.method==='OPTIONS'){res.statusCode=204;res.end();return;}
  const url=new URL(req.url,'http://127.0.0.1:'+port);
  try{
    if(url.pathname==='/auth/v1/token'){
      const payload=await body(req);
      const actor=String(payload.email ?? '').split('@')[0];
      if(!actors[actor] || payload.password!=='Local-Test-Password!')return send(400,{msg:'Invalid login'});
      return send(200,{access_token:token(actor),refresh_token:'local-'+actor,token_type:'bearer',expires_in:3600,user:user(actor)});
    }
    const identity=identify(req.headers.authorization);
    if(!identity?.actor)return send(401,{message:'Unauthenticated'});
    if(url.pathname==='/auth/v1/user')return send(200,user(identity.actor));
    if(url.pathname==='/auth/v1/logout'){res.statusCode=204;res.end();return;}
    if(url.pathname.startsWith('/rest/v1/rpc/')){
      const name=url.pathname.split('/').at(-1);
      if(!Object.hasOwn(rpc,name))return send(404,{message:'Unknown function'});
      const payload=await body(req);
      const args=rpc[name].map(key=>key==='payload'?JSON.stringify(payload[key]):payload[key]);
      const call=ident(name)+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')';
      const scalar=['gab_command','gab_can_manage_ticket','gab_set_notification_preferences','gab_record_session'].includes(name);
      const {rows}=await asActor(db,identity.actor,tx=>tx.query(scalar?'select '+call+' as result':'select * from '+call,args),identity.aal);
      return send(200,scalar?rows[0].result:rows);
    }
    if(url.pathname.startsWith('/rest/v1/')){
      const table=url.pathname.split('/').at(-1);
      if(!allowed.has(table))return send(404,{message:'Unknown table'});
      const {sql,args}=readQuery(table,url.searchParams);
      const {rows}=await asActor(db,identity.actor,tx=>tx.query(sql,args),identity.aal);
      const acceptsObject=req.headers.accept==='application/vnd.pgrst.object+json';
      return send(200,acceptsObject?(rows[0]??null):rows);
    }
    return send(404,{message:'Unknown test route'});
  }catch(error){console.error(req.url,error.message,error.code);send(400,{message:error.message,code:error.code,details:null,hint:null});}
});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({...fixture,actors})));
