import {zipSync,strToU8} from 'fflate';
import {defaults,validate,compile} from '../src/assembly.mjs';
import {instructionPresets} from '../src/composition.mjs';
import {partTypes,nextPartId,selectedComponents,materialize,dropComponent,affectedScopes,deleteComponent,toWorkbench,newComponent} from '../src/workbench.mjs';
import {rules as policyRules} from 'exec-policy/src/policy.mjs';

const $=id=>document.getElementById(id);
const clone=x=>structuredClone(x);
let state=toWorkbench(defaults),runtime={},output=null,filter='',search='',catalog='library';
let dragPayload=null,pointerDrag=null,draft=null,editingId=null,worker,timer,lastState=null,selectedCard=null;
const examples=[
 {id:'subagent-reviewer',type:'subagent',name:'レビュー担当',data:{agentName:'reviewer',description:'実装後のコードレビューを担当し、不具合・回帰・検証不足を確認する。',instructions:'差分と関連実装を確認してください。コードは変更せず、不具合・回帰・不足するテストを優先し、根拠と該当箇所を親エージェントへ報告してください。',model:'',reasoning:''}},
 {id:'subagent-researcher',type:'subagent',name:'調査担当',data:{agentName:'researcher',description:'実装前のコード調査、依存関係や動作の確認を担当する。',instructions:'関連するコードと資料を読み、依頼された問いに集中して調査してください。ファイルは変更せず、確認できた事実と未確認の点を区別して親エージェントへ報告してください。',model:'',reasoning:''}},
 ...instructionPresets.map(p=>({id:'instruction-'+p.id,type:'instruction',name:p.name,data:{content:p.content}})),
 {id:'config-readonly',type:'config',name:'読み取り中心の作業',data:{sandbox:'read-only',approval:'on-request',model:'',reasoning:'',baseConfig:''}},
 {id:'config-development',type:'config',name:'開発用の実行設定',data:{sandbox:'workspace-write',approval:'on-request',model:'',reasoning:'',baseConfig:''}},
 {id:'rule-push',type:'rule',name:'push の前に確認',data:{pattern:['git','push'],decision:'prompt',reason:'push 前に確認'}},
 {id:'hook-stop',type:'hook',name:'完了時のフック',data:{event:'Stop',matcher:'',command:'echo complete'}},
 {id:'policy-default',type:'policy',name:'追加の実行ポリシー',data:{rules:clone(defaults.policy.rules)}},
 {id:'skill-review',type:'skill',name:'レビューの手順',data:{files:[{path:'SKILL.md',content:'---\nname: review-guide\ndescription: コードレビュー時に確認する項目と報告の手順。\n---\n\n# レビュー\n\n1. 差分と関連実装を確認する。\n2. 不具合・回帰・不足する検証を調べる。\n3. 根拠と該当箇所を添えて報告する。\n'}]}},
 {id:'file-hook',type:'file',name:'フックのスクリプト',data:{path:'complete.mjs',content:'// フックのコマンドで node "${CODEX_HOME:-$HOME/.codex}/hooks/custom/complete.mjs" を指定します。\nconsole.log("complete");\n'}},
];
try{const raw=localStorage.getItem('codex-customizer.v2')||localStorage.getItem('codex-customizer.v1');if(raw)state=toWorkbench(validate(JSON.parse(raw)));}catch{notice('保存した構成を読み込めないため、初期構成を表示します。');}

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
$('review').onclick=()=>page('output');
function syncMeta(){state.name=$('name').value;state.setId=$('setId').value;updateOutput();}
$('name').oninput=syncMeta;$('setId').oninput=syncMeta;

