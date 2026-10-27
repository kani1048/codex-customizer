import parseTOML from '@iarna/toml/parse-string.js';
import stringifyTOML from '@iarna/toml/stringify.js';
const TOML={parse:parseTOML,stringify:stringifyTOML};
import {defaultPolicy,validatePolicy} from 'exec-policy/src/policy.mjs';
export const defaults={version:2,name:'開発用 Codex',setId:'development',model:'',reasoning:'',sandbox:'workspace-write',approval:'on-request',instructions:'変更の目的を確認し、必要な範囲で実装と検証を行ってください。\nユーザーには日本語で簡潔に説明してください。',policyEnabled:true,policy:structuredClone(defaultPolicy),rules:[],hooks:[],baseConfig:''};
const json=x=>JSON.stringify(x,null,2)+'\n';
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
function text(v,label,max=12000){if(typeof v!=='string'||v.length>max)throw Error(label+'が不正です');return v;}
export function validate(a){
 if(object(a)&&a.version===1){
  if(Object.keys(a).some(k=>!['version','name','environment','model','reasoning','sandbox','approval','instructions','policyEnabled','policy','rules','hooks','baseConfig'].includes(k)))throw Error('未知の構成項目があります');
  const {environment,...rest}=a;a={...rest,version:2,setId:environment};
 }
 if(!object(a)||a.version!==2)throw Error('構成ファイルの形式が不正です');
 if(Object.keys(a).some(k=>!Object.keys(defaults).includes(k)))throw Error('未知の構成項目があります');
 text(a.name,'構成名',100);if(!a.name.trim())throw Error('構成名を入力してください');
 if(typeof a.setId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(a.setId))throw Error('セットIDには英数字・ピリオド・ハイフン・アンダースコアを指定してください');
 text(a.model,'モデル',100);if(/[\n\r]/.test(a.model))throw Error('モデル名は1行にしてください');
 if(!['','low','medium','high','xhigh'].includes(a.reasoning))throw Error('推論設定が不正です');
 if(!['read-only','workspace-write'].includes(a.sandbox))throw Error('サンドボックス設定が不正です');
 if(!['on-request','untrusted'].includes(a.approval))throw Error('承認設定が不正です');
 text(a.instructions,'指示',20000);text(a.baseConfig,'ベース設定',60000);TOML.parse(a.baseConfig);
 if(typeof a.policyEnabled!=='boolean')throw Error('ポリシー設定が不正です');validatePolicy(a.policy);
 if(!Array.isArray(a.rules)||a.rules.length>100)throw Error('ルールが多すぎます');
 for(const r of a.rules){if(!object(r)||!Array.isArray(r.pattern)||!r.pattern.length||r.pattern.length>20||r.pattern.some(x=>typeof x!=='string'||!x||x.length>500)||!['allow','prompt','forbidden'].includes(r.decision))throw Error('コマンドルールの形式が不正です');text(r.reason,'理由',500);}
 if(!Array.isArray(a.hooks)||a.hooks.length>30)throw Error('フックが多すぎます');
 for(const h of a.hooks){if(!object(h)||!['PreToolUse','PostToolUse','SessionStart','Stop'].includes(h.event)||typeof h.enabled!=='boolean')throw Error('フック設定が不正です');text(h.matcher,'マッチャー',200);try{new RegExp(h.matcher);}catch{throw Error('マッチャーが正規表現ではありません');}text(h.command,'フックコマンド',2000);if(!h.command.trim()||/[\r\n]/.test(h.command))throw Error('フックコマンドは空でない1行で指定してください');}
 return structuredClone(a);
}
export function compile(input,runtimeFiles={}){
 const a=validate(input),config=TOML.parse(a.baseConfig),warnings=[];
 // Resolve the standard Codex home at execution time, independent of host or container.
 const root='${CODEX_HOME:-$HOME/.codex}';
 // Keep unknown imported settings while overriding only fields owned by this editor.
 for(const [k,v]of [['model',a.model],['model_reasoning_effort',a.reasoning]])if(v)config[k]=v;
 config.sandbox_mode=a.sandbox;config.approval_policy=a.approval;
 const files={};
 if(a.instructions.trim())files['AGENTS.md']=a.instructions+'\n';
 if(config.hooks&&!object(config.hooks))throw Error('ベースの hooks はテーブルである必要があります');
 function addHook(event,matcher,command){config.hooks??={};config.hooks[event]??=[];if(!Array.isArray(config.hooks[event]))throw Error('ベースの hooks.'+event+' が不正です');config.hooks[event].push({...(matcher?{matcher}:{}),hooks:[{type:'command',command,timeout:5}]});}
 if(a.policyEnabled){
  addHook('PreToolUse','^Bash$',`node "${root}/hooks/exec-policy/hook.mjs" "${root}/hooks/exec-policy/policy.json"`);
  files['hooks/exec-policy/policy.json']=json(a.policy);
  for(const f of ['hook.mjs','worker-node.mjs']){if(typeof runtimeFiles[f]!=='string')throw Error('フック実行ファイルが不足しています。ビルドをやり直してください');files['hooks/exec-policy/'+f]=runtimeFiles[f];}
  warnings.push('実行ポリシーは npm・make なども既定で拒否します。必要な部品を選んでください。');
 }
 for(const h of a.hooks)if(h.enabled)addHook(h.event,h.matcher,h.command);
 if(a.policyEnabled||a.hooks.some(h=>h.enabled)){config.features??={};if(!object(config.features))throw Error('ベースの features が不正です');if(config.features.hooks===false)warnings.push('取り込んだ hooks=false は、選択したフックを有効にするため true に変更されます。');config.features.hooks=true;warnings.push('フックの信頼レビューが別途必要です。フックコマンドは Codex を動かす環境で解決できるパスを指定してください。');}
 files['config.toml']=TOML.stringify(config);
 if(a.rules.length)files['rules/customizer.rules']=a.rules.map(r=>`prefix_rule(\n    pattern = ${JSON.stringify(r.pattern)},\n    decision = ${JSON.stringify(r.decision)},\n    justification = ${JSON.stringify(r.reason||'Customizer で設定')},\n)`).join('\n\n')+'\n';
 for(const r of a.rules)if(r.decision==='allow'&&['bash','sh','zsh','python','python3','node','env','npm','make'].includes(r.pattern[0]))warnings.push('広い許可を含みます: '+r.pattern.join(' ')+'。引数や呼び出すコードの安全性は保証しません。');
 if(a.baseConfig.trim())warnings.push('ベース設定の未知の項目は保持します。入力した秘密情報も出力に含まれるため、取り込むファイルの内容を確認してください。');
 warnings.push('既存の AGENTS.md・config.toml・rules/customizer.rules は、差分を確認してから反映してください。既存 hooks.json と他のルールも独立して読み込まれます。');
 const manifest={version:2,format:'codex-config-set',name:a.name,setId:a.setId,target:{codexHome:'$CODEX_HOME (未設定時: ~/.codex)'},files:Object.keys(files),requirements:{...(a.policyEnabled?{node:'18+',hookShell:'POSIX'}:{})},warnings};
 return {files,manifest,warnings};
}
