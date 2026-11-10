import { randomUUID } from 'node:crypto';
import { command } from '@/app/actions';
import { param, type Query } from '@/lib/data';

const errors:Record<string,string>={
  denied:'K této změně nemáte oprávnění nebo záznam už není dostupný.',
  invalid:'Zkontrolujte vyplněné údaje a povolený stav.',
  reason:'Doplňte zdůvodnění nebo shrnutí výsledku.',
  due:'Při čekání je nutný termín další kontroly.',
  catalog:'Nejprve doplňte číselníky v nastavení organizace.',
  duplicate:'Záznam s těmito údaji už existuje.',
  dependencies:'Záznam má navázané jednotky nebo požadavky.',
  save:'Změnu se nepodařilo uložit. Zkuste to znovu.',
  mail:'Pozvánka je uložená. Doručení e-mailem se nepodařilo.',
  existing:'Tento účet už existuje. Pozvánku najde po přihlášení v části Můj účet.',
  file:'Soubor se nepodařilo přiložit. Povolen je prověřený PDF, JPG, PNG, WebP, DOCX nebo XLSX do 20 MB.',
  scan:'Kontrola souborů je momentálně nedostupná.',
  download:'Soubor není dostupný.'
};

export function Feedback({query}:{query:Query}) {
  const error=param(query,'error');
  if (error) return <p role="alert" className="form-error">{errors[error] ?? errors.save}</p>;
  if (param(query,'saved')) return <p role="status" className="notice">Změna byla uložena.</p>;
  return null;
}

export function Heading({tag,title,description}:{tag:string;title:string;description?:string}) {
  return <div className="page-heading"><div><span className="eyebrow">{tag}</span><h1>{title}</h1>{description && <p>{description}</p>}</div></div>;
}

export function Command({organization,back,operation,values,children,className='stack'}:{
  organization:string;back:string;operation:string;values?:Record<string,string>;children:React.ReactNode;className?:string
}) {
  return <form action={command} className={className}>
    <input type="hidden" name="operation" value={operation}/>
    <input type="hidden" name="organization" value={organization}/>
    <input type="hidden" name="request_id" value={randomUUID()}/>
    <input type="hidden" name="back" value={back}/>
    {Object.entries(values ?? {}).map(([key,value])=><input key={key} type="hidden" name={key} value={value}/>)}
    {children}
  </form>;
}

export function Field({label,name,value,required=false,type='text',maxLength,step,min}:{
  label:string;name:string;value?:string | undefined;required?:boolean;type?:string;maxLength?:number;step?:string;min?:string
}) {
  return <label>{label}<input name={name} type={type} defaultValue={value} required={required} maxLength={maxLength} step={step} min={min}/></label>;
}

export function SelectField({label,name,options,required=false,value,placeholder='Vyberte…'}:{
  label:string;name:string;options:Array<{id:string;label:string}>;required?:boolean;value?:string | undefined;placeholder?:string
}) {
  return <label>{label}<select name={name} defaultValue={value ?? ''} required={required}>
    <option value="">{placeholder}</option>{options.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
  </select></label>;
}

export function Empty({children='Zatím tu nejsou žádné záznamy.'}:{children?:React.ReactNode}) {
  return <div className="empty-state">{children}</div>;
}
