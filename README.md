# Codex Customizer

Codex 標準形式の設定セットを組み立てる独立した Web UI。接続点は Codex が読む設定ファイルだけです。agent-runtime 固有の環境名・配置パス・API・マニフェストの解釈を要求しません。

## 役割と依存方向

- **Customizer**: 部品を編集し、Codex 標準ファイルとフックの実行用ファイルを出力する。
- **Codex**: 標準ファイルを読み込み、設定・指示・ルール・フックを適用する。
- **runtime**: CODEX_HOME を用意して Codex を起動する。Customizer の JSON や内部形式を読まない。

`Customizer → Codex 標準形式 ← Codex（runtime が起動）` が境界です。Customizer と runtime は互いを呼び出さず、ソース依存もありません。既存 agent-runtime の CODEX_HOME のマウントも、そのまま利用できます。

## 起動

Node.js 18 以上。ビルド時は隣に exec-policy を置いてください（実行ポリシーエンジンの依存）。

```sh
npm ci
npm run build
npm test
npm start
```

http://127.0.0.1:8135 で開きます。入力はブラウザー内で処理し、保存は localStorage。構成 JSON の読込・保存、設定 ZIP の出力に対応します。設定 JSON は Customizer の再編集専用で、Codex/runtime には渡しません。旧 v1 の環境名は v2 のセットIDに読み替え、配置先としては使いません。

## エージェント向け CLI

Web UI と同じ検証・生成エンジンを使います。ローカルでは次のように起動できます。`npm run cli -- <command>` も使用可能です。`package.json` の bin 名は `codex-customizer` です（グローバルインストールは変更していません）。

```sh
node bin/codex-customizer.mjs --help
node bin/codex-customizer.mjs export --help
node bin/codex-customizer.mjs init --output customizer.json
node bin/codex-customizer.mjs validate --input customizer.json
node bin/codex-customizer.mjs set --input customizer.json --path model --value '"your-model-id"' --in-place
node bin/codex-customizer.mjs set --input customizer.json --path policy.rules.delegate --value false --in-place
node bin/codex-customizer.mjs plan --input customizer.json
node bin/codex-customizer.mjs simulate --input customizer.json --command 'echo ok; python3 -c "print(1)"'
node bin/codex-customizer.mjs export --input customizer.json --directory ./generated-codex
node bin/codex-customizer.mjs export --input customizer.json --zip ./codex-settings.zip
```

`init`・`show`・`set` は出力先を省略すると構成 JSON を stdout に出します。その他は `{ok,...}`、エラーは stderr に JSON を返します。`--input -` で標準入力を使えます。配列（rules/hooks）も `set --path rules --value '[...]'` で更新できます。設定パスは既存フィールドのみで、不正な変更は保存前に拒否します。

`--help` / `-h` はコマンド一覧、`<command> --help` / `<command> -h` / `help <command>` は各コマンドの使い方・全オプション・使用例・終了コードを表示します。構成ファイルの読込や変更は行いません。

終了コード: `0` 成功・追加拒否条件なし、`1` 入出力エラー、`2` 引数・構成エラー、`3` シミュレーションで拒否。`simulate` はコマンドを実行しません。ポリシー無効時は `not-applied`。標準の承認・サンドボックスを許可する意味ではありません。AST は `--ast` で追加します。

ファイル出力は既定で上書きせず、`set --in-place` のみ入力した構成 JSON をアトミックに置換します。`export --directory` は新規ディレクトリ専用で、既存 CODEX_HOME の更新・設定の自動適用はしません。CLI で編集した JSON を Web UI に取り込め、その逆も同じ形式で使えます。エクスポートされた標準ファイルに CLI 専用のメタデータは含みません。

## 出力の契約

ZIP のルートは選んだ CODEX_HOME の直下に対応します。

```text
config.toml                # Codex 標準設定（フックは inline hooks）
AGENTS.md                  # 共通指示（入力時のみ）
rules/customizer.rules     # prefix_rule（設定時のみ）
hooks/exec-policy/         # 任意フックの実行ファイルとポリシー
  hook.mjs
  worker-node.mjs
  policy.json
APPLY.txt                  # 人向けの配置案内。Codex は使用しない
```

Customizer 専用のマニフェストや構成 JSON は ZIP に含めません。`compile()` の返す manifest は UI 内の出力情報にすぎず、適用側では不要です。

生成するフックコマンドは `${CODEX_HOME:-$HOME/.codex}` を実行時に参照します。配置先に空白があっても動作し、コンテナ内の固定パスを埋め込みません。追加ポリシーには Node.js 18 以上と POSIX shell が必要です。ネイティブ Windows 用のフック起動コマンドは未対応です。

ホストの CLI なら通常は `~/.codex/`、独自 CODEX_HOME ならその場所に統合します。コンテナでは、同じファイルセットをコンテナの CODEX_HOME に配置/マウントします。agent-runtime を使うことは条件ではありません。独自フックやベース設定に手で書いた絶対パスは移動先で確認してください。

## 組み立てるもの

- 基本設定: セットID（出力名のみ）、モデル ID、推論の深さ、sandbox_mode、approval_policy。
- 指示: CODEX_HOME の AGENTS.md。
- 許可ルール: 引数配列から prefix_rule を生成。
- フック: 既存ベースの inline hooks を保持して追加。信頼レビューは適用先の Codex で別途必要。
- 実行ポリシー: exec-policy v2 の4部品とシミュレーター。実行ファイルは依存込みで出力。

自動適用は行いません。既存ファイルとの差分を確認して統合してください。ベース config.toml の未知の設定は保持しますがコメントは再シリアライズで失われます。既存 hooks.json、他のルール、管理者設定も適用先では有効です。モデル・推論の組み合わせは適用先で確認してください。

認証、会話履歴、Docker 管理、スキル作成/コピー/インストールは扱いません。個人スキルの正本は `/home/kani/.agents/skills` のままです。

## 実装

- `src/assembly.mjs`: 構成の検証と標準ファイル生成。
- `web/`: 組み立て UI とシミュレーター。
- `scripts/build.mjs`: UI と依存込みフックのビルド。

公式仕様: [設定](https://learn.chatgpt.com/docs/config-file/config-basic)、[フック](https://learn.chatgpt.com/docs/hooks)、[許可ルール](https://learn.chatgpt.com/docs/agent-configuration/rules)。
