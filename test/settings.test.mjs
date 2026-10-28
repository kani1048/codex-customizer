import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validate,compile} from '../src/assembly.mjs';
import {toWorkbench,materialize} from '../src/workbench.mjs';
import {scopeSettings,setScopeSetting} from '../src/settings.mjs';
function fresh(){const a=toWorkbench({...structuredClone(defaults),policyEnabled:false});a.roles.push({id:'dev',name:'開発',model:'',reasoning:'',instructionIds:[],skillIds:[],partIds:[]});a.activeRole='dev';return a;}
test('ロールごとの設定と継承を切り替え、共通と既存TOMLを保持する',()=>{
 const a=fresh();setScopeSetting(a,'','model','common-model');setScopeSetting(a,'','baseConfig','[custom]\nvalue = true');
 const before=compile(a).files['config.toml'];
 setScopeSetting(a,'dev','sandbox','read-only');setScopeSetting(a,'dev','model','role-model');
 validate(a);assert.equal(materialize(a).model,'role-model');assert.equal(materialize(a).sandbox,'read-only');
 setScopeSetting(a,'dev','model','');assert.equal(materialize(a).model,'common-model');
 setScopeSetting(a,'dev','sandbox','');assert.equal(compile(a).files['config.toml'],before);
 assert.equal(scopeSettings(a,'dev').model,undefined);
 const n=a.components.length;for(let i=0;i<10;i++)setScopeSetting(a,'dev','model','test-'+i);assert.ok(a.components.length<=n+1);
});
test('他ロールと共有していた設定を変更しても共有先を変えない',()=>{
 const a=fresh(),p={id:'shared',name:'共有設定',type:'config',data:{model:'old',sandbox:'read-only'}};
 a.components.push(p);a.roles[0].partIds.push(p.id);a.roles.push({...structuredClone(a.roles[0]),id:'review'});
 setScopeSetting(a,'dev','model','new');validate(a);
 assert.equal(scopeSettings(a,'review').model,'old');assert.equal(scopeSettings(a,'dev').model,'new');
 assert.equal(scopeSettings(a,'dev').sandbox,'read-only');
 assert.throws(()=>setScopeSetting(a,'missing','model','x'));assert.throws(()=>setScopeSetting(a,'dev','unknown','x'));
});
