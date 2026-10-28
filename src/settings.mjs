import {nextPartId} from './workbench.mjs';
export const settingKeys=['model','reasoning','sandbox','approval','baseConfig','agentSettings'];
function scope(a,id){const role=id?a.roles.find(r=>r.id===id):null;if(id&&!role)throw Error('ロールが見つかりません');return {role,ids:role?role.partIds:a.commonPartIds};}
export function scopeSettings(a,id){
 const {role,ids}=scope(a,id),values={};
 if(role)for(const key of ['model','reasoning'])if(role[key])values[key]=role[key];
 for(const partId of ids){if(id&&a.commonPartIds.includes(partId))continue;const p=a.components.find(p=>p.id===partId);if(p?.type==='config')for(const [key,value]of Object.entries(p.data))if(value!=='')values[key]=key==='agentSettings'?{...values[key],...value}:value;}
 return values;
}
// Change only this scope; shared config references are detached before editing.
export function setScopeSetting(a,id,key,value){
 if(!settingKeys.includes(key)||(typeof value!=='string'&&!(value&&typeof value==='object'&&!Array.isArray(value))))throw Error('基本設定の項目が不正です');
 const {role,ids}=scope(a,id);
 if(role&&['model','reasoning'].includes(key))role[key]='';
 for(let i=0;i<ids.length;i++){
  const p=a.components.find(p=>p.id===ids[i]);if(p?.type!=='config'||!p.data[key])continue;
  // A duplicate common reference contributes no role-specific override.
  if(id&&a.commonPartIds.includes(p.id)){ids.splice(i--,1);continue;}
  const shared=(id!==''&&a.commonPartIds.includes(p.id))||a.roles.some(r=>r.id!==id&&r.partIds.includes(p.id));
  if(shared){const copy={...structuredClone(p),id:nextPartId(a.components,'config')};a.components.push(copy);ids[i]=copy.id;copy.data[key]='';}
  else p.data[key]='';
 }
 if(value){const last=a.components.find(p=>p.id===ids.at(-1));if(last?.type==='config'&&!a.roles.some(r=>r.id!==id&&r.partIds.includes(last.id))&&(id===''||!a.commonPartIds.includes(last.id))){last.data[key]=value;return;}const p={id:nextPartId(a.components,'config'),type:'config',name:(role?.name||'共通')+' の基本設定',data:{[key]:value}};a.components.push(p);ids.push(p.id);}
}
