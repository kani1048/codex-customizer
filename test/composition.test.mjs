import test from 'node:test';
import assert from 'node:assert/strict';
import {placePart, copyPreset, instructionPresets} from '../src/composition.mjs';
import {defaults, compile, validate} from '../src/assembly.mjs';

function fixture() {
  const state=structuredClone(defaults);
  state.policyEnabled=false;
  state.roles=[{id:'dev',name:'開発',model:'',reasoning:'',instructionIds:[],skillIds:[]}];
  state.activeRole='dev';
  return state;
}

test('ライブラリから組み込み、途中への挿入・上下への並び替えを出力に反映',()=>{
  const a=fixture();
  const parts=['plan','verify','review'].map(id=>copyPreset(a,id));
  const ids=a.roles[0].instructionIds;
  placePart(a,'dev','instruction',parts[0].id,0);
  placePart(a,'dev','instruction',parts[1].id,1);
  placePart(a,'dev','instruction',parts[2].id,1);
  assert.deepEqual(ids,[parts[0].id,parts[2].id,parts[1].id]);
  placePart(a,'dev','instruction',parts[1].id,0);
  assert.deepEqual(ids,[parts[1].id,parts[0].id,parts[2].id]);
  placePart(a,'dev','instruction',parts[1].id,3);
  assert.deepEqual(ids,[parts[0].id,parts[2].id,parts[1].id]);
  placePart(a,'dev','instruction',parts[2].id,2);
  assert.deepEqual(ids,[parts[0].id,parts[2].id,parts[1].id]);
  const text=compile(validate(JSON.parse(JSON.stringify(a)))).files['AGENTS.md'];
  assert.ok(text.indexOf(parts[0].content)<text.indexOf(parts[2].content));
  assert.ok(text.indexOf(parts[2].content)<text.indexOf(parts[1].content));
});

test('同じパーツの再ドロップは複製せず、他ロールと元のライブラリを維持',()=>{
  const a=fixture(),p=copyPreset(a,'plan');
  a.roles.push({id:'review',name:'レビュー',model:'',reasoning:'',instructionIds:[p.id],skillIds:[]});
  placePart(a,'dev','instruction',p.id,0);placePart(a,'dev','instruction',p.id,1);
  assert.deepEqual(a.roles[0].instructionIds,[p.id]);
  assert.deepEqual(a.roles[1].instructionIds,[p.id]);
  assert.equal(a.instructionParts.length,1);
});

test('プリセットの追加は独立した編集可能なコピーでIDが重複しない',()=>{
  const a=fixture(),first=copyPreset(a,'plan'),second=copyPreset(a,'plan');
  assert.notEqual(first.id,second.id);first.content='独自の指示';
  assert.notEqual(second.content,first.content);
  assert.notEqual(instructionPresets.find(p=>p.id==='plan').content,first.content);
  assert.throws(()=>copyPreset(a,'missing'));
});

test('スキルの追加・並び替えと、壊れたドロップの拒否',()=>{
  const a=fixture();
  a.skills=['one','two'].map(id=>({id,name:id,common:false,files:[{path:'SKILL.md',content:id}]}));
  placePart(a,'dev','skill','one',0);placePart(a,'dev','skill','two',0);
  assert.deepEqual(a.roles[0].skillIds,['two','one']);
  assert.ok(compile(a).files['skills/two/SKILL.md']);
  for(const args of [['missing','skill','one',0],['dev','instruction','one',0],['dev','skill','one',-1],['dev','skill','one',10],['dev','skill','one',NaN],['dev','hook','one',0]]){
    const before=JSON.stringify(a);assert.throws(()=>placePart(a,...args));assert.equal(JSON.stringify(a),before);
  }
});
