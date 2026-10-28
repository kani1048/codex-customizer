import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import TOML from '@iarna/toml';
import {defaults,validate,compile} from '../src/assembly.mjs';
import {toWorkbench,placeComponent,removeComponent,deleteComponent,selectedComponents,newComponent,materialize} from '../src/workbench.mjs';
const clone=x=>structuredClone(x);
const runtime=Object.fromEntries(['hook.mjs','worker-node.mjs'].map(f=>[f,readFileSync('dist/runtime/'+f,'utf8')]));
function fresh(){const a=toWorkbench({...clone(defaults),policyEnabled:false,instructions:''});a.components=[];a.commonPartIds=[];return a;}
function role(a,id='dev'){a.roles.push({id,name:id,instructionIds:[],skillIds:[],model:'',reasoning:'',partIds:[]});a.activeRole=id;return a.roles.at(-1);}
function add(a,type,name,data,scope=''){const p={id:name,type,name,data};a.components.push(p);placeComponent(a,scope,p.id,scope?a.roles.find(r=>r.id===scope).partIds.length:a.commonPartIds.length);return p;}

test('全種類を同じスタックに組み込み、設定・指示・スキル・ルール・フック・ファイルを出力',()=>{
 const a=fresh();
 add(a,'config','base',{model:'base-model',sandbox:'read-only',approval:'untrusted'});
 add(a,'instruction','shared',{content:'共通の指示'});
 add(a,'rule','push',{pattern:['git','push'],decision:'prompt',reason:'確認'});
 add(a,'hook','stop',{event:'Stop',matcher:'',command:'echo stop'});
 add(a,'file','script',{path:'custom.mjs',content:'console.log(1)'});
 role(a);add(a,'config','override',{model:'role-model',reasoning:'high'},'dev');
 add(a,'skill','review-skill',{files:[{path:'SKILL.md',content:'review'},{path:'scripts/run.py',content:'print(1)'}]},'dev');
 const policy=newComponent(a,'policy',defaults.policy.rules);placeComponent(a,'dev',policy.id,2);
 const out=compile(validate(a),runtime),config=TOML.parse(out.files['config.toml']);
 assert.equal(config.model,'role-model');assert.equal(config.sandbox_mode,'read-only');assert.equal(config.model_reasoning_effort,'high');
 assert.ok(out.files['AGENTS.md'].includes('共通の指示'));assert.equal(out.files['skills/review-skill/scripts/run.py'],'print(1)');assert.match(out.files['rules/customizer.rules'],/git/);assert.equal(config.hooks.Stop[0].hooks[0].command,'echo stop');assert.equal(out.files['hooks/custom/custom.mjs'],'console.log(1)');assert.ok(out.files['hooks/exec-policy/hook.mjs']);assert.ok(materialize(a).policyEnabled);
 a.activeRole='';const common=compile(a);assert.equal(TOML.parse(common.files['config.toml']).model,'base-model');assert.ok(!common.files['skills/review-skill/SKILL.md']);assert.ok(!common.files['hooks/exec-policy/hook.mjs']);
});

test('異なる種類も同じ操作で並び替え、後の設定を優先し、指示順を出力へ反映',()=>{
 const a=fresh();add(a,'config','one',{model:'one'});add(a,'instruction','first',{content:'first body'});add(a,'config','two',{model:'two'});add(a,'instruction','second',{content:'second body'});
 assert.equal(TOML.parse(compile(a).files['config.toml']).model,'two');placeComponent(a,'','one',4);
 assert.equal(TOML.parse(compile(a).files['config.toml']).model,'one');placeComponent(a,'','second',0);
 const text=compile(a).files['AGENTS.md'];assert.ok(text.indexOf('second body')<text.indexOf('first body'));
 removeComponent(a,'','one');assert.ok(a.components.some(p=>p.id==='one'));assert.equal(TOML.parse(compile(a).files['config.toml']).model,'two');
});