function summary(p){
 const d=p.data;
 switch(p.type){
  case 'config':return [d.model||'モデルは引き継ぐ',d.reasoning,d.sandbox,d.approval,d.baseConfig?'ベース設定あり':''].filter(Boolean).join(' · ');
  case 'instruction':return d.content.slice(0,100)||'指示の内容を編集';
  case 'subagent':return d.agentName+' · '+d.description;
  case 'skill':return d.files.length+' ファイル · '+d.files.map(f=>f.path).slice(0,2).join(', ');
  case 'rule':return d.pattern.join(' ')+' → '+d.decision;
  case 'hook':return d.event+' · '+d.command;
  case 'policy':return Object.values(d.rules).filter(Boolean).length+' 項目の追加検査';
  case 'file':return 'hooks/custom/'+d.path;
 }
}
function copyExample(a,id){const source=examples.find(p=>p.id===id);if(!source)throw Error('パーツの例が見つかりません');const part={...clone(source),id:nextPartId(a.components,source.type)};a.components.push(part);return part.id;}
function commitPlacement(payload,target){
 if(!payload||!target)return;
 if(payload.example&&target.zone==='library'){announce('例のパーツは組み立て先へドラッグして使えます。');return;}
 transaction(a=>{
  let next=payload;
  if(payload.example)next={id:copyExample(a,payload.id),source:'library'};
  dropComponent(a,next,target);
  if(target.zone==='stack')a.activeRole=target.scope;
  else catalog='library';
 },target.zone==='library'?'ライブラリへ戻しました。ほかの組み込み先はそのままです。':'置いた場所と順序に合わせて、組み立てを更新しました。');
}
function makeCard(part,{assembled=false,example=false,index=0}={}){
 const card=el('article',null,assembled?'assembled-part':'part-tile');card.dataset.partId=part.id;card.dataset.type=part.type;
 card.tabIndex=0;card.setAttribute('aria-label',part.name+' · '+partTypes[part.type].name);card.setAttribute('aria-describedby','card-help');
 const payload={id:part.id,example,source:assembled?'stack':'library',...(assembled?{scope:state.activeRole}:{})};
 if(assembled)card.dataset.partIndex=index;
 else if(!example)card.dataset.libraryIndex=state.components.findIndex(p=>p.id===part.id);
 const top=el('div',null,'card-heading');top.append(el('span',partTypes[part.type].name,'part-tag'));
 if(assembled)top.append(el('span',String(index+1).padStart(2,'0'),'part-number'));
 const inherited=!example&&state.activeRole&&state.commonPartIds.includes(part.id),included=!example&&selectedIds().includes(part.id);
 if(!assembled)top.append(el('span',example?'コピーして使用':inherited?'共通から継承':included?'配置済み':'未配置','placement-state'));
 card.append(top,el('strong',part.name,'part-name'),el('p',summary(part),'part-summary'));
 card.onclick=()=>{selectedCard=part.id;for(const e of document.querySelectorAll('[data-part-id]'))e.classList.toggle('card-selected',e.dataset.partId===part.id);};
 card.ondblclick=e=>{e.preventDefault();example?openExample(part):openEditor(part.id);};
 card.onkeydown=e=>{
  if(e.key==='Enter'){e.preventDefault();example?openExample(part):openEditor(part.id);}
  else if(assembled&&e.altKey&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const target=index+(e.key==='ArrowUp'?-1:2);if(target>=0&&target<=selectedIds().length)commitPlacement(payload,{zone:'stack',scope:state.activeRole,index:target});}
  else if(assembled&&e.key==='Delete'){e.preventDefault();commitPlacement(payload,{zone:'library',index:state.components.length});}
  else if(!assembled&&e.key===' '){e.preventDefault();commitPlacement(payload,{zone:'stack',scope:state.activeRole,index:selectedIds().length});}
 };
 if(selectedCard===part.id)card.classList.add('card-selected');
 makeDraggable(card,payload);return card;
}
function renderPalette(){
 for(const b of $('type-filters').children)b.setAttribute('aria-pressed',b.dataset.type===filter);
 const host=$('palette-items'),scroll=host.scrollTop;host.replaceChildren();
 const parts=catalog==='examples'?examples:state.components;
 const visible=parts.filter(p=>(!filter||p.type===filter)&&(!search||(p.name+' '+partTypes[p.type].name+' '+summary(p)).toLowerCase().includes(search)));
 if(!visible.length)host.append(el('p',catalog==='library'?'パーツを追加するか、「すぐ使える例」から選んで始められます。':'該当するパーツの例がありません。','empty-hint'));
 for(const part of visible)host.append(makeCard(part,{example:catalog==='examples'}));
 host.scrollTop=scroll;
 $('tab-library').setAttribute('aria-pressed',catalog==='library');$('tab-examples').setAttribute('aria-pressed',catalog==='examples');
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
  const box=el('div',null,'scope-note');box.append(el('strong','共通の '+state.commonPartIds.length+' パーツ ＋ このロールのパーツ'));
  box.append(el('p','共通パーツを先に組み込み、その後にこのロールのパーツを重ねます。同じパーツは一度だけ出力します。'));
  const links=el('div',null,'tile-actions');links.append(button('共通を組み立てる',()=>{state.activeRole='';render();}),button('ロールを編集',openRoleEditor));box.append(links);info.append(box);
 }else info.append(el('p','ここに組み込んだパーツはすべてのロールへ引き継がれます。','scope-note'));
 $('stack-title').textContent=scopeName();$('stack-count').textContent=selectedIds().length+' パーツ';
 const stack=$('assembly-stack');stack.replaceChildren();stack.dataset.dropCount=selectedIds().length;stack.dataset.scope=state.activeRole;
 if(!selectedIds().length)stack.append(el('div','＋ どの種類のパーツも、ここへドロップ','drop-placeholder'));
 selectedIds().forEach((id,index)=>stack.append(makeCard(state.components.find(p=>p.id===id),{assembled:true,index})));
 $('assembly-summary').textContent='出力対象: '+scopeName()+' · 合計 '+selectedComponents(state).length+' パーツ';
}
function render(){
 $('name').value=state.name;$('setId').value=state.setId;renderPalette();renderScope();updateOutput();
}
function updateOutput(){
 try{
  output=compile(state,runtime);const before=$('file-select').value;$('file-select').replaceChildren();
  for(const name of Object.keys(output.files)){const o=el('option',name);o.value=name;$('file-select').append(o);}if(Object.hasOwn(output.files,before))$('file-select').value=before;
  $('warnings').replaceChildren(...output.warnings.map(w=>el('p',w,'warning')));$('download-zip').disabled=false;
  $('output-summary').textContent=scopeName()+' · '+selectedComponents(state).length+' パーツ → '+Object.keys(output.files).length+' ファイル。runtime はこの CODEX_HOME を参照します。';
 }catch(error){output=null;$('download-zip').disabled=true;$('warnings').replaceChildren(el('p',error.message,'warning'));$('output-summary').textContent='パーツの入力内容を修正してください。';}
 $('file-preview').textContent=output?.files[$('file-select').value]||'有効な構成を組み立てると、出力を表示します。';
}
$('active-scope').onchange=()=>{state.activeRole=$('active-scope').value;render();announce('組み立て先を切り替えました。CODEX_HOME の出力対象も切り替わります。');};
$('part-search').oninput=()=>{search=$('part-search').value.toLowerCase();renderPalette();};
for(const [type,meta]of [['',{name:'すべて'}],...Object.entries(partTypes)]){const b=button(meta.name,()=>{filter=type;for(const btn of $('type-filters').children)btn.setAttribute('aria-pressed',btn===b);renderPalette();});b.dataset.type=type;b.setAttribute('aria-pressed',type==='');$('type-filters').append(b);}
$('tab-library').onclick=()=>{catalog='library';renderPalette();};$('tab-examples').onclick=()=>{catalog='examples';renderPalette();};
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
function openExample(part){editingId=null;draft={...clone(part),id:nextPartId(state.components,part.type)};paintEditor();}
function paintEditor(){
 resetEditor('パーツを編集',partTypes[draft.type].name);$('delete-part').hidden=!editingId;
 const host=$('editor-content'),d=draft.data;renderImpact(editingId);
 host.append(field('パーツ名',draft.name,v=>draft.name=v));
 switch(draft.type){
  case 'config':host.append(field('モデル ID',d.model,v=>d.model=v),field('推論の深さ',d.reasoning,v=>d.reasoning=v,{options:['','low','medium','high','xhigh']}),field('サンドボックス',d.sandbox,v=>d.sandbox=v,{options:['','workspace-write','read-only']}),field('承認方針',d.approval,v=>d.approval=v,{options:['','on-request','untrusted']}),field('ベース config.toml',d.baseConfig,v=>d.baseConfig=v,{multiline:true}),el('p','同じ設定項目を持つパーツを重ねると、後の空でない値が優先されます。ベース config.toml も、最後に指定した内容を使用します。','small'));break;
  case 'subagent':host.append(field('呼び出し名',d.agentName,v=>d.agentName=v),field('用途・呼び出す場面',d.description,v=>d.description=v,{multiline:true}),field('サブエージェントへの指示',d.instructions,v=>d.instructions=v,{multiline:true}),field('モデル ID（空欄は親から継承）',d.model,v=>d.model=v),field('推論の深さ（空欄は親から継承）',d.reasoning,v=>d.reasoning=v,{options:['','low','medium','high','xhigh']}),el('p','複数のロールへ同じパーツを配置して共有できます。出力は agents/<呼び出し名>.toml。権限・プロバイダー・MCP は親から継承します。','small'));break;
  case 'instruction':host.append(field('指示の内容',d.content,v=>d.content=v,{multiline:true}));break;
  case 'skill':host.append(el('p','SKILL.md と UTF-8 の付属ファイルをまとめて出力します。','small'));fileFields(host,d.files);break;
  case 'rule':host.append(field('コマンドの先頭（JSON 配列）',JSON.stringify(d.pattern),v=>{try{d.pattern=JSON.parse(v);}catch{d.pattern=null;}}),field('判定',d.decision,v=>d.decision=v,{options:['allow','prompt','forbidden']}),field('理由',d.reason,v=>d.reason=v));break;
  case 'hook':host.append(field('イベント',d.event,v=>d.event=v,{options:['PreToolUse','PostToolUse','SessionStart','Stop']}),field('マッチャー',d.matcher,v=>d.matcher=v),field('コマンド',d.command,v=>d.command=v),el('p','フックファイルを組み込み、node "${CODEX_HOME:-$HOME/.codex}/hooks/custom/complete.mjs" のように参照できます。スクリプトはインタープリター経由で起動してください。','small'));break;
  case 'policy':for(const rule of policyRules){const l=el('label',null,'toggle'),c=el('input');c.type='checkbox';c.checked=d.rules[rule.id]??defaults.policy.rules[rule.id];c.onchange=()=>d.rules[rule.id]=c.checked;l.append(c,el('span',rule.title));host.append(l,el('p',rule.hint,'small'));}break;
  case 'file':host.append(field('hooks/custom/ 以下の相対パス',d.path,v=>d.path=v),field('ファイル内容',d.content,v=>d.content=v,{multiline:true}));break;
 }
 $('save-part').onclick=()=>{
  try{const candidate=clone(state);if(editingId)candidate.components[candidate.components.findIndex(p=>p.id===editingId)]=clone(draft);else candidate.components.push(clone(draft));const checked=validate(candidate);compile(checked,runtime);lastState=clone(state);state=checked;$('part-editor').close();catalog='library';filter='';search='';$('part-search').value='';render();announce('パーツを保存しました。ドラッグして配置できます。');}
  catch(error){$('editor-error').textContent=error.message;}
 };
 $('delete-part').onclick=()=>{if(transaction(a=>deleteComponent(a,editingId),'パーツと組み込み先の参照を削除しました。'))$('part-editor').close();};
}
function renderImpact(id){
 const host=$('editor-impact');host.replaceChildren();
 host.append(el('h3','影響するロール'));
 if(!id){host.append(el('p','新しいパーツです。保存して配置すると、その組み込み先に反映されます。'));return;}
 const impact=affectedScopes(state,id);
 if(impact.common)host.append(el('p','全ロール共通に配置されています。共通の出力と、現在・今後のすべてのロールに反映されます。'));
 if(!impact.common&&!impact.roles.length){host.append(el('p','現在このパーツを使っているロールはありません。'));return;}
 const list=el('ul');
 if(impact.common){const row=el('li');row.append(el('strong','全ロール共通'),el('span','共通の出力','impact-source'));list.append(row);}
 for(const role of impact.roles){const row=el('li');row.append(el('strong',role.name),el('code',role.id),el('span',role.source==='common'?'共通から継承':role.source==='both'?'共通から継承・直接配置':'直接配置','impact-source'));list.append(row);}
 host.append(list,el('p','保存すると、一覧の組み込み先で同じパーツの内容が更新されます。'));
}
function openRoleEditor(){
 const role=clone(state.roles.find(r=>r.id===state.activeRole));resetEditor('ロールを編集','ASSEMBLY');$('editor-content').append(field('ロール名',role.name,v=>role.name=v));$('delete-part').textContent='このロールを削除';
 $('save-part').onclick=()=>{if(!role.name.trim()){$('editor-error').textContent='ロール名を入力してください';return;}if(transaction(a=>a.roles.find(r=>r.id===role.id).name=role.name,'ロール名を変更しました。'))$('part-editor').close();};
 $('delete-part').onclick=()=>{if(transaction(a=>{a.roles=a.roles.filter(r=>r.id!==role.id);a.activeRole='';},'ロールを削除しました。ライブラリのパーツは残っています。'))$('part-editor').close();};
}
$('part-editor').addEventListener('close',()=>{$('delete-part').textContent='ライブラリから削除';});
$('close-editor').onclick=$('cancel-editor').onclick=()=>$('part-editor').close();
$('new-part').onclick=()=>$('new-part-dialog').showModal();$('close-new').onclick=()=>$('new-part-dialog').close();
for(const [type,meta]of Object.entries(partTypes))$('new-part-types').append(button(meta.name+'\n'+meta.hint,()=>{const candidate=clone(state);draft=newComponent(candidate,type,defaults.policy.rules);editingId=null;$('new-part-dialog').close();paintEditor();},'new-type'));

