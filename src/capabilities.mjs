export const reasoningLevels=['low','medium','high','xhigh','max','ultra'];
export const approvalCategories=['sandbox_approval','rules','mcp_elicitations','request_permissions','skill_approval'];
export const reducibleFeatures=['shell_tool','apps','plugins','memories','request_permissions_tool'];
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
export function validApproval(v){return ['on-request','never'].includes(v)||(object(v)&&Object.keys(v).length===1&&object(v.granular)&&Object.keys(v.granular).length===approvalCategories.length&&approvalCategories.every(k=>typeof v.granular[k]==='boolean'));}
export function validateAgentSettings(v){
 if(!object(v))throw Error('サブエージェント全体設定が不正です');
 for(const [k,x]of Object.entries(v)){
  if(['enabled','interrupt_message'].includes(k)){if(typeof x!=='boolean')throw Error('サブエージェントの有効設定が不正です');}
  else if(k==='max_concurrent_threads_per_session'){if(!Number.isSafeInteger(x)||x<1)throw Error('同時稼働数は1以上の整数で指定してください');}
  else if(k==='default_subagent_model'){if(typeof x!=='string'||!x.trim()||x.length>100||/[\r\n]/.test(x))throw Error('子の既定モデルが不正です');}
  else if(k==='default_subagent_reasoning_effort'){if(!reasoningLevels.includes(x))throw Error('子の既定推論が不正です');}
  else throw Error('未知のサブエージェント全体設定です');
 }
}
export function validateMcp(d){
 const keys=['serverName','transport','command','args','cwd','env','envVars','url','bearerTokenEnvVar','envHttpHeaders','enabledTools','disabledTools','startupTimeoutSec','toolTimeoutSec','enabled','required'];
 if(Object.keys(d).some(k=>!keys.includes(k))||typeof d.serverName!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(d.serverName)||['constructor','prototype','__proto__'].includes(d.serverName))throw Error('MCPサーバー名が不正です');
 if(!['stdio','http'].includes(d.transport))throw Error('MCP接続方式が不正です');
 for(const k of ['command','cwd','url','bearerTokenEnvVar'])if(d[k]!==undefined&&(typeof d[k]!=='string'||d[k].length>2000||/[\r\n\0]/.test(d[k])))throw Error('MCPの文字列が不正です: '+k);
 if(d.transport==='stdio'&&!d.command?.trim())throw Error('MCPの起動コマンドを入力してください');
 if(d.transport==='http'){let url;try{url=new URL(d.url);}catch{throw Error('MCPのURLが不正です');}if(!['http:','https:'].includes(url.protocol))throw Error('MCPにはHTTP/HTTPSのURLを指定してください');}
 for(const k of ['args','envVars','enabledTools','disabledTools'])if(d[k]!==undefined&&(!Array.isArray(d[k])||d[k].length>100||d[k].some(v=>typeof v!=='string'||v.length>2000||/[\r\n\0]/.test(v))))throw Error('MCPの一覧が不正です: '+k);
 for(const k of ['env','envHttpHeaders'])if(d[k]!==undefined&&(!object(d[k])||Object.keys(d[k]).length>100||Object.entries(d[k]).some(([key,v])=>!key||typeof v!=='string'||v.length>4000||/[\r\n\0]/.test(key+v))))throw Error('MCPの環境変数が不正です: '+k);
 for(const k of ['enabled','required'])if(d[k]!==undefined&&typeof d[k]!=='boolean')throw Error('MCPの有効設定が不正です');
 for(const k of ['startupTimeoutSec','toolTimeoutSec'])if(d[k]!==undefined&&(!Number.isFinite(d[k])||d[k]<=0))throw Error('MCPのタイムアウトは正の秒数で指定してください');
}
export function mcpConfig(d){
 const result={};const map=d.transport==='stdio'?{command:'command',args:'args',cwd:'cwd',env:'env',envVars:'env_vars'}:{url:'url',bearerTokenEnvVar:'bearer_token_env_var',envHttpHeaders:'env_http_headers'};
 Object.assign(map,{enabled:'enabled',required:'required',enabledTools:'enabled_tools',disabledTools:'disabled_tools',startupTimeoutSec:'startup_timeout_sec',toolTimeoutSec:'tool_timeout_sec'});
 for(const [key,out]of Object.entries(map)){const v=d[key];if(v!==undefined&&v!==''&&(!Array.isArray(v)||v.length))result[out]=structuredClone(v);}
 return result;
}