test('旧構成の移行は繰り返しても増殖せず、既存の出力内容とスキルの配置先を維持',()=>{
 const a=clone(defaults);a.model='legacy';a.skills=[{id:'original-skill',name:'Original',common:true,files:[{path:'SKILL.md',content:'original'}]}];a.instructionParts=[{id:'p',name:'指示',content:'内容'}];a.roles=[{id:'dev',name:'開発',model:'role-model',reasoning:'high',instructionIds:['p'],skillIds:['original-skill']}];a.activeRole='dev';a.rules=[{pattern:['git','push'],decision:'prompt',reason:'確認'}];a.hooks=[{event:'Stop',matcher:'',command:'echo stop',enabled:true}];a.hookFiles=[{path:'a.mjs',content:'a'}];
 const migrated=toWorkbench(validate(a));assert.deepEqual(toWorkbench(migrated),migrated);const before=compile(a,runtime).files,after=compile(migrated,runtime).files;assert.deepEqual(Object.keys(after).sort(),Object.keys(before).sort());for(const key of Object.keys(before)){if(key==='config.toml')assert.deepEqual(TOML.parse(after[key]),TOML.parse(before[key]));else assert.equal(after[key],before[key],key);}
 assert.deepEqual(validate(JSON.parse(JSON.stringify(migrated))),migrated);
 const empty=fresh();assert.deepEqual(toWorkbench(empty),empty);
});

test('共通とロールの参照を重複出力せず、削除時は全参照を取り除く',()=>{
 const a=fresh();add(a,'instruction','shared',{content:'once'});const r=role(a);placeComponent(a,r.id,'shared',0);assert.equal(selectedComponents(a).length,1);assert.equal(compile(a).files['AGENTS.md'].split('once').length,2);
 deleteComponent(a,'shared');assert.deepEqual(a.commonPartIds,[]);assert.deepEqual(r.partIds,[]);assert.deepEqual(a.components,[]);
});

test('未使用のパーツも検証し、未知の種類・危険なパス・参照欠落・出力ファイル衝突を拒否',()=>{
 for(const component of [
  {id:'bad',name:'bad',type:'unknown',data:{}},
  {id:'bad',name:'bad',type:'file',data:{path:'../escape',content:''}},
  {id:'bad',name:'bad',type:'hook',data:{event:'Stop',matcher:'[',command:'echo hi'}},
  {id:'bad',name:'bad',type:'config',data:{model:'ok',unknown:true}},
  {id:'bad',name:'bad',type:'skill',data:{files:[]}},
  {id:'bad',name:'bad',type:'policy',data:{rules:{nonexistent:true}}},
 ]){const a=fresh();a.components.push(component);assert.throws(()=>validate(a));}
 const a=fresh();a.commonPartIds=['missing'];assert.throws(()=>validate(a));a.commonPartIds=[];
 add(a,'file','first',{path:'same.mjs',content:'a'});add(a,'file','second',{path:'same.mjs',content:'b'});assert.throws(()=>compile(a));
});

test('全種類の新しいパーツを作成でき、不正なドロップは構成を変えない',()=>{
 const a=fresh();for(const type of ['config','instruction','skill','subagent','rule','hook','policy','file'])newComponent(a,type,defaults.policy.rules);assert.equal(validate(a).components.length,8);
 const before=JSON.stringify(a);for(const args of [['missing',a.components[0].id,0],['','missing',0],['',a.components[0].id,-1],['',a.components[0].id,1]]){assert.throws(()=>placeComponent(a,...args));assert.equal(JSON.stringify(a),before);}
});


