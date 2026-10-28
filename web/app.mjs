import {reasoningLevels,approvalCategories,reducibleFeatures} from '../src/capabilities.mjs';
import {scopeSettings,setScopeSetting} from '../src/settings.mjs';
import parseTOML from '@iarna/toml/parse-string.js';
import {componentSections,sectionForType,sectionParts,sectionDropIndex,sectionMoveIndex} from '../src/sections.mjs';
import {zipSync,strToU8} from 'fflate';
import {defaults,validate,compile} from '../src/assembly.mjs';
import {initialParts,initializeParts} from '../src/catalog.mjs';
import {partTypes,nextPartId,selectedComponents,materialize,dropComponent,affectedScopes,deleteComponent,toWorkbench,newComponent} from '../src/workbench.mjs';
import {rules as policyRules} from 'exec-policy/src/policy.mjs';

const $=id=>document.getElementById(id);
const clone=x=>structuredClone(x);
let state=toWorkbench(defaults),runtime={},output=null,filter='',search='';
const sectionOpen=new Map(componentSections.map(s=>[s.id,['config','instructions'].includes(s.id)]));
let editorParsers=[];
let dragPayload=null,pointerDrag=null,draft=null,editingId=null,worker,timer,lastState=null,selectedCard=null;

try{const raw=localStorage.getItem('codex-customizer.v2')||localStorage.getItem('codex-customizer.v1');if(raw){const saved=JSON.parse(raw);state=toWorkbench(validate(saved));if(saved.approval==='untrusted'||saved.components?.some(p=>p.type==='config'&&p.data?.approval==='untrusted'))notice('旧承認方針 untrusted を on-request に移行しました。');}}catch{notice('保存した構成を読み込めないため、初期構成を表示します。');}

state=initializeParts(state);

function el(tag,text,cls){const e=document.createElement(tag);if(text!==undefined&&text!==null)e.textContent=text;if(cls)e.className=cls;return e;}
function button(text,action,cls){const b=el('button',text,cls);b.type='button';b.onclick=action;return b;}
function notice(message){$('status').textContent=message;}
function announce(message){$('builder-status').replaceChildren(el('span',message));if(lastState)$('builder-status').append(button('元に戻す',undo,'undo-button'));}
function selectedIds(a=state){return a.activeRole?a.roles.find(r=>r.id===a.activeRole).partIds:a.commonPartIds;}
function scopeName(){return state.roles.find(r=>r.id===state.activeRole)?.name||'全ロール共通';}
function transaction(change,message){
 try{const candidate=clone(state);change(candidate);const checked=validate(candidate);compile(checked,runtime);lastState=clone(state);state=checked;render();announce(message);return true;}
 catch(error){announce(error.message);return false;}
}
function undo(){if(!lastState)return;const previous=lastState;lastState=null;state=previous;render();announce('ひとつ前の組み立てに戻しました。');}
function page(name){for(const p of document.querySelectorAll('[data-panel]'))p.hidden=p.dataset.panel!==name;for(const b of document.querySelectorAll('[data-page]'))b.classList.toggle('selected',b.dataset.page===name);updateOutput();}
for(const b of document.querySelectorAll('[data-page]'))b.onclick=()=>page(b.dataset.page);
$('review').onclick=$('overview-review').onclick=()=>page('output');
function syncMeta(){state.name=$('name').value;state.setId=$('setId').value;updateOutput();}
$('name').oninput=syncMeta;$('setId').oninput=syncMeta;

