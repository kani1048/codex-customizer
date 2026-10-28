import {defaults} from './assembly.mjs';
import {instructionPresets} from './composition.mjs';
import {nextPartId} from './workbench.mjs';
const clone=x=>structuredClone(x);
export const initialParts=[
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
export function initializeParts(a){
 if(a.partsLibraryVersion===1)return a;
 for(const source of initialParts){
  if(a.components.some(p=>p.type===source.type&&JSON.stringify(p.data)===JSON.stringify(source.data)))continue;
  a.components.push({...clone(source),id:a.components.some(p=>p.id===source.id)?nextPartId(a.components,source.type):source.id});
 }
 a.partsLibraryVersion=1;
 return a;
}
