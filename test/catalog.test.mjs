import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validate,compile} from '../src/assembly.mjs';
import {toWorkbench,deleteComponent} from '../src/workbench.mjs';
import {initializeParts} from '../src/catalog.mjs';

test('初期パーツを同じライブラリへ追加しても配置と出力を変えない',()=>{
 const a=toWorkbench({...structuredClone(defaults),policyEnabled:false});
 const before=compile(a).files,ids=[...a.commonPartIds];
 initializeParts(a);validate(a);
 assert.ok(a.components.some(p=>p.type==='subagent'));
 assert.deepEqual(a.commonPartIds,ids);
 assert.deepEqual(compile(a).files,before);
 const count=a.components.length;
 initializeParts(a);assert.equal(a.components.length,count);
});

test('初期部品を編集・削除して保存した後は再読込で復元しない',()=>{
 const a=initializeParts(toWorkbench({...structuredClone(defaults),policyEnabled:false}));
 a.components.find(p=>p.id==='subagent-reviewer').name='自分のレビュー担当';
 deleteComponent(a,'subagent-researcher');
 const restored=initializeParts(toWorkbench(validate(JSON.parse(JSON.stringify(a)))));
 assert.equal(restored.components.find(p=>p.id==='subagent-reviewer').name,'自分のレビュー担当');
 assert.equal(restored.components.some(p=>p.id==='subagent-researcher'),false);
});