function summary(p){
 const d=p.data;
 switch(p.type){
  case 'config':return [d.model||'モデルは引き継ぐ',d.reasoning,d.sandbox,d.approval,d.baseConfig?'ベース設定あり':''].filter(Boolean).join(' · ');
  case 'instruction':return d.content.slice(0,100)||'指示の内容を編集';
  case 'mcp':return d.serverName+' · '+(d.transport==='http'?d.url:d.command+' '+(d.args||[]).join(' '))+(d.enabled===false?' · 無効':'');
  case 'subagent':return d.agentName+' · '+d.description+' · スキル '+(d.skillIds?.length||0)+'件';
  case 'skill':return d.files.length+' ファイル · '+d.files.map(f=>f.path).slice(0,2).join(', ');
  case 'rule':return d.pattern.join(' ')+' → '+d.decision;
  case 'hook':return d.event+' · '+d.command;
  case 'policy':return Object.values(d.rules).filter(Boolean).length+' 項目の追加検査';
  case 'file':return 'hooks/custom/'+d.path;
 }
}
function copyExample(a,id){const source=initialParts.find(p=>p.id===id);if(!source)throw Error('パーツの例が見つかりません');const existing=a.components.find(p=>p.type===source.type&&JSON.stringify(p.data)===JSON.stringify(source.data));if(existing)return existing.id;const part={...clone(source),id:nextPartId(a.components,source.type)};a.components.push(part);return part.id;}
function commitPlacement(payload,target){
 if(!payload||!target)return;
 if(payload.draftSkill){if(!draft||draft.type!=='subagent'||!['draft-skills','draft-library'].includes(target.zone))return;const ids=draft.data.skillIds??=[];const old=ids.indexOf(payload.id);if(old>=0)ids.splice(old,1);if(target.zone==='draft-skills')ids.splice(old>=0&&old<target.index?target.index-1:target.index,0,payload.id);renderSkillAssignment($('subagent-skills'));return;}
 const type=state.components.find(p=>p.id===payload.id)?.type;
 if(target.section&&sectionForType(type)?.id!==target.section){announce('このパーツは「'+(sectionForType(type)?.name||'対応するセクション')+'」へ配置してください。');return;}
 transaction(a=>{
  dropComponent(a,payload,target);
  if(target.zone==='stack')a.activeRole=target.scope;
 },target.zone==='library'?'ライブラリへ戻しました。ほかの組み込み先はそのままです。':'置いた場所と順序に合わせて、組み立てを更新しました。');
}
function makeCard(part,{assembled=false,index=0}={}){
 const card=el('article',null,assembled?'assembled-part':'part-tile');card.dataset.partId=part.id;card.dataset.type=part.type;
 card.tabIndex=0;card.setAttribute('aria-label',part.name+' · '+partTypes[part.type].name);card.setAttribute('aria-describedby','card-help');
 const payload={id:part.id,source:assembled?'stack':'library',...(assembled?{scope:state.activeRole}:{})};
 if(assembled)card.dataset.partIndex=index;
 else card.dataset.libraryIndex=state.components.findIndex(p=>p.id===part.id);
 const top=el('div',null,'card-heading');top.append(el('span',partTypes[part.type].name,'part-tag'));
 if(assembled)top.append(el('span',String(index+1).padStart(2,'0'),'part-number'));
 const inherited=state.activeRole&&selectedComponents({...state,activeRole:''}).some(p=>p.id===part.id),included=selectedIds().includes(part.id),automatic=part.type==='skill'&&!included&&selectedComponents(state).some(p=>p.id===part.id);
 if(!assembled)top.append(el('span',inherited?'共通から継承':included?'配置済み':automatic?'担当から追加':'未配置','placement-state'));
 card.append(top,el('strong',part.name,'part-name'),el('p',summary(part),'part-summary'));
 card.onclick=()=>{selectedCard=part.id;for(const e of document.querySelectorAll('[data-part-id]'))e.classList.toggle('card-selected',e.dataset.partId===part.id);};
 card.ondblclick=e=>{e.preventDefault();openEditor(part.id);};
 card.onkeydown=e=>{
  if(e.key==='Enter'){e.preventDefault();openEditor(part.id);}
  else if(assembled&&e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const target=sectionMoveIndex(state,state.activeRole,part.id,e.key==='ArrowUp'?-1:1);if(target!==null)commitPlacement(payload,{zone:'stack',scope:state.activeRole,index:target});}
  else if(assembled&&e.key==='Delete'){e.preventDefault();commitPlacement(payload,{zone:'library',index:state.components.length});}
  else if(!assembled&&e.key===' '){e.preventDefault();commitPlacement(payload,{zone:'stack',scope:state.activeRole,index:sectionDropIndex(state,state.activeRole,sectionForType(part.type).id)});}
 };
 if(selectedCard===part.id)card.classList.add('card-selected');
 makeDraggable(card,payload);return card;
}
function revealSection(id){
 filter='';renderSections();const details=document.getElementById('section-'+id);if(details){sectionOpen.set(id,true);details.open=true;details.scrollIntoView({block:'start',behavior:'smooth'});}
}
const approvalLabels={sandbox_approval:'サンドボックスの権限拡大',rules:'コマンドルールの確認',mcp_elicitations:'MCPからの入力要求',request_permissions:'追加権限の要求',skill_approval:'スキルスクリプトの確認'};
function formatSetting(value){return value&&typeof value==='object'?'詳細な承認条件':value;}
function renderAgentSettings(host){
 const details=el('details',null,'agent-settings');details.append(el('summary','サブエージェント全体の設定'));
 details.append(el('p',state.activeRole?'このロールの設定です。空欄は共通・ベース設定を継承します。':'すべてのロールで使う設定です。空欄はベース設定・Codexの既定値を使います。','small'));
 const values=clone(scopeSettings(state,state.activeRole).agentSettings||{}),grid=el('div',null,'basic-settings-grid');
 for(const [key,label,options]of [['enabled','サブエージェントを有効化',['','true','false']],['max_concurrent_threads_per_session','同時稼働数（親を除く）',null],['default_subagent_model','子の既定モデル ID',null],['default_subagent_reasoning_effort','子の既定の推論',['',...reasoningLevels]],['interrupt_message','中断通知を文脈に記録',['','true','false']]]){
  grid.append(field(label,values[key]===undefined?'':String(values[key]),v=>{if(v===''){delete values[key];return;}values[key]=['enabled','interrupt_message'].includes(key)?v==='true':key==='max_concurrent_threads_per_session'?Number(v):v;},{options}));
 }
 details.append(grid,button('全体設定を保存',()=>transaction(a=>setScopeSetting(a,a.activeRole,'agentSettings',values),'サブエージェント全体設定を更新しました。')));host.append(details);
}
function renderAgentCapabilities(host,d){
 host.append(field('回答の詳しさ',d.verbosity||'',v=>d.verbosity=v,{options:['','low','medium','high']}),field('推論の要約',d.reasoningSummary||'',v=>d.reasoningSummary=v,{options:['','auto','concise','detailed','none']}));
 const box=el('div',null,'agent-capabilities');box.append(el('h3','この担当で無効にする機能'));
 const labels={shell_tool:'シェル',apps:'Apps',plugins:'プラグイン',memories:'メモリ',request_permissions_tool:'追加権限の要求ツール'};
 for(const key of reducibleFeatures){const l=el('label',null,'toggle'),c=el('input');c.type='checkbox';c.checked=d.disabledFeatures?.includes(key)||false;c.onchange=()=>{d.disabledFeatures=(d.disabledFeatures||[]).filter(k=>k!==key);if(c.checked)d.disabledFeatures.push(key);};l.append(c,el('span',labels[key]));box.append(l);}
 box.append(field('スキル一覧の指示を含める',d.includeSkillInstructions===undefined?'':String(d.includeSkillInstructions),v=>{if(v==='')delete d.includeSkillInstructions;else d.includeSkillInstructions=v==='true';},{options:['','true','false']}));host.append(box);
}
function renderMcpEditor(host,d){
 host.append(field('サーバー名',d.serverName,v=>d.serverName=v),field('接続方式',d.transport,v=>{try{for(const parse of editorParsers)parse();d.transport=v;paintEditor();}catch(error){$('editor-error').textContent=error.message;}},{options:['stdio','http']}));
 const list=(key,label)=>host.append(field(label,(d[key]||[]).join('\n'),v=>d[key]=v.split('\n').map(s=>s.trim()).filter(Boolean),{multiline:true}));
 const map=(key,label)=>{let raw=JSON.stringify(d[key]||{},null,2);host.append(field(label,raw,v=>raw=v,{multiline:true}));editorParsers.push(()=>{try{d[key]=JSON.parse(raw);}catch{throw Error(label+'をJSONオブジェクトで入力してください');}});};
 if(d.transport==='stdio'){host.append(field('起動コマンド',d.command||'',v=>d.command=v));list('args','引数（1行に1つ）');host.append(field('作業ディレクトリ',d.cwd||'',v=>d.cwd=v));map('env','環境変数（JSON）');list('envVars','引き継ぐ環境変数名（1行に1つ）');}
 else{host.append(field('接続 URL',d.url||'',v=>d.url=v),field('Bearerトークンを読む環境変数名',d.bearerTokenEnvVar||'',v=>d.bearerTokenEnvVar=v));map('envHttpHeaders','HTTPヘッダーと環境変数名（JSON）');}
 list('enabledTools','公開するツール（空欄は全て・1行に1つ）');list('disabledTools','除外するツール（1行に1つ）');
 for(const [key,label]of [['startupTimeoutSec','起動タイムアウト（秒）'],['toolTimeoutSec','ツール実行タイムアウト（秒）']])host.append(field(label,d[key]===undefined?'':String(d[key]),v=>{if(v==='')delete d[key];else d[key]=Number(v);}));
 for(const [key,label]of [['enabled','接続を有効化'],['required','接続失敗時に起動を止める']])host.append(field(label,String(d[key]??(key==='enabled')),v=>d[key]=v==='true',{options:['true','false']}));
 host.append(el('p','共通・複数のロールに同じMCPパーツを配置して共有できます。接続と認証は生成先のCodexが行います。','small'));
}
function renderBasicSettings(body){
 const current=scopeSettings(state,state.activeRole),common=scopeSettings(state,'');
 let inheritedConfig={};try{inheritedConfig=parseTOML(compile({...state,activeRole:''},runtime).files['config.toml']);}catch{}
 body.append(el('p',state.activeRole?'空欄の項目は共通設定を引き継ぎます。このロールだけを上書きできます。':'すべてのロールで使う基本設定です。','small'));
 const grid=el('div',null,'basic-settings-grid');
 const models=[...new Set([state.model,...state.roles.map(r=>r.model),...state.components.filter(p=>p.type==='config').map(p=>p.data.model)].filter(Boolean))];
 for(const [key,label,options]of [['model','モデル',models],['reasoning','推論の深さ',reasoningLevels],['sandbox','サンドボックス',['workspace-write','read-only','danger-full-access']],['approval','承認方針',['on-request','never','granular']]]){
  const wrap=el('div'),labelEl=el('label',label),select=el('select');select.id='basic-'+key;select.setAttribute('aria-label',label);
  const chosen=key==='approval'&&typeof current[key]==='object'?'granular':current[key]||'';
  for(const value of [...new Set(['',...options,...(chosen?[chosen]:[]),...(key==='model'?['__custom__']:[])])]){const o=el('option',value==='__custom__'?'モデル ID を追加…':value==='granular'?'詳細な承認条件':value||(state.activeRole?'共通設定を引き継ぐ':'既定・ベース設定を使う'));o.value=value;select.append(o);}select.value=chosen;
  select.onchange=()=>{if(select.value==='__custom__'){custom.hidden=false;custom.querySelector('input').focus();return;}if(!transaction(a=>setScopeSetting(a,a.activeRole,key,key==='approval'&&select.value==='granular'?{granular:Object.fromEntries(approvalCategories.map(k=>[k,true]))}:select.value),'基本設定を更新しました。'))select.value=chosen;};
  labelEl.append(select);wrap.append(labelEl);
  const configKey={model:'model',reasoning:'model_reasoning_effort',sandbox:'sandbox_mode',approval:'approval_policy'}[key];
  const inherited=state.activeRole?(inheritedConfig[configKey]??common[key]??state[key]):'既定・ベース設定';wrap.append(el('p','引き継ぎ元: '+(formatSetting(inherited)||'既定・ベース設定'),'setting-source'));
  const custom=el('div',null,'custom-model');custom.hidden=true;
  if(key==='model'){const input=el('input');input.setAttribute('aria-label','追加するモデル ID');custom.append(input,button('設定する',()=>{const value=input.value.trim();if(value)transaction(a=>setScopeSetting(a,a.activeRole,'model',value),'モデルを更新しました。');}));wrap.append(custom);}
  grid.append(wrap);
 }
 body.append(grid);
 if(current.approval?.granular){const box=el('div',null,'granular-settings');box.append(el('h4','表示する承認確認'));for(const key of approvalCategories){box.append(field(approvalLabels[key],current.approval.granular[key]?'true':'false',v=>transaction(a=>{const approval=clone(current.approval);approval.granular[key]=v==='true';setScopeSetting(a,a.activeRole,'approval',approval);},'承認条件を更新しました。'),{options:['true','false']}));}box.append(el('p','true: 確認を表示する / false: その確認が必要な操作を自動拒否する','small'));body.append(box);}
 const advanced=el('details',null,'basic-advanced');advanced.append(el('summary','詳細設定 · ベース config.toml'));
 const base=el('textarea');base.value=current.baseConfig||'';base.setAttribute('aria-label','ベース config.toml');advanced.append(base,button('ベース設定を保存',()=>transaction(a=>setScopeSetting(a,a.activeRole,'baseConfig',base.value),'ベース設定を更新しました。')));body.append(advanced);
}
function renderSections(){
 for(const b of $('type-filters').children)b.setAttribute('aria-pressed',b.dataset.type===filter);
 const host=$('component-sections');host.replaceChildren();
 const available=state.components;
 for(const [order,section]of componentSections.entries()){
  if(filter&&section.id!==filter)continue;
  const assigned=sectionParts(state,state.activeRole,section.id);
  const inherited=state.activeRole?sectionParts(state,'',section.id).filter(row=>!selectedIds().includes(row.part.id)):[];
  const candidates=available.filter(p=>section.types.includes(p.type)&&(!search||(p.name+' '+partTypes[p.type].name+' '+summary(p)).toLowerCase().includes(search)));
  const details=el('details',null,'component-section');details.id='section-'+section.id;details.dataset.section=section.id;details.open=sectionOpen.get(section.id)||false;
  details.ontoggle=()=>sectionOpen.set(section.id,details.open);
  const heading=el('summary',null,'section-heading'),title=el('div',null,'section-heading-title');
  title.append(el('span',String(order+1).padStart(2,'0'),'section-number'),el('strong',section.name));
  const counts=el('span',section.id==='config'?(state.activeRole?'ロールごとに上書き':'全ロール共通'):`${assigned.length} 配置 / ${inherited.length} 共通`,'section-count');
  const names=el('p',null,'section-names');
  const autoSkills=section.id==='skills'?selectedComponents(state).filter(p=>p.type==='skill'&&!selectedIds().includes(p.id)&&!inherited.some(r=>r.part.id===p.id)):[];
  const labels=[...inherited.map(r=>'共通: '+r.part.name),...assigned.map(r=>r.part.name),...autoSkills.map(p=>'担当から追加: '+p.name)];
  if(autoSkills.length)counts.textContent+=' / '+autoSkills.length+' 担当から追加';
  names.textContent=labels.length?labels.join(' / '):'まだ配置されていません';
  if(section.id==='config'){const v=scopeSettings(state,state.activeRole);names.textContent=[v.model,v.reasoning,v.sandbox,formatSetting(v.approval)].filter(Boolean).join(' / ')||'既定・共通設定を引き継ぐ';}
  heading.append(title,counts,names);details.append(heading);
  if(section.id==='config'){const body=el('div',null,'section-body');renderBasicSettings(body);details.append(body);host.append(details);continue;}
  const body=el('div',null,'section-body'),intro=el('div',null,'section-intro');intro.append(el('p',section.caption,'small'));
  if(section.id==='subagents')renderAgentSettings(body);
  const add=button('＋ パーツを作る',()=>chooseNewPart(section.types));intro.append(add);
  if(section.id==='skills')intro.append(button('フォルダーを取り込む ↑',()=>$('skill-folder').click()));body.append(intro);
  if(section.id==='skills'){const automatic=selectedComponents(state).filter(p=>p.type==='skill'&&!selectedIds().includes(p.id)&&!state.commonPartIds.includes(p.id));if(automatic.length){const shared=el('div',null,'inherited-parts');shared.append(el('span','サブエージェントから追加','inherited-label'));for(const part of automatic){const chip=button(part.name+'（'+selectedComponents(state).filter(p=>p.type==='subagent'&&p.data.skillIds?.includes(part.id)).map(p=>p.name).join('・')+'）',()=>openEditor(part.id),'inherited-chip');shared.append(chip);}body.append(shared);}}
  if(inherited.length){const shared=el('div',null,'inherited-parts');shared.append(el('span','全ロール共通から継承','inherited-label'));for(const row of inherited){const chip=el('span',row.part.name,'inherited-chip');chip.tabIndex=0;chip.title='ダブルクリックで共通パーツを編集';chip.ondblclick=()=>openEditor(row.part.id);chip.onkeydown=e=>{if(e.key==='Enter')openEditor(row.part.id);};shared.append(chip);}body.append(shared);}
  const columns=el('div',null,'section-columns');
  const library=el('div',null,'section-library');library.dataset.dropZone='library';library.dataset.section=section.id;library.setAttribute('aria-label',section.name+'のライブラリ');
  library.append(el('h4','使えるパーツ'));
  if(!candidates.length)library.append(el('p',search?'条件に合うパーツがありません。':'「＋ パーツを作る」で追加できます。','empty-hint'));
  for(const part of candidates)library.append(makeCard(part));
  library.append(el('p','↩ ここへ戻して、この配置を外す','section-return'));
  const stack=el('div',null,'section-stack');stack.append(el('h4',state.activeRole?'このロールに配置':'共通に配置'));
  const zone=el('div',null,'drop-zone');zone.dataset.dropZone='stack';zone.dataset.section=section.id;zone.dataset.scope=state.activeRole;zone.setAttribute('aria-label',section.name+'の組み立て先');
  if(!assigned.length)zone.append(el('div','＋ '+section.name+'のパーツをここへ','drop-placeholder'));
  for(const row of assigned)zone.append(makeCard(row.part,{assembled:true,index:row.index}));stack.append(zone);columns.append(library,stack);body.append(columns);details.append(body);host.append(details);
 }
}
function renderOverview(){
 const parts=selectedComponents(state).filter(p=>p.type!=='config'),shared=new Set(selectedComponents({...state,activeRole:''}).map(p=>p.id));
 const commonCount=selectedComponents({...state,activeRole:''}).filter(p=>p.type!=='config').length;
 $('overview-name').textContent=state.name||'名前未設定';$('overview-scope').textContent='出力対象: '+scopeName();
 const counts=$('overview-counts');counts.replaceChildren();for(const [value,title]of [[parts.length,'部品'],[commonCount,'共通'],[state.activeRole?parts.filter(p=>!shared.has(p.id)).length:0,'ロール固有']]){const box=el('div');box.append(el('strong',String(value)),el('span',title));counts.append(box);}
 const effective=materialize(state),compiled=output?parseTOML(output.files['config.toml']):null,settings=$('overview-settings');settings.replaceChildren();
 for(const [label,value]of [['モデル',compiled?.model||effective.model||'既定・ベース設定'],['推論の深さ',compiled?.model_reasoning_effort||effective.reasoning||'既定・ベース設定'],['実行環境',compiled?.sandbox_mode||effective.sandbox],['承認',compiled?.approval_policy||effective.approval]]){const row=el('p');row.append(el('span',label),el('strong',formatSetting(value)));settings.append(row);}
 const groups=$('overview-sections');groups.replaceChildren();
 for(const section of componentSections){const included=parts.filter(p=>section.types.includes(p.type));const b=button(section.name+(section.id==='config'?'　項目を選択':'　'+included.length),()=>revealSection(section.id),'overview-section-link');b.setAttribute('aria-label',section.name+'のセクションへ');groups.append(b);}
 const list=$('overview-parts');list.replaceChildren();
 for(const part of parts){const row=el('li');row.append(el('span',part.name),el('small',part.type==='skill'&&!selectedIds().includes(part.id)&&!shared.has(part.id)?parts.filter(p=>p.type==='subagent'&&p.data.skillIds?.includes(part.id)).map(p=>p.name+' から追加').join(' / '):shared.has(part.id)?'共通':scopeName()));row.title=partTypes[part.type].name;row.ondblclick=()=>part.type==='config'?revealSection('config'):openEditor(part.id);list.append(row);}
 const files=$('overview-files');files.replaceChildren();
 if(output)for(const name of Object.keys(output.files))files.append(button(name,()=>{page('output');$('file-select').value=name;$('file-preview').textContent=output?.files[name]||'';},'overview-file'));
 $('overview-error').textContent=output?'':$('warnings').textContent;
 $('overview-review').disabled=!output;
}
function renderScope(){
 const choice=$('active-scope');choice.replaceChildren();for(const r of [{id:'',name:'全ロール共通'},...state.roles]){const o=el('option',r.name);o.value=r.id;choice.append(o);}choice.value=state.activeRole;
 const targets=$('scope-targets');targets.replaceChildren();
 for(const scope of [{id:'',name:'全ロール共通'},...state.roles]){
  const chip=button(scope.name,()=>{state.activeRole=scope.id;render();},'scope-target');
  chip.dataset.dropZone='stack';chip.dataset.scope=scope.id;chip.dataset.append='true';
  chip.setAttribute('aria-pressed',state.activeRole===scope.id);chip.setAttribute('aria-label',scope.name+'の配置先');targets.append(chip);
 }
 const info=$('scope-info');info.replaceChildren();
 if(state.activeRole){
  const box=el('div',null,'scope-note');box.append(el('strong','共通の基本設定・パーツ ＋ このロールの上書き・パーツ'));
  box.append(el('p','共通パーツを先に組み込み、その後にこのロールのパーツを重ねます。同じパーツは一度だけ出力します。'));
  const links=el('div',null,'tile-actions');links.append(button('共通を組み立てる',()=>{state.activeRole='';render();}),button('ロールを編集',openRoleEditor));box.append(links);info.append(box);
 }else info.append(el('p','ここに組み込んだパーツはすべてのロールへ引き継がれます。','scope-note'));

}
function render(){
 $('name').value=state.name;$('setId').value=state.setId;renderScope();renderSections();updateOutput();
}
function updateOutput(){
 try{
  output=compile(state,runtime);const before=$('file-select').value;$('file-select').replaceChildren();
  for(const name of Object.keys(output.files)){const o=el('option',name);o.value=name;$('file-select').append(o);}if(Object.hasOwn(output.files,before))$('file-select').value=before;
  $('warnings').replaceChildren(...output.warnings.map(w=>el('p',w,'warning')));$('download-zip').disabled=false;
  $('output-summary').textContent=scopeName()+' · '+selectedComponents(state).length+' パーツ → '+Object.keys(output.files).length+' ファイル。runtime はこの CODEX_HOME を参照します。';
 }catch(error){output=null;$('download-zip').disabled=true;$('warnings').replaceChildren(el('p',error.message,'warning'));$('output-summary').textContent='パーツの入力内容を修正してください。';}
 $('file-preview').textContent=output?.files[$('file-select').value]||'有効な構成を組み立てると、出力を表示します。';renderOverview();
}
$('active-scope').onchange=()=>{state.activeRole=$('active-scope').value;render();announce('組み立て先を切り替えました。CODEX_HOME の出力対象も切り替わります。');};
$('part-search').oninput=()=>{search=$('part-search').value.toLowerCase();renderSections();};
for(const [type,meta]of [['',{name:'すべて'}],...componentSections.map(s=>[s.id,{name:s.name}])]){const b=button(meta.name,()=>{filter=type;if(type)sectionOpen.set(type,true);for(const btn of $('type-filters').children)btn.setAttribute('aria-pressed',btn===b);renderSections();});b.dataset.type=type;b.setAttribute('aria-pressed',type==='');$('type-filters').append(b);}
$('add-role').onclick=()=>transaction(a=>{const id=nextPartId(a.roles,'role');a.roles.push({id,name:'新しいロール',model:'',reasoning:'',instructionIds:[],skillIds:[],partIds:[]});a.activeRole=id;},'ロールを追加しました。すべての種類のパーツを組み込めます。');
$('example-role').onclick=()=>transaction(a=>{const id=nextPartId(a.roles,'role'),partIds=['config-development','instruction-plan','instruction-verify','skill-review'].map(id=>copyExample(a,id));a.roles.push({id,name:'開発',model:'',reasoning:'',instructionIds:[],skillIds:[],partIds});a.activeRole=id;},'設定・指示・スキルからなる開発ロールの例を追加しました。');

