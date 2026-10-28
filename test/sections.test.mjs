import test from 'node:test';
import assert from 'node:assert/strict';
import TOML from '@iarna/toml';
import {defaults,compile} from '../src/assembly.mjs';
import {placeComponent,partTypes} from '../src/workbench.mjs';
import {componentSections,sectionForType,sectionParts,sectionDropIndex,sectionMoveIndex} from '../src/sections.mjs';
function fixture(){
 const a=structuredClone(defaults);a.policyEnabled=false;a.instructions='';a.workbenchVersion=1;
 a.components=[
  {id:'cfg-first',type:'config',name:'先の設定',data:{model:'first'}},
  {id:'i-first',type:'instruction',name:'先の指示',data:{content:'first instruction'}},
  {id:'cfg-last',type:'config',name:'後の設定',data:{model:'last'}},
  {id:'i-last',type:'instruction',name:'後の指示',data:{content:'last instruction'}},
 ];a.commonPartIds=a.components.map(p=>p.id);return a;
}
test('全9種類を重複なく7セクションに分類する',()=>{
 assert.equal(componentSections.length,7);const types=componentSections.flatMap(s=>s.types);assert.equal(types.length,new Set(types).size);assert.deepEqual([...types].sort(),Object.keys(partTypes).sort());assert.equal(sectionForType('file').id,'hooks');assert.equal(sectionForType('policy').id,'commands');
});
test('分類表示は保存順を変えず、セクション内の移動位置を実際の出力順へ変換する',()=>{
 const a=fixture(),before=JSON.stringify(a);
 assert.deepEqual(sectionParts(a,'','config').map(r=>r.index),[0,2]);assert.equal(JSON.stringify(a),before);
 assert.equal(sectionDropIndex(a,'','config','cfg-last'),2);assert.equal(sectionDropIndex(a,'','config'),3);
 assert.equal(sectionDropIndex(a,'','hooks'),4);
 assert.equal(sectionMoveIndex(a,'','cfg-first',-1),null);assert.equal(sectionMoveIndex(a,'','cfg-first',1),3);
 placeComponent(a,'','cfg-first',sectionMoveIndex(a,'','cfg-first',1));
 assert.equal(TOML.parse(compile(a).files['config.toml']).model,'first');
 assert.deepEqual(sectionParts(a,'','instructions').map(r=>r.part.id),['i-first','i-last']);
 placeComponent(a,'','i-last',sectionMoveIndex(a,'','i-last',-1));
 const text=compile(a).files['AGENTS.md'];assert.ok(text.indexOf('last instruction')<text.indexOf('first instruction'));
});
test('ロール固有の配置先と、共通から継承する部品を混同しない',()=>{
 const a=fixture();a.roles=[{id:'dev',name:'開発',model:'',reasoning:'',instructionIds:[],skillIds:[],partIds:['i-last','cfg-first']}];a.activeRole='dev';
 assert.equal(sectionDropIndex(a,'dev','config'),2);assert.equal(sectionDropIndex(a,'dev','skills'),2);
 assert.deepEqual(sectionParts(a,'dev','instructions').map(r=>r.part.id),['i-last']);
 assert.deepEqual(sectionParts(a,'','instructions').map(r=>r.part.id),['i-first','i-last']);
 const before=JSON.stringify(a);
 for(const call of [()=>sectionParts(a,'missing','config'),()=>sectionDropIndex(a,'','missing'),()=>sectionDropIndex(a,'','config','i-first'),()=>sectionMoveIndex(a,'','i-first',2)])assert.throws(call);
 assert.equal(JSON.stringify(a),before);
});
