'use client';

import {useState} from 'react';


type Option={id:string;label:string};
export function TicketLocation({buildings,units,resident}:{
  buildings:Option[];units:Array<Option & {buildingId:string}>;resident:boolean
}) {
  const [building,setBuilding]=useState('');
  return <div className="form-grid">
    <label>Objekt<select name="building_id" required value={building} onChange={e=>setBuilding(e.target.value)}>
      <option value="">Vyberte objekt</option>
      {buildings.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label>
    <label>Jednotka<select key={building} name="unit_id" required={resident}>
      <option value="">{resident ? 'Vyberte jednotku' : 'Společné prostory'}</option>
      {units.filter(item=>item.buildingId===building).map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label>
  </div>;
}