// A single editor shell for every kind of part. Changes are committed together.
function field(title,value,change,{multiline=false,options=null,aria=title}={}){
 const l=el('label',title);let control;
 if(options){control=el('select');for(const value of options){const option=el('option',value||'引き継ぐ');option.value=value;control.append(option);}}
 else control=el(multiline?'textarea':'input');
 control.value=value??'';control.setAttribute('aria-label',aria);
 control[multiline||!options?'oninput':'onchange']=()=>change(control.value);l.append(control);return l;
}
function fileFields(host,files){
 const list=el('div');
 function paint(){list.replaceChildren();files.forEach((file,index)=>{const box=el('div',null,'file-fields');box.append(field('相対パス',file.path,v=>file.path=v),field('ファイル内容',file.content,v=>file.content=v,{multiline:true}),button('このファイルを外す',()=>{files.splice(index,1);paint();}));list.append(box);});}
 paint();host.append(list,button('＋ 付属ファイル',()=>{let n=1;while(files.some(f=>f.path===`references/file-${n}.md`))n++;files.push({path:`references/file-${n}.md`,content:''});paint();}));
}
function resetEditor(title,kind){$('editor-title').textContent=title;$('editor-kind').textContent=kind;$('editor-content').replaceChildren();$('editor-impact').replaceChildren();$('editor-error').textContent='';$('delete-part').hidden=false;$('save-part').textContent='保存する';$('part-editor').showModal();}
function openEditor(id){editingId=id;draft=clone(state.components.find(p=>p.id===id));paintEditor();}
function renderSkillAssignment(host){
 host.replaceChildren(el('h3','この担当が使うスキル'),el('p','ドラッグして組み込み・並び替え。担当を親ロールへ配置すると、必要なスキルも親に追加されます。','small'));
 const columns=el('div',null,'section-columns');
 for(const assigned of [false,true]){
  const zone=el('div',null,assigned?'drop-zone':'section-library');zone.dataset.dropZone=assigned?'draft-skills':'draft-library';zone.setAttribute('aria-label',assigned?'担当に組み込むスキル':'使えるスキル');zone.append(el('h4',assigned?'この担当に組み込み':'使えるスキル'));
  const ids=draft.data.skillIds||[],parts=assigned?ids.map(id=>state.components.find(p=>p.id===id)):state.components.filter(p=>p.type==='skill');
  if(!parts.length)zone.append(el('p',assigned?'スキルをここへドラッグ':'先にスキルのパーツを追加してください。','empty-hint'));
  for(const [index,part]of parts.entries()){
   const card=el('article',null,assigned?'assembled-part':'part-tile');card.dataset.partId=part.id;if(assigned)card.dataset.partIndex=index;card.tabIndex=0;card.setAttribute('aria-label',part.name+' · スキル');card.append(el('strong',part.name),el('p',assigned?'Deleteで外す':ids.includes(part.id)?'組み込み済み':'Spaceで組み込む','small'));
   card.onkeydown=e=>{if(!assigned&&e.key===' '){e.preventDefault();commitPlacement({id:part.id,draftSkill:true},{zone:'draft-skills',index:ids.length});}else if(assigned&&e.key==='Delete'){e.preventDefault();commitPlacement({id:part.id,draftSkill:true},{zone:'draft-library'});}else if(assigned&&e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const next=index+(e.key==='ArrowUp'?-1:1);if(next>=0&&next<ids.length)commitPlacement({id:part.id,draftSkill:true},{zone:'draft-skills',index:next+(next>index?1:0)});}};
   makeDraggable(card,{id:part.id,draftSkill:true,source:assigned?'stack':'library'});zone.append(card);
  }columns.append(zone);
 }host.append(columns);
}
function paintEditor(){
 editorParsers=[];
 resetEditor('パーツを編集',partTypes[draft.type].name);$('delete-part').hidden=!editingId;
 const host=$('editor-content'),d=draft.data;renderImpact(editingId);
 host.append(field('パーツ名',draft.name,v=>draft.name=v));
 switch(draft.type){
  case 'config':host.append(field('モデル ID',d.model,v=>d.model=v),field('推論の深さ',d.reasoning,v=>d.reasoning=v,{options:['',...reasoningLevels]}),field('サンドボックス',d.sandbox,v=>d.sandbox=v,{options:['','workspace-write','read-only']}),field('承認方針',d.approval,v=>d.approval=v,{options:['','on-request','never']}),field('ベース config.toml',d.baseConfig,v=>d.baseConfig=v,{multiline:true}),el('p','同じ設定項目を持つパーツを重ねると、後の空でない値が優先されます。ベース config.toml も、最後に指定した内容を使用します。','small'));break;
  case 'mcp':renderMcpEditor(host,d);break;
  case 'subagent':host.append(field('呼び出し名',d.agentName,v=>d.agentName=v),field('用途・呼び出す場面',d.description,v=>d.description=v,{multiline:true}),field('サブエージェントへの指示',d.instructions,v=>d.instructions=v,{multiline:true}),field('モデル ID（空欄は親から継承）',d.model,v=>d.model=v),field('推論の深さ（空欄は親から継承）',d.reasoning,v=>d.reasoning=v,{options:['',...reasoningLevels]}),el('p','複数のロールへ同じパーツを配置して共有できます。出力は agents/<呼び出し名>.toml。権限・プロバイダー・MCP は親から継承します。','small'));{renderAgentCapabilities(host,d);const skills=el('section',null,'subagent-skills');skills.id='subagent-skills';host.append(skills);renderSkillAssignment(skills);}break;
  case 'instruction':host.append(field('指示の内容',d.content,v=>d.content=v,{multiline:true}));break;
  case 'skill':host.append(el('p','SKILL.md と UTF-8 の付属ファイルをまとめて出力します。','small'));fileFields(host,d.files);break;
  case 'rule':host.append(field('コマンドの先頭（JSON 配列）',JSON.stringify(d.pattern),v=>{try{d.pattern=JSON.parse(v);}catch{d.pattern=null;}}),field('判定',d.decision,v=>d.decision=v,{options:['allow','prompt','forbidden']}),field('理由',d.reason,v=>d.reason=v));break;
  case 'hook':host.append(field('イベント',d.event,v=>d.event=v,{options:['PreToolUse','PostToolUse','SessionStart','Stop']}),field('マッチャー',d.matcher,v=>d.matcher=v),field('コマンド',d.command,v=>d.command=v),el('p','フックファイルを組み込み、node "${CODEX_HOME:-$HOME/.codex}/hooks/custom/complete.mjs" のように参照できます。スクリプトはインタープリター経由で起動してください。','small'));break;
  case 'policy':for(const rule of policyRules){const l=el('label',null,'toggle'),c=el('input');c.type='checkbox';c.checked=d.rules[rule.id]??defaults.policy.rules[rule.id];c.onchange=()=>d.rules[rule.id]=c.checked;l.append(c,el('span',rule.title));host.append(l,el('p',rule.hint,'small'));}break;
  case 'file':host.append(field('hooks/custom/ 以下の相対パス',d.path,v=>d.path=v),field('ファイル内容',d.content,v=>d.content=v,{multiline:true}));break;
 }
 $('save-part').onclick=()=>{
  try{for(const parse of editorParsers)parse();const candidate=clone(state);if(editingId)candidate.components[candidate.components.findIndex(p=>p.id===editingId)]=clone(draft);else candidate.components.push(clone(draft));const checked=validate(candidate);compile(checked,runtime);lastState=clone(state);state=checked;$('part-editor').close();filter='';search='';$('part-search').value='';sectionOpen.set(sectionForType(draft.type).id,true);render();announce('パーツを保存しました。ドラッグして配置できます。');}
  catch(error){$('editor-error').textContent=error.message;}
 };
 $('delete-part').onclick=()=>{if(transaction(a=>deleteComponent(a,editingId),'パーツと組み込み先の参照を削除しました。'))$('part-editor').close();};
}
function renderImpact(id){
 const host=$('editor-impact');host.replaceChildren();
 host.setAttribute('aria-label',draft?.type==='skill'?'使用しているロール・サブエージェント':'影響するロール');
 host.append(el('h3',draft?.type==='skill'?'使用しているロール・サブエージェント':'影響するロール'));
 if(!id){host.append(el('p','新しいパーツです。保存して配置すると、その組み込み先に反映されます。'));return;}
 const impact=affectedScopes(state,id);
 if(impact.common)host.append(el('p','全ロール共通に配置されています。共通の出力と、現在・今後のすべてのロールに反映されます。'));
 if(!impact.common&&!impact.roles.length&&!impact.subagents?.length){host.append(el('p','現在このパーツを使っているロールはありません。'));return;}
 const list=el('ul');
 for(const agent of impact.subagents||[]){const row=el('li');row.append(el('strong','サブエージェント: '+agent.name),el('code',agent.id),el('span','直接組み込み','impact-source'));list.append(row);}
 if(impact.common){const row=el('li');row.append(el('strong','全ロール共通'),el('span',impact.viaCommon?.length?impact.viaCommon.map(p=>p.name+' を通じて追加').join(' / '):'共通の出力','impact-source'));list.append(row);}
 for(const role of impact.roles){const row=el('li');row.append(el('strong',role.name),el('code',role.id),el('span',role.via?[...(role.inherited?['共通から継承']:[]),...(role.direct?['直接組み込み']:[]),...role.via.map(p=>p.name+' を通じて追加')].join(' / '):role.source==='common'?'共通から継承':role.source==='both'?'共通から継承・直接配置':'直接配置','impact-source'));list.append(row);}
 host.append(list,el('p','保存すると、一覧の組み込み先で同じパーツの内容が更新されます。'));
}
function openRoleEditor(){
 const role=clone(state.roles.find(r=>r.id===state.activeRole));resetEditor('ロールを編集','ASSEMBLY');$('editor-content').append(field('ロール名',role.name,v=>role.name=v));$('delete-part').textContent='このロールを削除';
 $('save-part').onclick=()=>{if(!role.name.trim()){$('editor-error').textContent='ロール名を入力してください';return;}if(transaction(a=>a.roles.find(r=>r.id===role.id).name=role.name,'ロール名を変更しました。'))$('part-editor').close();};
 $('delete-part').onclick=()=>{if(transaction(a=>{a.roles=a.roles.filter(r=>r.id!==role.id);a.activeRole='';},'ロールを削除しました。ライブラリのパーツは残っています。'))$('part-editor').close();};
}
$('part-editor').addEventListener('close',()=>{$('delete-part').textContent='ライブラリから削除';});
$('close-editor').onclick=$('cancel-editor').onclick=()=>$('part-editor').close();
function chooseNewPart(types=null){for(const b of $('new-part-types').children)b.hidden=b.dataset.type==='config'||(!!types&&!types.includes(b.dataset.type));$('new-part-dialog').showModal();}
$('new-part').onclick=()=>chooseNewPart();$('close-new').onclick=()=>$('new-part-dialog').close();
for(const [type,meta]of Object.entries(partTypes)){const b=button(meta.name+'\n'+meta.hint,()=>{const candidate=clone(state);draft=newComponent(candidate,type,defaults.policy.rules);editingId=null;$('new-part-dialog').close();paintEditor();},'new-type');b.dataset.type=type;$('new-part-types').append(b);}

