import 'server-only';
import {execFile} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';

const run=promisify(execFile);
export const maxFileSize=20*1024*1024;
const types:Record<string,string>={
  pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};
export function detectMedia(name:string,bytes:Buffer) {
  const ext=name.split('.').at(-1)?.toLowerCase() ?? '';
  const hex=bytes.subarray(0,8).toString('hex');
  const text=bytes.subarray(0,12).toString('ascii');
  const valid=(ext==='pdf' && text.startsWith('%PDF-'))
    || (['jpg','jpeg'].includes(ext) && hex.startsWith('ffd8ff'))
    || (ext==='png' && hex==='89504e470d0a1a0a')
    || (ext==='webp' && text.startsWith('RIFF') && text.endsWith('WEBP'))
    || (['docx','xlsx'].includes(ext) && hex.startsWith('504b0304')
      && bytes.includes('[Content_Types].xml') && bytes.includes(ext==='docx' ? 'word/document.xml' : 'xl/workbook.xml'));
  return valid ? types[ext] : undefined;
}
export async function scan(bytes:Buffer) {
  const scanner=process.env.CLAMSCAN_PATH;
  if (!scanner) return 'unavailable';
  const temp=await mkdtemp(join(tmpdir(),'gabriela-upload-'));
  try {
    const path=join(temp,'attachment');
    await writeFile(path,bytes,{mode:0o600});
    await run(scanner,['--no-summary','--infected',path],{timeout:45000,maxBuffer:65536});
    return 'clean';
  } catch (error) {
    return (error as {code?:unknown}).code===1 ? 'infected' : 'unavailable';
  } finally {
    await rm(temp,{recursive:true,force:true});
  }
}

export async function readUpload(request:Request):Promise<FormData> {
  const limit=maxFileSize+65536;
  const length=Number(request.headers.get('content-length') ?? 0);
  if (length>limit || !request.body) throw new Error('File size limit');
  const reader=request.body.getReader();
  const parts:Uint8Array[]=[];
  let size=0;
  try {
    for (;;) {
      const {value,done}=await reader.read();
      if (done) break;
      size+=value.byteLength;
      if (size>limit) {
        await reader.cancel();
        throw new Error('File size limit');
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size);
  let offset=0;
  for(const part of parts) {
    bytes.set(part,offset);
    offset+=part.byteLength;
  }
  return new Response(bytes,{headers:{'Content-Type':request.headers.get('content-type') ?? ''}}).formData();
}
