export const partTypes = {
  config: {name:'基本設定', hint:'モデル・推論・実行環境'},
  instruction: {name:'指示', hint:'AGENTS.md に結合'},
  skill: {name:'スキル', hint:'SKILL.md と付属ファイル'},
  subagent: {name:'サブエージェント', hint:'複数ロールで共有する専門エージェント'},
  rule: {name:'コマンドルール', hint:'コマンドの判定'},
  hook: {name:'フック', hint:'イベントに処理を追加'},
  policy: {name:'実行ポリシー', hint:'追加のコマンド検査'},
  file: {name:'フックファイル', hint:'hooks/custom/ に同梱'},
};

export function nextPartId(parts, prefix='part') {
  let n=1;
  while(parts.some(p=>p.id===`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

export function selectedComponents(a) {
  const role=a.roles.find(r=>r.id===a.activeRole);
  return [...new Set([...a.commonPartIds,...(role?.partIds||[])])].map(id=>a.components.find(p=>p.id===id));
}

// Materialize the same ordered parts for both the Web UI and CLI exporter.
export function materialize(a) {
  const result=structuredClone(a);
  if(a.components.length){
    const role=result.roles.find(r=>r.id===result.activeRole);
    if(role){if(role.model)result.model=role.model;if(role.reasoning)result.reasoning=role.reasoning;role.model='';role.reasoning='';}
  }
  for(const part of selectedComponents(a)) {
    const d=part.data;
    switch(part.type) {
      case 'config':
        for(const [key,value] of Object.entries(d)) if(value!=='') result[key]=value;
        break;
      case 'instruction': result.instructions=[result.instructions,d.heading===false?d.content:`## ${part.name}\n\n${d.content}`].filter(s=>s.trim()).join('\n\n'); break;
      case 'skill': result.skills.push({id:part.id,name:part.name,common:true,files:structuredClone(d.files)}); break;
      case 'rule': result.rules.push(structuredClone(d)); break;
      case 'hook': result.hooks.push({...d,enabled:true}); break;
      case 'policy': result.policyEnabled=true;Object.assign(result.policy.rules,d.rules);break;
      case 'file': result.hookFiles.push(structuredClone(d)); break;
    }
  }
  return result;
}

export function placeComponent(a, scope, id, index) {
  const ids=scope===''?a.commonPartIds:a.roles.find(r=>r.id===scope)?.partIds;
  if(!ids||!a.components.some(p=>p.id===id)) throw Error('組み立て先またはパーツが見つかりません');
  if(!Number.isInteger(index)||index<0||index>ids.length) throw Error('挿入位置が不正です');
  const previous=ids.indexOf(id);
  if(previous>=0) ids.splice(previous,1);
  ids.splice(previous>=0&&previous<index?index-1:index,0,id);
}

export function removeComponent(a, scope, id) {
  const ids=scope===''?a.commonPartIds:a.roles.find(r=>r.id===scope)?.partIds;
  if(!ids) throw Error('組み立て先が見つかりません');
  const index=ids.indexOf(id);
  if(index>=0) ids.splice(index,1);
}

export function deleteComponent(a,id) {
  a.components=a.components.filter(p=>p.id!==id);
  a.commonPartIds=a.commonPartIds.filter(v=>v!==id);
  for(const role of a.roles) role.partIds=(role.partIds||[]).filter(v=>v!==id);
}