// One placement gesture: the destination controls membership, and the gap controls order.
function clearDrop(){for(const e of document.querySelectorAll('.drop-active,.drop-before,.drop-after'))e.classList.remove('drop-active','drop-before','drop-after');}
function dropAt(x,y){
 const zone=document.elementFromPoint(x,y)?.closest('[data-drop-zone]');if(!zone)return null;
 if(zone.dataset.dropZone==='library'){
  const rows=[...$('palette-items').querySelectorAll('[data-library-index]')],before=rows.find(e=>y<e.getBoundingClientRect().top+e.getBoundingClientRect().height/2);
  const index=before?Number(before.dataset.libraryIndex):rows.length?Number(rows.at(-1).dataset.libraryIndex)+1:state.components.length;
  return {zone,row:before||rows.at(-1),after:!before,target:{zone:'library',index}};
 }
 const scope=zone.dataset.scope;
 if(zone.dataset.append){const ids=scope===''?state.commonPartIds:state.roles.find(r=>r.id===scope)?.partIds;if(!ids)return null;return {zone,target:{zone:'stack',scope,index:ids.length}};}
 const rows=[...zone.querySelectorAll('[data-part-index]')],before=rows.find(e=>y<e.getBoundingClientRect().top+e.getBoundingClientRect().height/2);
 return {zone,row:before||rows.at(-1),after:!before,target:{zone:'stack',scope,index:before?Number(before.dataset.partIndex):rows.length}};
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
for(const container of [document.querySelector('.parts-palette'),$('assembly-stack'),$('scope-targets')]){
 container.ondragover=e=>{if(!dragPayload)return;const hit=dropAt(e.clientX,e.clientY);if(!hit)return;e.preventDefault();e.dataTransfer.dropEffect=dragPayload.example||dragPayload.source==='library'?'copy':'move';markDrop(hit);};
 container.ondragleave=e=>{if(!container.contains(e.relatedTarget))clearDrop();};
 container.ondrop=e=>{e.preventDefault();const hit=dropAt(e.clientX,e.clientY),payload=dragPayload;dragPayload=null;clearDrop();if(hit&&payload)commitPlacement(payload,hit.target);};
}

$('save').onclick=()=>{try{const checked=validate(state);localStorage.setItem('codex-customizer.v2',JSON.stringify(checked));notice('パーツとロールをブラウザーに保存しました。');}catch(error){notice(error.message);}};
function download(name,bytes,type){const u=URL.createObjectURL(new Blob([bytes],{type})),a=el('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
$('download-config').onclick=()=>{try{validate(state);download('customizer.json',JSON.stringify(state,null,2),'application/json');}catch(error){notice(error.message);}};
$('download-zip').onclick=()=>{updateOutput();if(!output)return;const files=Object.fromEntries(Object.entries(output.files).map(([p,s])=>[p,strToU8(s)]));files['APPLY.txt']=strToU8('CODEX_HOME generated by Codex Customizer\nZIPの内容を新しいCODEX_HOMEへ展開し、runtimeの参照先として配置・マウントしてください。既存環境への統合は差分を確認してください。フックの信頼レビューと、追加ポリシーにはNode.js 18+ / POSIX shellが必要です。\n');download('codex-'+state.setId+'.zip',zipSync(files),'application/zip');};
$('file-select').onchange=()=>{$('file-preview').textContent=output?.files[$('file-select').value]||'';};
$('load-config').onclick=()=>$('config-file').click();$('config-file').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>5000000)throw Error('5MB以下の構成JSONを選んでください');const candidate=validate(toWorkbench(validate(JSON.parse(await f.text()))));lastState=clone(state);state=candidate;render();notice('構成を読み込みました。以前の設定もパーツとして扱えます。');}catch(error){notice(error.message);}finally{e.target.value='';}};
$('import-skill').onclick=()=>$('skill-folder').click();$('skill-folder').onchange=async e=>{try{const entries=[...e.target.files];if(!entries.length)return;if(entries.reduce((n,f)=>n+f.size,0)>4000000)throw Error('取り込みは4MB以下にしてください');const folder=entries[0].webkitRelativePath.split('/')[0],files=[];for(const f of entries){const bytes=new Uint8Array(await f.arrayBuffer());if(bytes.includes(0))throw Error('UTF-8テキストのみ取り込めます: '+f.name);files.push({path:f.webkitRelativePath.slice(folder.length+1),content:new TextDecoder('utf-8',{fatal:true}).decode(bytes)});}const candidate=clone(state);const part={id:nextPartId(candidate.components,'skill'),name:folder,type:'skill',data:{files}};candidate.components.push(part);state=validate(candidate);catalog='library';render();announce('スキルをパーツとして取り込みました。ドラッグして組み込めます。');}catch(error){notice(error.message);}finally{e.target.value='';}};
$('simulate').onclick=()=>{
 clearTimeout(timer);worker?.terminate();const effective=materialize(state);if(!effective.policyEnabled){$('verdict').textContent='実行ポリシーパーツは組み込まれていません。';return;}
 try{validate(state);}catch(error){$('verdict').textContent=error.message;return;}
 worker=new Worker('worker.js',{type:'module'});$('verdict').textContent='解析中…';worker.onmessage=e=>{clearTimeout(timer);worker.terminate();const r=e.data;$('verdict').replaceChildren(el('strong',r.decision==='deny'?'追加ポリシーが拒否':'追加ポリシーの拒否条件に該当なし'),...r.findings.map(f=>el('p',f.message)),el('p','Codex の標準判定・承認・サンドボックスは別途適用されます。'));};worker.onerror=()=>{clearTimeout(timer);worker.terminate();$('verdict').textContent='解析に失敗したため拒否';};timer=setTimeout(()=>{worker.terminate();$('verdict').textContent='解析が3秒を超えたため拒否';},3000);worker.postMessage({command:$('command').value,policy:effective.policy});
};
const cardHelp=el('p','ダブルクリックまたはEnterで編集。Spaceで配置、Alt＋上下キーで移動、Deleteでライブラリへ戻します。','sr-only');cardHelp.id='card-help';document.body.append(cardHelp);
for(const f of ['hook.mjs','worker-node.mjs']){try{const response=await fetch('runtime/'+f);if(!response.ok)throw Error('フック実行ファイルを読み込めませんでした');runtime[f]=await response.text();}catch(error){notice(error.message);}}
render();