// One placement gesture: the destination controls membership, and the gap controls order.
function clearDrop(){for(const e of document.querySelectorAll('.drop-active,.drop-before,.drop-after'))e.classList.remove('drop-active','drop-before','drop-after');}
function dropAt(x,y){
 const zone=document.elementFromPoint(x,y)?.closest('[data-drop-zone]');if(!zone)return null;
 if(zone.dataset.dropZone.startsWith('draft-')){const rows=[...zone.querySelectorAll('[data-part-index]')],before=rows.find(e=>y<e.getBoundingClientRect().top+e.getBoundingClientRect().height/2);return {zone,row:before,target:{zone:zone.dataset.dropZone,index:before?Number(before.dataset.partIndex):rows.length}};}
 if(zone.dataset.dropZone==='library'){
  const rows=[...zone.querySelectorAll('[data-library-index]')],before=rows.find(e=>y<e.getBoundingClientRect().top+e.getBoundingClientRect().height/2);
  const index=before?Number(before.dataset.libraryIndex):rows.length?Number(rows.at(-1).dataset.libraryIndex)+1:state.components.length;
  return {zone,row:before||rows.at(-1),after:!before,target:{zone:'library',index,section:zone.dataset.section}};
 }
 const scope=zone.dataset.scope;
 if(zone.dataset.append){const ids=scope===''?state.commonPartIds:state.roles.find(r=>r.id===scope)?.partIds;if(!ids)return null;return {zone,target:{zone:'stack',scope,index:ids.length}};}
 const rows=[...zone.querySelectorAll('[data-part-index]')],before=rows.find(e=>y<e.getBoundingClientRect().top+e.getBoundingClientRect().height/2);
 const index=zone.dataset.section?sectionDropIndex(state,scope,zone.dataset.section,before?.dataset.partId||null):before?Number(before.dataset.partIndex):rows.length;
 return {zone,row:before||rows.at(-1),after:!before,target:{zone:'stack',scope,index,section:zone.dataset.section}};
}
function markDrop(hit){clearDrop();if(!hit)return;hit.zone.classList.add('drop-active');hit.row?.classList.add(hit.after?'drop-after':'drop-before');}
function makeDraggable(card,payload){
 card.draggable=true;
 card.ondragstart=e=>{dragPayload=payload;e.dataTransfer.effectAllowed='copyMove';e.dataTransfer.setData('application/x-codex-part',payload.id);card.classList.add('dragging');};
 card.ondragend=()=>{dragPayload=null;card.classList.remove('dragging');clearDrop();};
 const handle=el('span','⠿','drag-handle');handle.setAttribute('aria-hidden','true');handle.title='ドラッグして配置・並び替え';
 handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();handle.setPointerCapture(e.pointerId);pointerDrag={payload,x:e.clientX,y:e.clientY,started:false};};
 handle.onpointermove=e=>{if(!pointerDrag)return;const d=pointerDrag;if(!d.started&&Math.hypot(e.clientX-d.x,e.clientY-d.y)>6){d.started=true;card.classList.add('dragging');document.body.classList.add('is-dragging');}if(!d.started)return;markDrop(dropAt(e.clientX,e.clientY));if(e.clientY<60)window.scrollBy(0,-15);else if(e.clientY>window.innerHeight-60)window.scrollBy(0,15);};
 function finish(e,cancel=false){const d=pointerDrag;pointerDrag=null;card.classList.remove('dragging');document.body.classList.remove('is-dragging');const hit=cancel?null:dropAt(e.clientX,e.clientY);clearDrop();if(d?.started&&hit)commitPlacement(d.payload,hit.target);}
 handle.onpointerup=e=>finish(e);handle.onpointercancel=e=>finish(e,true);card.prepend(handle);
}
for(const container of [$('component-sections'),$('scope-targets'),$('editor-content')]){
 container.ondragover=e=>{if(!dragPayload)return;const hit=dropAt(e.clientX,e.clientY);if(!hit)return;e.preventDefault();e.dataTransfer.dropEffect=dragPayload.source==='library'?'copy':'move';markDrop(hit);};
 container.ondragleave=e=>{if(!container.contains(e.relatedTarget))clearDrop();};
 container.ondrop=e=>{e.preventDefault();const hit=dropAt(e.clientX,e.clientY),payload=dragPayload;dragPayload=null;clearDrop();if(hit&&payload)commitPlacement(payload,hit.target);};
}

