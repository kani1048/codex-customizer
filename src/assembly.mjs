import {materialize,partTypes,selectedComponents} from './workbench.mjs';
import parseTOML from '@iarna/toml/parse-string.js';
import stringifyTOML from '@iarna/toml/stringify.js';
const TOML={parse:parseTOML,stringify:stringifyTOML};
import {defaultPolicy,validatePolicy} from 'exec-policy/src/policy.mjs';
export const defaults={version:2,name:'開発用 Codex',setId:'development',model:'',reasoning:'',sandbox:'workspace-write',approval:'on-request',instructions:'変更の目的を確認し、必要な範囲で実装と検証を行ってください。\nユーザーには日本語で簡潔に説明してください。',policyEnabled:true,policy:structuredClone(defaultPolicy),rules:[],hooks:[],baseConfig:'',instructionParts:[],skills:[],roles:[],activeRole:'',hookFiles:[],components:[],commonPartIds:[],workbenchVersion:0};
const json=x=>JSON.stringify(x,null,2)+'\n';
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
function text(v,label,max=12000){if(typeof v!=='string'||v.length>max)throw Error(label+'が不正です');return v;}
export function validate(a){
 if(object(a)&&a.version===1){
  if(Object.keys(a).some(k=>![...Object.keys(defaults),'environment'].includes(k)))throw Error('未知の構成項目があります');
  const {environment,...rest}=a;a={...rest,version:2,setId:environment};
 }
 if(!object(a)||a.version!==2)throw Error('構成ファイルの形式が不正です');
 if(Object.keys(a).some(k=>!Object.keys(defaults).includes(k)))throw Error('未知の構成項目があります');
 a={instructionParts:[],skills:[],roles:[],activeRole:'',hookFiles:[],components:[],commonPartIds:[],workbenchVersion:0,...a};
 validateWorkbench(a);
 validateComposition(a);
 text(a.name,'構成名',100);if(!a.name.trim())throw Error('構成名を入力してください');
 if(typeof a.setId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(a.setId))throw Error('セットIDには英数字・ピリオド・ハイフン・アンダースコアを指定してください');
 text(a.model,'モデル',100);if(/[\n\r]/.test(a.model))throw Error('モデル名は1行にしてください');
 if(!['','low','medium','high','xhigh'].includes(a.reasoning))throw Error('推論設定が不正です');
 if(!['read-only','workspace-write'].includes(a.sandbox))throw Error('サンドボックス設定が不正です');
 if(!['on-request','untrusted'].includes(a.approval))throw Error('承認設定が不正です');
 text(a.instructions,'指示',20000);text(a.baseConfig,'ベース設定',60000);TOML.parse(a.baseConfig);
 if(typeof a.policyEnabled!=='boolean')throw Error('ポリシー設定が不正です');validatePolicy(a.policy);
 if(!Array.isArray(a.rules)||a.rules.length>100)throw Error('ルールが多すぎます');
 for(const r of a.rules){if(!object(r)||!Array.isArray(r.pattern)||!r.pattern.length||r.pattern.length>20||r.pattern.some(x=>typeof x!=='string'||!x||x.length>500)||!['allow','prompt','forbidden'].includes(r.decision))throw Error('コマンドルールの形式が不正です');text(r.reason,'理由',500);}
 if(!Array.isArray(a.hooks)||a.hooks.length>30)throw Error('フックが多すぎます');
 for(const h of a.hooks){if(!object(h)||!['PreToolUse','PostToolUse','SessionStart','Stop'].includes(h.event)||typeof h.enabled!=='boolean')throw Error('フック設定が不正です');text(h.matcher,'マッチャー',200);try{new RegExp(h.matcher);}catch{throw Error('マッチャーが正規表現ではありません');}text(h.command,'フックコマンド',2000);if(!h.command.trim()||/[\r\n]/.test(h.command))throw Error('フックコマンドは空でない1行で指定してください');}
 return structuredClone(a);
}
export function compile(input,runtimeFiles={}){
 const source=validate(input),a=materialize(source),config=TOML.parse(a.baseConfig),warnings=[];
 // Combined limits and asset conflicts must also be checked across selected parts.
 validate({...a,components:[],commonPartIds:[],roles:a.roles.map(r=>({...r,partIds:[]}))});
 // Resolve the standard Codex home at execution time, independent of host or container.
 const root='${CODEX_HOME:-$HOME/.codex}';
 // Keep unknown imported settings while overriding only fields owned by this editor.
 for(const [k,v]of [['model',a.model],['model_reasoning_effort',a.reasoning]])if(v)config[k]=v;
 config.sandbox_mode=a.sandbox;config.approval_policy=a.approval;
 const files={};
 const role=a.roles.find(r=>r.id===a.activeRole);
 const parts=role?role.instructionIds.map(id=>a.instructionParts.find(p=>p.id===id)):[];
 const instructions=[a.instructions,...parts.map(p=>'## '+p.name+'\n\n'+p.content)].filter(s=>s.trim());
 if(instructions.length)files['AGENTS.md']=instructions.join('\n\n')+'\n';
 for(const skill of a.skills.filter(s=>s.common||role?.skillIds.includes(s.id)))for(const f of skill.files)files['skills/'+skill.id+'/'+f.path]=f.content;
 for(const f of a.hookFiles)files['hooks/custom/'+f.path]=f.content;
 if(role){if(role.model)config.model=role.model;if(role.reasoning)config.model_reasoning_effort=role.reasoning;}

 const subagents=selectedComponents(source).filter(p=>p.type==='subagent');
 if(subagents.length){
  if(config.agents!==undefined&&!object(config.agents))throw Error('ベースの agents はテーブルである必要があります');
  config.agents??={};
  if(config.agents.enabled===false)warnings.push('選択したサブエージェントを呼び出せるよう agents.enabled を true に変更します。');
  config.agents.enabled=true;
  const names=new Set();
  for(const part of subagents){
   const d=part.data;
   if(names.has(d.agentName)||Object.hasOwn(config.agents,d.agentName))throw Error('サブエージェントの呼び出し名が重複しています: '+d.agentName);
   names.add(d.agentName);
   const path='agents/'+d.agentName+'.toml';
   const definition={name:d.agentName,description:d.description,developer_instructions:d.instructions};
   if(d.model)definition.model=d.model;
   if(d.reasoning)definition.model_reasoning_effort=d.reasoning;
   files[path]=TOML.stringify(definition);
   config.agents[d.agentName]={description:d.description,config_file:path};
  }
  const guide='## 利用できるサブエージェント\n\n必要なときは用途に合う呼び出し名のサブエージェントへ作業を依頼してください。\n\n'+subagents.map(p=>'- `'+p.data.agentName+'`: '+p.data.description.replace(/\s+/g,' ').trim()).join('\n')+'\n';
  files['AGENTS.md']=(files['AGENTS.md']?files['AGENTS.md'].trimEnd()+'\n\n':'')+guide;
 }

 if(config.hooks&&!object(config.hooks))throw Error('ベースの hooks はテーブルである必要があります');
 function addHook(event,matcher,command){config.hooks??={};config.hooks[event]??=[];if(!Array.isArray(config.hooks[event]))throw Error('ベースの hooks.'+event+' が不正です');config.hooks[event].push({...(matcher?{matcher}:{}),hooks:[{type:'command',command,timeout:5}]});}
 if(a.policyEnabled){
  addHook('PreToolUse','^Bash$',`node "${root}/hooks/exec-policy/hook.mjs" "${root}/hooks/exec-policy/policy.json"`);
  files['hooks/exec-policy/policy.json']=json(a.policy);
  for(const f of ['hook.mjs','worker-node.mjs']){if(typeof runtimeFiles[f]!=='string')throw Error('フック実行ファイルが不足しています。ビルドをやり直してください');files['hooks/exec-policy/'+f]=runtimeFiles[f];}
  warnings.push('実行ポリシーは npm・make なども既定で拒否します。必要な部品を選んでください。');
 }
 for(const h of a.hooks)if(h.enabled)addHook(h.event,h.matcher,h.command);
 if(a.policyEnabled||a.hooks.some(h=>h.enabled)){config.features??={};if(!object(config.features))throw Error('ベースの features が不正です');if(config.features.hooks===false)warnings.push('取り込んだ hooks=false は、選択したフックを有効にするため true に変更されます。');config.features.hooks=true;warnings.push('フックの信頼レビューが別途必要です。フックコマンドは Codex を動かす環境で解決できるパスを指定してください。');}
 files['config.toml']=TOML.stringify(config);
 if(a.rules.length)files['rules/customizer.rules']=a.rules.map(r=>`prefix_rule(\n    pattern = ${JSON.stringify(r.pattern)},\n    decision = ${JSON.stringify(r.decision)},\n    justification = ${JSON.stringify(r.reason||'Customizer で設定')},\n)`).join('\n\n')+'\n';
 for(const r of a.rules)if(r.decision==='allow'&&['bash','sh','zsh','python','python3','node','env','npm','make'].includes(r.pattern[0]))warnings.push('広い許可を含みます: '+r.pattern.join(' ')+'。引数や呼び出すコードの安全性は保証しません。');
 if(a.baseConfig.trim())warnings.push('ベース設定の未知の項目は保持します。入力した秘密情報も出力に含まれるため、取り込むファイルの内容を確認してください。');
 warnings.push('既存の AGENTS.md・config.toml・rules/customizer.rules は、差分を確認してから反映してください。既存 hooks.json と他のルールも独立して読み込まれます。');
 const manifest={version:2,format:'codex-config-set',name:a.name,setId:a.setId,role:a.activeRole,target:{codexHome:'$CODEX_HOME (未設定時: ~/.codex)'},files:Object.keys(files),requirements:{...(a.policyEnabled?{node:'18+',hookShell:'POSIX'}:{})},warnings};
 return {files,manifest,warnings};
}