test('空の設定は引き継ぎ、パーツの値が旧ロール設定より優先される',()=>{
 const a=fresh();const r=role(a);r.model='legacy-role';
 add(a,'config','model',{model:'part-model',sandbox:'',approval:'',reasoning:'',baseConfig:''},'dev');
 const c=TOML.parse(compile(a).files['config.toml']);assert.equal(c.model,'part-model');assert.equal(c.sandbox_mode,'workspace-write');
});
test('移行時に基本設定のID候補と同名でも既存スキルの配置先を維持',()=>{
 const a=clone(defaults);a.skills=[{id:'config-1',name:'スキル',common:true,files:[{path:'SKILL.md',content:'keep'}]}];
 const migrated=toWorkbench(validate(a));assert.ok(compile(migrated,runtime).files['skills/config-1/SKILL.md']);assert.equal(new Set(migrated.components.map(p=>p.id)).size,migrated.components.length);
});

test('ドラッグの配置先で追加・順序・ロール間移動・ライブラリへの返却を制御',async()=>{
 const {dropComponent}=await import('../src/workbench.mjs');const a=fresh();
 add(a,'instruction','one',{content:'one'});add(a,'instruction','two',{content:'two'});role(a,'dev');role(a,'review');
 dropComponent(a,{id:'one',source:'library'},{zone:'stack',scope:'dev',index:0});
 assert.deepEqual(a.commonPartIds,['one','two']);assert.deepEqual(a.roles[0].partIds,['one']);
 dropComponent(a,{id:'two',source:'stack',scope:''},{zone:'stack',scope:'dev',index:0});
 assert.deepEqual(a.commonPartIds,['one']);assert.deepEqual(a.roles[0].partIds,['two','one']);
 dropComponent(a,{id:'one',source:'stack',scope:'dev'},{zone:'stack',scope:'dev',index:0});assert.deepEqual(a.roles[0].partIds,['one','two']);
 dropComponent(a,{id:'two',source:'stack',scope:'dev'},{zone:'stack',scope:'review',index:0});assert.deepEqual(a.roles[0].partIds,['one']);assert.deepEqual(a.roles[1].partIds,['two']);
 dropComponent(a,{id:'one',source:'stack',scope:'dev'},{zone:'library',index:2});assert.deepEqual(a.roles[0].partIds,[]);assert.deepEqual(a.commonPartIds,['one']);assert.deepEqual(a.components.map(p=>p.id),['two','one']);
 assert.ok(a.components.some(p=>p.id==='one'));
});

test('不正な配置先・移動元でドロップしても元の構成を保持',async()=>{
 const {dropComponent}=await import('../src/workbench.mjs');const a=fresh();add(a,'instruction','one',{content:'one'});
 for(const [payload,target]of [
  [{id:'one',source:'stack',scope:'missing'},{zone:'library',index:0}],
  [{id:'one',source:'library'},{zone:'stack',scope:'missing',index:0}],
  [{id:'one',source:'stack',scope:''},{zone:'library',index:-1}],
  [{id:'one',source:'library'},{zone:'stack',scope:'',index:10}],
  [{id:'one',source:'unknown'},{zone:'library',index:0}],
 ]){const before=JSON.stringify(a);assert.throws(()=>dropComponent(a,payload,target));assert.equal(JSON.stringify(a),before);}
});

test('編集の影響一覧には共通を継承する全ロールと直接参照を重複なく含める',async()=>{
 const {affectedScopes}=await import('../src/workbench.mjs');const a=fresh();add(a,'instruction','shared',{content:'all'});role(a,'dev');role(a,'review');
 placeComponent(a,'dev','shared',0);
 assert.deepEqual(affectedScopes(a,'shared'),{common:true,roles:[{id:'dev',name:'dev',source:'both'},{id:'review',name:'review',source:'common'}]});
 removeComponent(a,'','shared');assert.deepEqual(affectedScopes(a,'shared'),{common:false,roles:[{id:'dev',name:'dev',source:'direct'}]});
 removeComponent(a,'dev','shared');assert.deepEqual(affectedScopes(a,'shared'),{common:false,roles:[]});
});

