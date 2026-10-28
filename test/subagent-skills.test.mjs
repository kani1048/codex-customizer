import test from 'node:test';
import assert from 'node:assert/strict';
import TOML from '@iarna/toml';
import {defaults,validate,compile} from '../src/assembly.mjs';
import {toWorkbench,newComponent,selectedComponents,deleteComponent,affectedScopes} from '../src/workbench.mjs';
function fixture(){const a=toWorkbench({...structuredClone(defaults),policyEnabled:false});a.components=[];a.commonPartIds=[];const skills=[1,2,3].map(()=>newComponent(a,'skill'));const agents=[1,2].map(()=>newComponent(a,'subagent'));agents[0].data.skillIds=[skills[1].id];agents[1].data.skillIds=[skills[2].id];a.roles.push({id:'dev',name:'開発',model:'',reasoning:'',instructionIds:[],skillIds:[],partIds:[skills[0].id,...agents.map(p=>p.id)]},{id:'other',name:'保守',model:'',reasoning:'',instructionIds:[],skillIds:[],partIds:[agents[0].id,skills[1].id]});a.activeRole='dev';return {a,skills,agents};}
test('担当のスキルを親に追加し、担当ごとの有効設定を相対パスで出力する',()=>{
 const {a,skills,agents}=fixture();const out=compile(a);assert.equal(selectedComponents(a).filter(p=>p.type==='skill').length,3);
 for(const s of skills)assert.ok(out.files['skills/'+s.id+'/SKILL.md']);
 for(const agent of agents){const d=TOML.parse(out.files['agents/'+agent.data.agentName+'.toml']);assert.equal(d.skills.bundled.enabled,false);assert.equal(d.skills.config.length,3);assert.deepEqual(d.skills.config.filter(c=>c.enabled).map(c=>c.path),agent.data.skillIds.map(id=>'../skills/'+id));}
 const before=JSON.stringify(a);compile(a);assert.equal(JSON.stringify(a),before);
 a.roles[0].partIds=a.roles[0].partIds.filter(id=>id!==agents[0].id);assert.ok(!compile(a).files['skills/'+skills[1].id+'/SKILL.md']);
 a.activeRole='other';assert.ok(compile(a).files['skills/'+skills[1].id+'/SKILL.md']);
 const restored=validate(JSON.parse(JSON.stringify(a)));assert.deepEqual(compile(restored).files,compile(a).files);
});
test('影響先は担当と親ロールの複数経路をまとめ、共通配置と未配置の担当も追跡する',()=>{
 const {a,skills,agents}=fixture();const impact=affectedScopes(a,skills[1].id);assert.deepEqual(impact.subagents,[{id:agents[0].id,name:agents[0].name}]);assert.equal(impact.roles.length,2);assert.equal(impact.roles[1].direct,true);assert.equal(impact.roles[1].via[0].id,agents[0].id);
 a.commonPartIds.push(agents[0].id);assert.equal(affectedScopes(a,skills[1].id).common,true);
 a.roles.forEach(r=>r.partIds=[]);a.commonPartIds=[];assert.equal(affectedScopes(a,skills[1].id).roles.length,0);assert.equal(affectedScopes(a,skills[1].id).subagents.length,1);
 deleteComponent(a,skills[1].id);assert.deepEqual(agents[0].data.skillIds,[]);validate(a);
});
test('参照先はスキルに限定し、重複・欠落を拒否する。旧形式は空の担当スキルとして扱う',()=>{
 const {a,skills,agents}=fixture();for(const ids of [[skills[0].id,skills[0].id],['missing'],[agents[1].id]]){agents[0].data.skillIds=ids;assert.throws(()=>validate(a));}
 delete agents[0].data.skillIds;validate(a);const d=TOML.parse(compile(a).files['agents/'+agents[0].data.agentName+'.toml']);assert.ok(d.skills.config.every(c=>!c.enabled));
});
test('直接配置・複数担当の参照を重複出力せず、最後の参照を外したときだけ除外する',()=>{
 const {a,skills,agents}=fixture();agents[1].data.skillIds=[skills[1].id];a.roles[0].partIds.push(skills[1].id);
 const path='skills/'+skills[1].id+'/SKILL.md';assert.equal(Object.keys(compile(a).files).filter(p=>p===path).length,1);
 agents[0].data.skillIds=[];agents[1].data.skillIds=[];assert.ok(compile(a).files[path]);
 a.roles[0].partIds=a.roles[0].partIds.filter(id=>id!==skills[1].id);assert.equal(compile(a).files[path],undefined);
});