function validateComposition(a){
 const id=(v)=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v);
 const list=(v,label,max=100)=>{if(!Array.isArray(v)||v.length>max)throw Error(label+'の一覧が不正です');};
 const unique=(items,label)=>{list(items,label);const seen=new Set();for(const item of items){if(!object(item)||!id(item.id)||seen.has(item.id))throw Error(label+'のIDが不正または重複しています');seen.add(item.id);text(item.name,label+'名',100);}return seen;};
 const paths=(files,label)=>{list(files,label,300);const seen=new Set();for(const f of files){if(!object(f))throw Error(label+'が不正です');text(f.path,'ファイル名',240);if(!f.path||f.path.split('/').some(p=>!p||p==='.'||p==='..'||p==='__proto__'||!/^[-a-zA-Z0-9_.]+$/.test(p))||seen.has(f.path))throw Error(label+'の相対パスが不正または重複しています');if([...seen].some(p=>p.startsWith(f.path+'/')||f.path.startsWith(p+'/')))throw Error(label+'のファイルとディレクトリが衝突しています');seen.add(f.path);text(f.content,'ファイル内容',1000000);}return seen;};
 const partIds=unique(a.instructionParts,'指示パーツ');for(const p of a.instructionParts)text(p.content,'指示パーツ',20000);
 const skillIds=unique(a.skills,'スキル');for(const s of a.skills){if(typeof s.common!=='boolean')throw Error('共通スキルの指定が不正です');if(!paths(s.files,'スキルファイル').has('SKILL.md'))throw Error('スキルには SKILL.md が必要です');}
 const roleIds=unique(a.roles,'ロール');for(const r of a.roles){for(const [key,ids]of [['instructionIds',partIds],['skillIds',skillIds]]){list(r[key],key);if(new Set(r[key]).size!==r[key].length||r[key].some(v=>!ids.has(v)))throw Error('ロールの参照先が不正です: '+key);}text(r.model,'ロールのモデル',100);if(/[\r\n]/.test(r.model)||!['','low','medium','high','xhigh'].includes(r.reasoning))throw Error('ロールのモデル設定が不正です');}
 if(typeof a.activeRole!=='string'||(a.activeRole&&!roleIds.has(a.activeRole)))throw Error('出力ロールが存在しません');
 paths(a.hookFiles,'フックファイル');
 if(new TextEncoder().encode(JSON.stringify(a,null,2)+'\n').length>5000000)throw Error('構成全体は5MB以下にしてください');
}