test('同じサブエージェントを複数ロールで共有し標準の登録・定義・呼び出し案内を出力',()=>{
 const a=fresh();role(a,'dev');role(a,'review');
 const agent={id:'shared-reviewer',name:'レビュー担当',type:'subagent',data:{agentName:'reviewer',description:'実装のレビューを依頼する',instructions:'変更せずに不具合を調査し、親へ報告する。',model:'selected-model',reasoning:'high'}};
 a.components.push(agent);placeComponent(a,'dev',agent.id,0);placeComponent(a,'review',agent.id,0);
 const results=[];
 for(const id of ['dev','review']){
  a.activeRole=id;const out=compile(a);results.push(out);
  const config=TOML.parse(out.files['config.toml']),definition=TOML.parse(out.files['agents/reviewer.toml']);
  assert.equal(config.agents.enabled,true);assert.deepEqual(config.agents.reviewer,{description:agent.data.description,config_file:'agents/reviewer.toml'});
  assert.deepEqual(definition,{name:'reviewer',description:agent.data.description,developer_instructions:agent.data.instructions,model:'selected-model',model_reasoning_effort:'high'});
  assert.match(out.files['AGENTS.md'],/`reviewer`/);assert.ok(out.files['AGENTS.md'].includes(agent.data.description));
  assert.ok(!('sandbox_mode' in definition));assert.ok(!('approval_policy' in definition));
 }
 assert.equal(results[0].files['agents/reviewer.toml'],results[1].files['agents/reviewer.toml']);
 assert.deepEqual(a.roles.map(r=>r.partIds),[[agent.id],[agent.id]]);
 agent.data.instructions='更新した指示';for(const id of ['dev','review']){a.activeRole=id;assert.equal(TOML.parse(compile(a).files['agents/reviewer.toml']).developer_instructions,'更新した指示');}
 a.activeRole='';assert.ok(!compile(a).files['agents/reviewer.toml']);assert.ok(!TOML.parse(compile(a).files['config.toml']).agents);
});

test('共通サブエージェントの重複参照は1回だけ出力し親の設定と既存agentsを保持',()=>{
 const a=fresh();const p=newComponent(a,'subagent');p.data.agentName='inspector';a.commonPartIds.push(p.id);role(a,'dev');placeComponent(a,'dev',p.id,0);
 a.baseConfig='[agents]\nenabled=false\nmax_concurrent_threads_per_session=3\n[agents.existing]\ndescription="existing"\nconfig_file="agents/existing.toml"\n';
 const out=compile(a),config=TOML.parse(out.files['config.toml']),definition=TOML.parse(out.files['agents/inspector.toml']);
 assert.equal(config.agents.enabled,true);assert.equal(config.agents.max_concurrent_threads_per_session,3);assert.equal(config.agents.existing.description,'existing');
 assert.ok(!('model' in definition));assert.ok(!('model_reasoning_effort' in definition));assert.equal(Object.keys(out.files).filter(p=>p==='agents/inspector.toml').length,1);
 assert.equal(out.files['AGENTS.md'].split('`inspector`').length,2);assert.ok(out.warnings.some(w=>w.includes('agents.enabled')));
});

test('サブエージェントの不正な名前・欠落・権限設定を拒否し呼び出し名の衝突を検出',()=>{
 for(const change of [
  d=>d.agentName='../outside',d=>d.agentName='enabled',d=>d.agentName='max_concurrent_threads_per_session',d=>d.agentName='constructor',d=>d.agentName='',d=>d.description=' ',d=>d.instructions='',d=>d.model='a\nb',d=>d.reasoning='unknown',d=>d.sandbox_mode='read-only',
 ]){const a=fresh(),p=newComponent(a,'subagent');change(p.data);assert.throws(()=>validate(a));}
 const a=fresh(),p=newComponent(a,'subagent'),q=newComponent(a,'subagent');q.data.agentName=p.data.agentName;a.commonPartIds=[p.id,q.id];assert.throws(()=>compile(a),/重複/);
 a.commonPartIds=[p.id];a.baseConfig='[agents.'+p.data.agentName+']\ndescription="existing"\n';assert.throws(()=>compile(a),/重複/);
 a.baseConfig='agents="invalid"';assert.throws(()=>compile(a),/テーブル/);
});
