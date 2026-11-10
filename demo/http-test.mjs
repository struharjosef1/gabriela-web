import assert from 'node:assert/strict';
import {unzipSync,strFromU8} from 'fflate';

const base='http://127.0.0.1:3100';
const api='http://127.0.0.1:54321';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(url) {
  for(let i=0;i<100;i++){
    try {const response=await fetch(url);if(response.status<500)return;}
    catch {}
    await delay(300);
  }
  throw new Error('Not reachable: '+url);
}
await Promise.all([waitFor(api),waitFor(base+'/api/health')]);

async function login(actor) {
  const response=await fetch(api+'/auth/v1/token?grant_type=password',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:actor+'@gabriela.test',password:'Local-Test-Password!'})
  });
  assert.equal(response.status,200);
  const session=await response.json();
  session.expires_at=Math.floor(Date.now()/1000)+3600;
  return 'sb-127-auth-token=base64-'+Buffer.from(JSON.stringify(session)).toString('base64url');
}
const [resident,manager,tech,other]=await Promise.all(['resident','manager','tech','owner2'].map(login));
async function page(cookie,path) {
  const response=await fetch(new URL(path,base),{headers:{cookie},redirect:'manual'});
  const html=await response.text();
  assert.equal(response.status,200,[path,response.headers.get('location'),html.slice(0,900)].join('\n'));
  return html;
}
function decode(text) {
  return text.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>');
}
function input(tag,key) {
  return decode(tag.match(new RegExp(' '+key+'="([^"]*)"'))?.[1] ?? '');
}
function actionForm(html,operation) {
  const forms=html.match(/<form\b[^>]*>[\s\S]*?<\/form>/g) ?? [];
  const form=forms.find(f=>f.includes('name="operation"') && f.includes('value="'+operation+'"'));
  assert.ok(form,'Missing form '+operation);
  return form;
}
function selected(form,name,desired) {
  const select=(form.match(/<select\b[^>]*>[\s\S]*?<\/select>/g) ?? []).find(s=>s.includes('name="'+name+'"'));
  assert.ok(select,'Missing select '+name);
  const option=(select.match(/<option\b[^>]*>[\s\S]*?<\/option>/g) ?? []).find(o=>decode(o.replace(/<[^>]*>/g,'')).trim()===desired);
  assert.ok(option,'Missing option '+desired+' in '+name);
  return input(option,'value');
}
async function submit(cookie,path,html,operation,values) {
  const form=actionForm(html,operation);
  const data=new FormData();
  for(const tag of form.match(/<input\b[^>]+>/g) ?? []) {
    if(input(tag,'type')==='hidden') data.append(input(tag,'name'),input(tag,'value'));
  }
  for(const [key,value] of Object.entries(values))data.set(key,value);
  const response=await fetch(new URL(path,base),{method:'POST',headers:{cookie,origin:base},body:data,redirect:'manual'});
  assert.equal(response.status,303,operation+' response '+response.status+' '+(await response.text()).slice(0,500));
  const location=response.headers.get('location');
  assert.ok(location && !location.includes('error='),operation+' -> '+location);
  return location;
}

const noSession=await fetch(base+'/dashboard',{redirect:'manual'});
assert.equal(noSession.status,307);
assert.match(noSession.headers.get('location'),/\/login/);
const h=await page(resident,'/dashboard/tikety');
assert.match(h,/Nahlásit požadavek/);
const form=actionForm(h,'ticket.create');
const ticketTitle='Netěsní vstupní dveře';
const path=await submit(resident,'/dashboard/tikety',h,'ticket.create',{
  building_id:selected(form,'building_id','Javorová 18'),
  unit_id:(await (await fetch(api+'/rest/v1/units?select=id',{headers:{Authorization:'Bearer '+JSON.parse(Buffer.from(resident.split('base64-')[1],'base64url')).access_token}})).json())[0].id,
  category_id:selected(form,'category_id','Společné prostory'),
  priority_id:selected(form,'priority_id','Běžná'),
  title:ticketTitle,description:'Závada vznikla dnes ráno.'
});
assert.match(path,/\/dashboard\/tikety\/[a-f0-9-]+/);
assert.match(await page(resident,path),/Netěsní vstupní dveře/);
async function transition(actor,state,reason=''){
  const html=await page(actor,path);
  await submit(actor,path,html,'ticket.transition',{status:state,reason});
}
await transition(manager,'accepted');
let detail=await page(manager,path);
const techId=selected(actionForm(detail,'ticket.assign'),'user_id','tech@gabriela.test');
await submit(manager,path,detail,'ticket.assign',{user_id:techId});
await transition(manager,'in_progress');
detail=await page(manager,path);
await submit(manager,path,detail,'ticket.message',{body:'Interní záznam z kontroly.',internal:'true'});
assert.doesNotMatch(await page(resident,path),/Interní záznam z kontroly/);
assert.doesNotMatch(await page(tech,path),/Interní záznam z kontroly/);
await transition(tech,'resolved','Seřízené dveře a kontrola dovření.');
await submit(resident,path,await page(resident,path),'ticket.confirm',{});
await transition(manager,'closed');
const closed=await page(manager,path);
assert.match(closed,/>Uzavřeno</);
assert.match(closed,/Historie stavů/);
const wrong=new URL(path,base);
wrong.search='';
const denial=await fetch(wrong,{headers:{cookie:other},redirect:'manual'});
assert.doesNotMatch(await denial.text(),/Netěsní vstupní dveře/);
const exported=await fetch(base+'/api/export',{headers:{cookie:manager}});
assert.equal(exported.status,200);
assert.match(await exported.text(),/Netěsní vstupní dveře/);
const workbook=await fetch(base+'/api/export?format=xlsx',{headers:{cookie:manager}});
assert.equal(workbook.status,200);
const zip=unzipSync(new Uint8Array(await workbook.arrayBuffer()));
assert.match(strFromU8(zip['xl/worksheets/sheet1.xml']),/Netěsní vstupní dveře/);
const report=await fetch(base+'/api/export?format=pdf',{headers:{cookie:manager}});
assert.equal(report.status,200);
assert.equal(Buffer.from(await report.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
const account=await page(manager,'/ucet');
assert.match(account,/Nastavení hesla/);
console.log('PASS: HTTP login session, server-rendered pages and actual Next.js form actions through ticket lifecycle, hidden internal notes, tenant denial, and CSV, XLSX, PDF exports.');
