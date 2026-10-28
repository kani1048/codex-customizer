// UI groups do not change the persisted assembly order or export contract.
export const componentSections = [
 {id:'config',name:'基本設定',caption:'モデル・推論・実行環境',types:['config']},
 {id:'instructions',name:'エージェントへの指示',caption:'AGENTS.md を指示パーツから組み立てる',types:['instruction']},
 {id:'skills',name:'スキル',caption:'作業の手順と付属ファイル',types:['skill']},
 {id:'subagents',name:'サブエージェント',caption:'ロールで共有する専門担当',types:['subagent']},
 {id:'mcp',name:'MCP接続',caption:'外部ツール・サーバーへの接続',types:['mcp']},
 {id:'commands',name:'コマンド制御',caption:'許可ルール・追加の実行ポリシー',types:['rule','policy']},
 {id:'hooks',name:'フック',caption:'イベント処理・実行するファイル',types:['hook','file']},
];
export function sectionForType(type){return componentSections.find(s=>s.types.includes(type));}
function scopeIds(a,scope){const ids=scope===''?a.commonPartIds:a.roles.find(r=>r.id===scope)?.partIds;if(!ids)throw Error('組み立て先が見つかりません');return ids;}
export function sectionParts(a,scope,sectionId){
 const section=componentSections.find(s=>s.id===sectionId);if(!section)throw Error('セクションが見つかりません');
 return scopeIds(a,scope).map((id,index)=>({part:a.components.find(p=>p.id===id),index})).filter(row=>section.types.includes(row.part?.type));
}
export function sectionDropIndex(a,scope,sectionId,beforeId=null){
 const rows=sectionParts(a,scope,sectionId);
 if(beforeId!==null){const row=rows.find(row=>row.part.id===beforeId);if(!row)throw Error('挿入位置が見つかりません');return row.index;}
 return rows.length?rows.at(-1).index+1:scopeIds(a,scope).length;
}
export function sectionMoveIndex(a,scope,id,delta){
 if(![-1,1].includes(delta))throw Error('移動方向が不正です');
 const part=a.components.find(p=>p.id===id),section=sectionForType(part?.type);if(!section)throw Error('パーツが見つかりません');
 const rows=sectionParts(a,scope,section.id),index=rows.findIndex(row=>row.part.id===id);if(index<0)throw Error('配置したパーツが見つかりません');
 const next=rows[index+delta];return next?next.index+(delta>0?1:0):null;
}
