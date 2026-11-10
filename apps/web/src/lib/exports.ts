import 'server-only';
import {join} from 'node:path';
import {strToU8,zipSync} from 'fflate';
import PDFDocument from 'pdfkit';

export type ExportRow=string[];

function safeCsv(value:string) {
  const safe=/^[\s\uFEFF]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? "'"+value : value;
  return '"'+safe.replaceAll('"','""')+'"';
}

export function csv(rows:ExportRow[]) {
  return '\uFEFF'+rows.map(row=>row.map(safeCsv).join(';')).join('\r\n');
}

function xml(text:string) {
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g,'')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}
export function xlsx(rows:ExportRow[]) {
  const spreadsheet='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const documents='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const relationships='http://schemas.openxmlformats.org/package/2006/relationships';
  const cells=rows.map((row,index)=>'<row r="'+(index+1)+'">'+row.map((value,col)=>
    '<c r="'+String.fromCharCode(65+col)+(index+1)+'" t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>'
  ).join('')+'</row>').join('');
  const entries={
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      +'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      +'<Default Extension="xml" ContentType="application/xml"/>'
      +'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      +'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="'+relationships+'"><Relationship Id="rId1" Type="'+documents+'/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<workbook xmlns="'+spreadsheet+'" xmlns:r="'+documents+'"><sheets><sheet name="Požadavky" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="'+relationships+'"><Relationship Id="rId1" Type="'+documents+'/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':'<worksheet xmlns="'+spreadsheet+'"><cols><col min="1" max="1" width="16" customWidth="1"/>'
      +'<col min="2" max="2" width="52" customWidth="1"/><col min="3" max="8" width="23" customWidth="1"/></cols><sheetData>'+cells+'</sheetData>'
      +'<autoFilter ref="A1:H'+Math.max(1,rows.length)+'"/></worksheet>'
  };
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name,value])=>
    [name,strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+value)])));
}

export async function pdf(rows:ExportRow[],organization:string) {
  const document=new PDFDocument({size:'A4',margin:45,info:{Title:'Požadavky – GABRIELA'}});
  const chunks:Buffer[]=[];
  const finished=new Promise<Buffer>((resolve,reject)=>{
    document.on('data',(buffer:Buffer)=>chunks.push(buffer));
    document.on('end',()=>resolve(Buffer.concat(chunks)));
    document.on('error',reject);
  });
  document.font(join(process.cwd(),'assets','fonts','LiberationSans-Regular.ttf'));
  document.fontSize(12).fillColor('#256286').text('GABRIELA / Evidence požadavků');
  document.fontSize(23).fillColor('#14324b').text(organization);
  document.fontSize(10).fillColor('#475e72').text('Počet záznamů: '+Math.max(rows.length-1,0));
  document.moveDown();
  for(const row of rows.slice(1)) {
    if(document.y>document.page.height-140)document.addPage();
    document.fontSize(13).fillColor('#14324b').text(row[0]+' · '+row[1]);
    document.fontSize(10).fillColor('#475e72').text([row[2],row[3],row[4],row[5]].filter(Boolean).join(' · '));
    document.text('Termín: '+row[6]+'     Vytvořeno: '+row[7]);
    document.moveDown(.8);
  }
  document.end();
  return finished;
}