$('save').onclick=()=>{try{const checked=validate(state);localStorage.setItem('codex-customizer.v2',JSON.stringify(checked));notice('パーツとロールをブラウザーに保存しました。');}catch(error){notice(error.message);}};
function download(name,bytes,type){const u=URL.createObjectURL(new Blob([bytes],{type})),a=el('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
$('download-config').onclick=()=>{try{validate(state);download('customizer.json',JSON.stringify(state,null,2),'application/json');}catch(error){notice(error.message);}};
$('download-zip').onclick=()=>{updateOutput();if(!output)return;const files=Object.fromEntries(Object.entries(output.files).map(([p,s])=>[p,strToU8(s)]));files['APPLY.txt']=strToU8('CODEX_HOME generated by Codex Customizer\nZIPの内容を新しいCODEX_HOMEへ展開し、runtimeの参照先として配置・マウントしてください。既存環境への統合は差分を確認してください。フックの信頼レビューと、追加ポリシーにはNode.js 18+ / POSIX shellが必要です。\n');download('codex-'+state.setId+'.zip',zipSync(files),'application/zip');};
$('file-select').onchange=()=>{$('file-preview').textContent=output?.files[$('file-select').value]||'';};
$('load-config').onclick=()=>$('config-file').click();$('config-file').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>5000000)throw Error('5MB以下の構成JSONを選んでください');const candidate=validate(initializeParts(toWorkbench(validate(JSON.parse(await f.text())))));lastState=clone(state);state=candidate;render();notice('構成を読み込みました。以前の設定もパーツとして扱えます。');}catch(error){notice(error.message);}finally{e.target.value='';}};
$('skill-folder').onchange=async e=>{try{const entries=[...e.target.files];if(!entries.length)return;if(entries.reduce((n,f)=>n+f.size,0)>4000000)throw Error('取り込みは4MB以下にしてください');const folder=entries[0].webkitRelativePath.split('/')[0],files=[];for(const f of entries){const bytes=new Uint8Array(await f.arrayBuffer());if(bytes.includes(0))throw Error('UTF-8テキストのみ取り込めます: '+f.name);files.push({path:f.webkitRelativePath.slice(folder.length+1),content:new TextDecoder('utf-8',{fatal:true}).decode(bytes)});}const candidate=clone(state);const part={id:nextPartId(candidate.components,'skill'),name:folder,type:'skill',data:{files}};candidate.components.push(part);state=validate(candidate);render();announce('スキルをパーツとして取り込みました。ドラッグして組み込めます。');}catch(error){notice(error.message);}finally{e.target.value='';}};
$('simulate').onclick=()=>{
 clearTimeout(timer);worker?.terminate();const effective=materialize(state);if(!effective.policyEnabled){$('verdict').textContent='実行ポリシーパーツは組み込まれていません。';return;}
 try{validate(state);}catch(error){$('verdict').textContent=error.message;return;}
 worker=new Worker('worker.js',{type:'module'});$('verdict').textContent='解析中…';worker.onmessage=e=>{clearTimeout(timer);worker.terminate();const r=e.data;$('verdict').replaceChildren(el('strong',r.decision==='deny'?'追加ポリシーが拒否':'追加ポリシーの拒否条件に該当なし'),...r.findings.map(f=>el('p',f.message)),el('p','Codex の標準判定・承認・サンドボックスは別途適用されます。'));};worker.onerror=()=>{clearTimeout(timer);worker.terminate();$('verdict').textContent='解析に失敗したため拒否';};timer=setTimeout(()=>{worker.terminate();$('verdict').textContent='解析が3秒を超えたため拒否';},3000);worker.postMessage({command:$('command').value,policy:effective.policy});
};
const cardHelp=el('p','ダブルクリックまたはEnterで編集。Spaceで配置、Alt＋上下キーで移動、Deleteでライブラリへ戻します。','sr-only');cardHelp.id='card-help';document.body.append(cardHelp);
$('name').value=state.name;$('setId').value=state.setId;renderScope();renderSections();renderOverview();
for(const f of ['hook.mjs','worker-node.mjs']){try{const response=await fetch('runtime/'+f);if(!response.ok)throw Error('フック実行ファイルを読み込めませんでした');runtime[f]=await response.text();}catch(error){notice(error.message);}}
render();