// Convert legacy fields to editable, reusable parts without changing the source.
export function toWorkbench(input) {
  const a=structuredClone(input);
  if(a.workbenchVersion===1)return a;
  a.workbenchVersion=1;
  a.components??=[];a.commonPartIds??=[];
  for(const role of a.roles) role.partIds??=[];
  function add(type,name,data,scope=null,preferredId=null) {
    const id=preferredId&&!a.components.some(p=>p.id===preferredId)?preferredId:nextPartId([...a.components,...a.skills],type);
    a.components.push({id,type,name,data});
    if(scope==='') a.commonPartIds.push(id);
    else if(scope) a.roles.find(r=>r.id===scope).partIds.push(id);
    return id;
  }
  if(a.model||a.reasoning||a.baseConfig||!a.components.length) add('config','共通の基本設定',{model:a.model,reasoning:a.reasoning,sandbox:a.sandbox,approval:a.approval,baseConfig:a.baseConfig},'');
  if(a.instructions.trim()) add('instruction','共通の指示',{content:a.instructions,heading:false},'');
  const instructionIds=new Map(a.instructionParts.map(p=>[p.id,add('instruction',p.name,{content:p.content})]));
  const skillIds=new Map(a.skills.map(s=>[s.id,add('skill',s.name,{files:s.files},s.common?'':null,s.id)]));
  for(const r of a.rules) add('rule',r.reason||r.pattern.join(' '),r,'');
  for(const h of a.hooks) {const {enabled,...data}=h;add('hook',h.event+' フック',data,enabled?'':null);}
  if(a.policyEnabled) add('policy','追加の実行ポリシー',{rules:a.policy.rules},'');
  for(const f of a.hookFiles) add('file',f.path,f,'');
  for(const r of a.roles) {
    r.partIds.push(...r.instructionIds.map(id=>instructionIds.get(id)),...r.skillIds.map(id=>skillIds.get(id)));
    if(r.model||r.reasoning) add('config',r.name+' のモデル',{model:r.model,reasoning:r.reasoning},r.id);
    r.instructionIds=[];r.skillIds=[];r.model='';r.reasoning='';
  }
  a.model='';a.reasoning='';a.baseConfig='';a.instructions='';a.instructionParts=[];a.skills=[];a.rules=[];a.hooks=[];a.hookFiles=[];a.policyEnabled=false;a.sandbox='workspace-write';a.approval='on-request';
  return a;
}

export function newComponent(a,type,policyRules={}) {
  const id=nextPartId(a.components,type);
  const data={
    config:{model:'',reasoning:'',sandbox:'workspace-write',approval:'on-request',baseConfig:''},
    instruction:{content:''},
    skill:{files:[{path:'SKILL.md',content:`---\nname: ${id}\ndescription: このスキルを使う場面を記述してください。\n---\n\n# 手順\n`}]},
    subagent:{agentName:nextPartId(a.components.filter(p=>p.type==='subagent').map(p=>({id:p.data.agentName})),'specialist'),description:'このサブエージェントへ依頼する作業を記述してください。',instructions:'担当する作業に集中し、結果と根拠を親エージェントへ報告してください。',model:'',reasoning:''},
    rule:{pattern:['git','push'],decision:'prompt',reason:'push 前に確認'},
    hook:{event:'Stop',matcher:'',command:'echo complete'},
    policy:{rules:structuredClone(policyRules)},
    file:{path:`${id}.mjs`,content:''},
  }[type];
  if(!data) throw Error('未知のパーツです');
  const part={id,type,name:'新しい'+partTypes[type].name,data};
  a.components.push(part);
  return part;
}

// Placement determines membership and order. Library drags reuse references;
// drags from an assembled stack move that assignment to its destination.
export function dropComponent(a, payload, target) {
  if(!payload||!target||!a.components.some(p=>p.id===payload.id))throw Error('パーツが見つかりません');
  const sourceIds=payload.source==='stack'?(payload.scope===''?a.commonPartIds:a.roles.find(r=>r.id===payload.scope)?.partIds):null;
  if(payload.source==='stack'&&(!sourceIds||!sourceIds.includes(payload.id)))throw Error('移動元のパーツが見つかりません');
  if(!['stack','library'].includes(payload.source))throw Error('移動元が不正です');
  if(target.zone==='library'){
    if(!Number.isInteger(target.index)||target.index<0||target.index>a.components.length)throw Error('挿入位置が不正です');
    const previous=a.components.findIndex(p=>p.id===payload.id),[part]=a.components.splice(previous,1);
    a.components.splice(previous<target.index?target.index-1:target.index,0,part);
    if(sourceIds)removeComponent(a,payload.scope,payload.id);
  }else if(target.zone==='stack'){
    if(!payload.source||typeof target.scope!=='string')throw Error('組み立て先が不正です');
    placeComponent(a,target.scope,payload.id,target.index);
    if(sourceIds&&payload.scope!==target.scope)removeComponent(a,payload.scope,payload.id);
  }else throw Error('配置先が不正です');
}

export function affectedScopes(a,id) {
  const common=a.commonPartIds.includes(id);
  return {common,roles:a.roles.filter(r=>common||r.partIds?.includes(id)).map(r=>({
    id:r.id,name:r.name,source:common?(r.partIds?.includes(id)?'both':'common'):'direct',
  }))};
}
