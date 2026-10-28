// Reusable examples are opt-in copies: existing CODEX_HOME configurations stay intact.
export const instructionPresets = [
  {id:'plan',name:'実装の進め方',content:'変更の目的と既存の実装を確認し、必要な範囲で実装してください。大きな変更は手順を整理してから進めてください。'},
  {id:'verify',name:'変更後の検証',content:'変更に適したテスト・ビルド・動作確認を行ってください。実行した検証と、確認できなかった点を報告してください。'},
  {id:'review',name:'コードレビュー',content:'不具合、回帰、セキュリティ上の問題を優先して確認してください。指摘には具体的な根拠と該当箇所を添えてください。'},
  {id:'japanese',name:'日本語で報告',content:'ユーザーには日本語で簡潔に説明してください。結果、変更の理由、検証結果が伝わるようにしてください。'},
  {id:'changes',name:'既存の変更を尊重',content:'作業前に既存の変更を確認し、ユーザーが行った変更を保持してください。依頼と関係のない変更は避けてください。'},
];

export function placePart(state, roleId, kind, id, index) {
  if (!['instruction','skill'].includes(kind)) throw Error('この種類のパーツは組み込めません');
  const role = state.roles.find(r => r.id === roleId);
  const library = kind === 'instruction' ? state.instructionParts : state.skills;
  if (!role || !library.some(p => p.id === id)) throw Error('ロールまたはパーツが見つかりません');
  const key = kind === 'instruction' ? 'instructionIds' : 'skillIds';
  const ids = role[key];
  if (!Number.isInteger(index) || index < 0 || index > ids.length) throw Error('挿入位置が不正です');
  const old = ids.indexOf(id);
  if (old >= 0) ids.splice(old, 1);
  ids.splice(old >= 0 && old < index ? index - 1 : index, 0, id);
}

export function copyPreset(state, presetId) {
  const preset = instructionPresets.find(p => p.id === presetId);
  if (!preset) throw Error('指示の例が見つかりません');
  let id = 'example-' + preset.id, suffix = 1;
  while (state.instructionParts.some(p => p.id === id)) id = 'example-' + preset.id + '-' + suffix++;
  const part = {...preset, id};
  state.instructionParts.push(part);
  return part;
}
