# Codex Customizer

CODEX_HOME を作りやすくする Web UI。指示パーツ・スキル・ロール・設定・フックのカスタマイズはこのリポジトリで担い、runtime は生成済み CODEX_HOME を参照して Codex を起動します。接続点は Codex が読む設定ファイルだけです。agent-runtime 固有の環境名・配置パス・API・マニフェストの解釈を要求しません。

## 役割と依存方向

- **Customizer**: 設定・指示・スキル・ルール・フック・ポリシー・付属ファイルを共通のパーツとして管理し、CODEX_HOME 一式を組み立てる。
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
AGENTS.md                  # 共通指示＋ロールの指示パーツ（指定順）
skills/<id>/SKILL.md        # 共通＋ロールで選んだスキルと付属ファイル
agents/<name>.toml         # 共通＋ロールで選んだサブエージェントの定義
hooks/custom/              # UIで管理したフックの付属ファイル
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

認証、会話履歴、Docker 管理は扱いません。スキルは編集用コピーを構成JSONに保存し、選択したものを生成先の skills/ に出力します。個人スキルの正本は `/home/kani/.agents/skills` のままです。

## 実装

- `src/assembly.mjs`: 構成の検証と標準ファイル生成。
- `src/workbench.mjs`: 共通パーツの配置・移行・実効構成への組み立て。
- `web/`: 全種類で同じカード操作を使う作業台とシミュレーター。
- `scripts/build.mjs`: UI と依存込みフックのビルド。

