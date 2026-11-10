import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../apps/web/',import.meta.url));
const appUrl='http://127.0.0.1:3100';
const apiUrl='http://127.0.0.1:54321';
const testing=process.argv.includes('--test');
const children=[];

function start(program,args,options={}) {
  const child=spawn(program,args,{stdio:'inherit',...options});
  children.push(child);
  return child;
}
function stop() {
  for(const child of children) if(child.exitCode===null) child.kill();
}
process.on('SIGINT',()=>{stop();process.exit(130);});
process.on('SIGTERM',()=>{stop();process.exit(143);});
try {
  const database=start(process.execPath,[fileURLToPath(new URL('./backend.mjs',import.meta.url))]);
  const web=start(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','-H','127.0.0.1','-p','3100'],{
    cwd:root,env:{...process.env,NEXT_PUBLIC_APP_URL:appUrl,NEXT_PUBLIC_SUPABASE_URL:apiUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'local-test',NEXT_PUBLIC_GABRIELA_TRIAL:'true',
      SUPABASE_SERVICE_ROLE_KEY:'',CLAMSCAN_PATH:'',RESEND_API_KEY:'',NEXT_TELEMETRY_DISABLED:'1'}
  });
  if (testing) {
    const test=start(process.execPath,[fileURLToPath(new URL('./http-test.mjs',import.meta.url))]);
    process.exitCode=await new Promise((resolve,reject)=>{
      test.once('exit',code=>resolve(code ?? 1));test.once('error',reject);
    });
  } else {
    for(let attempt=0;attempt<100;attempt++){
      if (web.exitCode!==null || database.exitCode!==null) throw new Error('Testovací služba se nespustila. Zkontrolujte, zda jsou porty 3100 a 54321 volné.');
      const ready=await Promise.all([appUrl+'/api/health',apiUrl].map(async url=>{
        try {return (await fetch(url,{signal:AbortSignal.timeout(1500)})).status<500;} catch {return false;}
      }));
      if(ready.every(Boolean)) break;
      if(attempt===99) throw new Error('Zkušební prostředí není dostupné.');
      await new Promise(resolve=>setTimeout(resolve,350));
    }
    console.log('\nGABRIELA: '+appUrl+'/login\nZkušební účty jsou uvedené na přihlašovací stránce.\n');
    const open=process.platform==='darwin' ? ['open',[appUrl+'/login']]
      : process.platform==='win32' ? ['cmd.exe',['/d','/c','start','',appUrl+'/login']]
      : ['xdg-open',[appUrl+'/login']];
    const opener=spawn(open[0],open[1],{stdio:'ignore'});
    opener.on('error',()=>{});
    await new Promise(resolve=>{web.once('exit',resolve);database.once('exit',resolve);});
  }
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
} finally {stop();}