function validateWorkbench(a){
 if(![0,1].includes(a.workbenchVersion))throw Error('作業台の形式が不正です');
 const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v);
 if(!Array.isArray(a.components)||a.components.length>300)throw Error('パーツの一覧が不正です');
 const ids=new Set();
 for(const p of a.components){
  if(!object(p)||!validId(p.id)||ids.has(p.id)||!Object.hasOwn(partTypes,p.type)||!object(p.data))throw Error('パーツのID・種類・内容が不正です');
  ids.add(p.id);text(p.name,'パーツ名',100);if(!p.name.trim())throw Error('パーツ名を入力してください');
  const d=p.data;
  const keys={config:['model','reasoning','sandbox','approval','baseConfig'],instruction:['content','heading'],skill:['files'],rule:['pattern','decision','reason'],hook:['event','matcher','command'],policy:['rules'],file:['path','content'],subagent:['agentName','description','instructions','model','reasoning']}[p.type];
  if(Object.keys(d).some(k=>!keys.includes(k)))throw Error('未知のパーツ設定があります');
  // Reuse the standard schema for each typed part, including unattached library parts.
  const sample={...structuredClone(defaults),policyEnabled:false};
  switch(p.type){
   case 'config':Object.assign(sample,Object.fromEntries(Object.entries(d).filter(([,v])=>v!=='')));break;
   case 'instruction':sample.instructions=d.content;if(d.heading!==undefined&&typeof d.heading!=='boolean')throw Error('指示の見出し設定が不正です');break;
   case 'subagent':
    if(typeof d.agentName!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(d.agentName)||['enabled','max_threads','max_depth','max_concurrent_threads_per_session','default_subagent_model','default_subagent_reasoning_effort','interrupt_message','constructor','prototype','__proto__'].includes(d.agentName))throw Error('サブエージェントの呼び出し名が不正または予約済みです');
    text(d.description,'サブエージェントの用途',2000);text(d.instructions,'サブエージェントの指示',20000);
    if(!d.description.trim()||!d.instructions.trim())throw Error('サブエージェントの用途と指示を入力してください');
    sample.model=d.model??'';sample.reasoning=d.reasoning??'';
    break;
   case 'skill':sample.skills=[{id:p.id,name:p.name,common:true,files:d.files}];break;
   case 'rule':sample.rules=[d];break;
   case 'hook':sample.hooks=[{...d,enabled:true}];break;
   case 'policy':sample.policy={...sample.policy,rules:{...sample.policy.rules,...d.rules}};if(!object(d.rules))throw Error('ポリシーパーツが不正です');break;
   case 'file':sample.hookFiles=[d];break;
  }
  validate(sample);
 }
 function refs(value){if(!Array.isArray(value)||value.length>300||new Set(value).size!==value.length||value.some(id=>!ids.has(id)))throw Error('組み立てたパーツの参照が不正です');}
 refs(a.commonPartIds);
 if(Array.isArray(a.roles))for(const role of a.roles){if(!object(role))throw Error('ロールが不正です');if(role.partIds!==undefined)refs(role.partIds);}
}
