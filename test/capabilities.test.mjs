import test from 'node:test';
import assert from 'node:assert/strict';
import TOML from '@iarna/toml';
import {defaults,validate,compile} from '../src/assembly.mjs';
import {toWorkbench,newComponent,placeComponent,affectedScopes} from '../src/workbench.mjs';
import {setScopeSetting} from '../src/settings.mjs';
import {approvalCategories,reasoningLevels} from '../src/capabilities.mjs';
function fresh(){return toWorkbench({...structuredClone(defaults),policyEnabled:false});}
function config(a){return TOML.parse(compile(a).files['config.toml']);}
function role(a,id){a.roles.push({id,name:id,model:'',reasoning:'',instructionIds:[],skillIds:[],partIds:[]});return a.roles.at(-1);}
test('旧承認方針の移行・never・詳細条件・推論の追加値を往復できる',()=>{
 const a=fresh();a.approval='untrusted';a.components.find(p=>p.type==='config').data.approval='untrusted';const checked=validate(a);assert.equal(checked.approval,'on-request');assert.equal(a.approval,'untrusted');assert.equal(config(checked).approval_policy,'on-request');
 for(const level of reasoningLevels){setScopeSetting(checked,'','reasoning',level);assert.equal(config(checked).model_reasoning_effort,level);}
 setScopeSetting(checked,'','approval','never');assert.equal(config(checked).approval_policy,'never');
 const policy={granular:Object.fromEntries(approvalCategories.map(k=>[k,k!=='rules']))};setScopeSetting(checked,'','approval',policy);assert.deepEqual(config(checked).approval_policy,policy);
 assert.deepEqual(config(validate(JSON.parse(JSON.stringify(checked)))),config(checked));
 const broken=structuredClone(checked);broken.components.find(p=>p.type==='config').data.approval={granular:{unexpected:true}};assert.throws(()=>validate(broken));
});
test('項目を継承に戻すとベースTOMLの承認とsandboxを保持し、明示指定で上書きする',()=>{
 const a=fresh();setScopeSetting(a,'','approval','');setScopeSetting(a,'','sandbox','');setScopeSetting(a,'','baseConfig','approval_policy="never"\nsandbox_mode="danger-full-access"\n[custom]\nvalue=true');
 assert.equal(config(a).approval_policy,'never');assert.equal(config(a).sandbox_mode,'danger-full-access');assert.equal(config(a).custom.value,true);
 setScopeSetting(a,'','approval','on-request');setScopeSetting(a,'','sandbox','read-only');assert.equal(config(a).approval_policy,'on-request');assert.equal(config(a).sandbox_mode,'read-only');
});
test('MCP共有パーツは複数ロールで再利用でき、接続方式・環境変数・ツール制限を標準形式へ出力する',()=>{
 const a=fresh(),p=newComponent(a,'mcp');p.data={serverName:'docs',transport:'stdio',command:'node',args:['server.mjs','arg with space'],env:{MODE:'readonly'},envVars:['API_KEY'],enabledTools:['search'],disabledTools:['write'],startupTimeoutSec:20,toolTimeoutSec:120,enabled:true,required:false};role(a,'dev').partIds=[p.id];role(a,'review').partIds=[p.id];
 for(const id of ['dev','review']){a.activeRole=id;const server=config(a).mcp_servers.docs;assert.deepEqual(server.args,p.data.args);assert.deepEqual(server.env_vars,['API_KEY']);assert.deepEqual(server.enabled_tools,['search']);assert.equal(server.tool_timeout_sec,120);assert.equal(server.required,false);}
 assert.equal(affectedScopes(a,p.id).roles.length,2);a.commonPartIds.push(p.id);assert.equal(Object.keys(config(a).mcp_servers).length,1);
 p.data.transport='http';p.data.url='https://example.com/mcp';p.data.bearerTokenEnvVar='MCP_TOKEN';p.data.envHttpHeaders={'X-Key':'HEADER_TOKEN'};const server=config(a).mcp_servers.docs;assert.equal(server.command,undefined);assert.equal(server.url,p.data.url);assert.equal(server.bearer_token_env_var,'MCP_TOKEN');assert.deepEqual(server.env_http_headers,{'X-Key':'HEADER_TOKEN'});
 assert.deepEqual(config(validate(JSON.parse(JSON.stringify(a)))),config(a));
 const other=newComponent(a,'mcp');other.data.serverName='docs';placeComponent(a,'',other.id,a.commonPartIds.length);assert.throws(()=>compile(a),/重複/);
});
test('MCPのURL・一覧・型・タイムアウトの不正を未配置のパーツも含めて拒否',()=>{
 for(const change of [d=>d.url='file:///private',d=>d.enabledTools='search',d=>d.env={KEY:3},d=>d.startupTimeoutSec=0,d=>d.required='true',d=>d.extra=true]){const a=fresh(),p=newComponent(a,'mcp');p.data.transport='http';p.data.url='https://example.com/mcp';change(p.data);assert.throws(()=>validate(a));}
});
test('サブエージェント全体設定を継承・上書きし、無効指定を定義出力時も維持する',()=>{
 const a=fresh(),agent=newComponent(a,'subagent');role(a,'dev').partIds=[agent.id];role(a,'review').partIds=[agent.id];a.activeRole='dev';
 setScopeSetting(a,'','agentSettings',{enabled:false,max_concurrent_threads_per_session:3,default_subagent_model:'child-model',default_subagent_reasoning_effort:'ultra',interrupt_message:false});
 setScopeSetting(a,'dev','agentSettings',{max_concurrent_threads_per_session:2});assert.equal(config(a).agents.enabled,false);assert.equal(config(a).agents.max_concurrent_threads_per_session,2);assert.equal(config(a).agents.default_subagent_model,'child-model');
 a.activeRole='review';assert.equal(config(a).agents.max_concurrent_threads_per_session,3);assert.equal(config(a).agents.interrupt_message,false);
 setScopeSetting(a,'review','agentSettings',{enabled:true});assert.equal(config(a).agents.enabled,true);
 for(const settings of [{max_concurrent_threads_per_session:0},{max_concurrent_threads_per_session:1.5},{enabled:'true'},{default_subagent_reasoning_effort:'unknown'},{extra:1}]){const b=fresh();b.agentSettings=settings;assert.throws(()=>validate(b));}
});
test('担当の出力調整と機能制限は権限を追加せず、親のMCP設定を継承する',()=>{
 const a=fresh(),p=newComponent(a,'subagent');a.commonPartIds.push(p.id);Object.assign(p.data,{verbosity:'low',reasoningSummary:'concise',reasoning:'max',disabledFeatures:['shell_tool','apps','plugins','memories','request_permissions_tool'],includeSkillInstructions:false});
 const out=compile(a),d=TOML.parse(out.files['agents/'+p.data.agentName+'.toml']);assert.equal(d.model_verbosity,'low');assert.equal(d.model_reasoning_summary,'concise');assert.equal(d.model_reasoning_effort,'max');assert.ok(Object.values(d.features).every(v=>v===false));assert.equal(d.skills.include_instructions,false);assert.equal(d.mcp_servers,undefined);assert.equal(d.approval_policy,undefined);
 p.data.disabledFeatures=['unknown'];assert.throws(()=>validate(a));
});