公式仕様: [設定](https://learn.chatgpt.com/docs/config-file/config-basic)、[フック](https://learn.chatgpt.com/docs/hooks)、[許可ルール](https://learn.chatgpt.com/docs/agent-configuration/rules)。

## 共通の操作で部品を組み上げる

画面は「組み立てる」と「確認・出力する」の2つです。基本設定は項目ごとのプルダウンで選びます。ロールでは共通設定の継承と個別の上書きを選べます。モデルは登録済みのIDから選択するか、新しいIDを追加できます。ベース config.toml は詳細設定で編集します。指示、スキル、コマンドルール、フック、実行ポリシー、フックファイル、サブエージェントは、共通のパーツライブラリ・カード・編集ダイアログで扱います。

1. 「全ロール共通」、または作成したロールを組み立て先として選びます。
2. 中央の部品別セクション（基本設定・指示・スキル・サブエージェント・コマンド制御・フック）を開き、「使えるパーツ」から配置先へドラッグします。あらかじめ用意した部品も、自作・取り込み済みの部品も同じ一覧で編集・共有できます。名前やセクションで絞り込めます。閉じたセクションにも配置数・共通からの継承・部品名を表示します。
3. スタック内のカードをドラッグして並び替えます。共通・ロールの配置先ラベルに落とすと、その組み立て先の末尾に置けます。スタックから別の組み立て先へ動かすと配置を移し、ライブラリからは同じパーツを参照して配置します。ライブラリ内もドラッグで並び替えできます。
4. カードをダブルクリックして編集モーダルを開きます。モーダルには影響するロール名・IDと、直接配置／共通からの継承を一覧表示します。共通パーツは全ロールが対象です。保存までは元のパーツを変更せず、キャンセルできます。
5. スタックからライブラリへドラッグして戻すと、その組み立て先の割り当てだけを解除します。ほかのロールとパーツ本体は保持します。「ライブラリから削除」は共通・各ロールの参照も除去します。直前の配置は「元に戻す」で取り消せます。
6. 「＋ パーツ」で基本設定以外の8種類の部品を追加できます。各セクションの「＋ パーツを作る」から、その種類の部品を追加することもできます。スキルは SKILL.md を含むフォルダーの取り込みにも対応します。付属ファイルは UTF-8 テキストのみ対応し、画像・バイナリは未対応です。
7. 構成JSONにライブラリと全ロールを保存し、CODEX_HOME 一式を ZIP または CLI で出力します。構成JSONの上限は5MBです。
8. ZIPを新しいディレクトリへ展開し、runtime の CODEX_HOME として配置・マウントします。ホストで試す場合は `CODEX_HOME=/absolute/path/to/generated-codex codex` で起動できます。

右の全体概要には、共通／ロール固有の部品数、実効設定、組み込む部品と継承元、生成ファイルを表示します。セクション名から編集箇所へ、ファイル名から出力プレビューへ移動できます。セクション表示は保存済みの配置順を変更しません。

全ロール共通のパーツを先に組み込み、選択ロールのパーツを後に重ねます。同じIDのパーツは一度だけ出力します。基本設定は後のパーツの空でない項目が優先されます。ベース config.toml は最後に指定した内容を使用します。指示はスタック内の順で結合し、ルールやフックも同種の登録順に反映します。スタック全体が処理の実行順を表すわけではなく、フックの実行タイミングは各イベントに従います。

フックファイルは `hooks/custom/` に同梱されます。フックのコマンドは `node "${CODEX_HOME:-$HOME/.codex}/hooks/custom/complete.mjs"` のように指定し、インタープリター経由で起動します。モデル・承認・サンドボックスを指定する部品がない場合は、構成の既定値を使用します。

旧v1/v2の設定はWeb UIで部品へ読み替えます。共通指示の本文、モデル設定、ロールの割り当て、既存スキルの出力ディレクトリは維持します。移行は繰り返してもパーツを増やしません。runtime 自体や個人スキルの正本は変更しません。パスの逸脱、重複ID、壊れた参照、選択パーツ間のファイル衝突は出力前に拒否します。

## パーツ構成と CLI

`components` は `{id, type, name, data}` の一覧、`commonPartIds` は共通スタック、各ロールの `partIds` はロールのスタックです。`activeRole` が空なら共通だけを出力します。UIの移行済みJSONは `workbenchVersion: 1` を持ちます。CLIの `validate` / `plan` / `export` / `simulate` も同じ組み立てを使用します。

たとえばUIで保存したJSONは、`set --path components.0.data.model --value '"your-model-id"'`（先頭が基本設定パーツの場合）や、`set --path commonPartIds --value '["config-1","instruction-1"]'` で編集できます。旧形式のトップレベル設定も引き続き読み込めますが、同じ設定を持つ選択パーツがある場合はパーツの指定が優先されます。

キーボード操作では、カードをTabで選び、Enterで編集、ライブラリのカードをSpaceで現在の対象へ配置、スタック内でAlt＋上下キーで移動、Deleteでライブラリへ戻せます。通常のクリックは選択だけで、編集モーダルを開きません。


## サブエージェントを共有パーツとして使う

「＋ パーツ」→「サブエージェント」で作成するか、「すぐ使える例」のレビュー担当・調査担当を使います。パーツの表示名とは別に、Codex が呼び出す `agentName`（例: `reviewer`）、用途、専用指示、任意のモデル・推論の深さを編集できます。

同じパーツをライブラリから複数のロールへ配置すると、そのサブエージェントを共有できます。全ロール共通へ配置することもできます。ダブルクリックした編集モーダルには、影響するロールが一覧表示されます。パーツを編集すると共有先すべての次回出力へ反映されます。ライブラリからの配置は参照の追加、組み立て先からのドラッグはその配置の移動です。

選択したロールで使える定義だけを `agents/<agentName>.toml` に出力し、`config.toml` の `[agents.<agentName>]` に用途と相対 `config_file` を登録します。`agents.enabled` を有効にし、`AGENTS.md` に呼び出し名と用途の案内を追加します。同じパーツが共通・ロール双方にあっても定義は一度だけ出力します。異なる選択パーツやベース設定と呼び出し名が重複すると、上書きせず出力を拒否します。

モデルと推論の深さを空にすると親から継承します。サブエージェント固有のサンドボックス・承認方針・プロバイダー・MCP設定は出力しません。出力は定義と呼び出し案内で、UIから実際のエージェントは起動しません。runtime が起動する Codex のサブエージェント機能が定義を読み込みます。

実装は [公式の Subagents 仕様](https://learn.chatgpt.com/docs/agent-configuration/subagents) と [設定リファレンス](https://learn.chatgpt.com/docs/config-file/config-reference) に基づきます。

### サブエージェントが使うスキル

サブエージェントをダブルクリックし、編集モーダルで「使えるスキル」から「この担当に組み込み」へドラッグします。並び替え・一覧へ戻す操作にも対応し、保存またはキャンセルでまとめて確定・破棄します。

担当をロールへ配置すると、その担当のスキルも親の CODEX_HOME に含まれます。同じスキルは一度だけ出力し、最後の参照を外すと出力対象から外れます。スキルの編集モーダルには、直接使用するサブエージェントと、直接／担当経由で使用するロールをまとめて表示します。

出力する各 `agents/*.toml` では、生成するスキルのうち担当が選んだものだけを `skills.config` で有効にし、ほかの生成スキルと bundled skills を無効にします。パスはエージェント定義からの相対パスです。生成先の外でプロジェクトなどから追加されるスキルは、この一覧による管理の対象外です。

### 標準設定・MCP・サブエージェントの制御

基本設定は `on-request`・`never`・5項目の詳細承認条件に対応します。旧構成の `untrusted` は読込時に `on-request` に移行します。「引き継ぐ」を選んだ承認方針とサンドボックスは、ベースTOMLの値を保持します。推論の深さには `max`・`ultra` も選択できますが、使用可否はモデルとCodex側の対応によります。

MCP接続は共有パーツです。stdio/HTTP、引数、環境変数、環境変数経由のHTTPヘッダー・Bearerトークン、公開／除外ツール、タイムアウト、有効／必須設定を編集できます。共通やロールへドラッグして配置し、`config.toml` の `mcp_servers` へ出力します。サーバー名が異なるパーツ間で衝突する場合は出力を止めます。接続・インストール・OAuth認証は生成先のCodexで行います。

サブエージェントセクション上部の「全体の設定」では、有効／無効、同時稼働数、子の既定モデル・推論、中断通知を保存します。ロール側の空欄は共通・ベースを継承します。無効にしても定義ファイルは残り、出力時に強制的に有効化しません。担当の編集モーダルでは、回答の詳しさ、推論の要約、シェル・Apps・プラグイン・メモリ・権限要求ツールの無効化、スキル一覧指示の有無を設定できます。権限・プロバイダー・MCPの継承は従来どおりです。
