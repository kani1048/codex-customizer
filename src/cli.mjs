import {readFile,writeFile,mkdir,lstat,rename,rm,mkdtemp} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';
import {zipSync,strToU8} from 'fflate';
import {defaults,validate,compile} from './assembly.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const help=`codex-customizer — Codex 標準設定セットを操作する CLI

使い方: codex-customizer <COMMAND> [OPTIONS]

init      [--output FILE]                         初期構成を作成（既定: stdout）
show      --input FILE|-                          正規化した構成を表示
validate  --input FILE|-                          構成を検証
set       --input FILE|- --path KEY --value JSON   設定値を変更（既定: stdout）
          [--output NEW_FILE | --in-place]         ファイルへ保存
plan      --input FILE|-                          出力ファイル一覧・注意点
export    --input FILE|- (--directory NEW_DIR | --zip NEW_FILE)
                                                 Codex 標準形式を出力
simulate  --input FILE|- --command TEXT [--ast]    追加ポリシーで判定（実行しない）

ヘルプ: codex-customizer <COMMAND> --help（-h も使用可）
        codex-customizer help <COMMAND>

JSON: 構成は Web UI と共通。show/set/init の stdout は構成 JSON。
その他は {ok,...}。エラーは stderr に JSON。
終了: 0=成功/拒否条件なし、1=入出力エラー、2=引数/設定エラー、3=ポリシー拒否。
ファイルは既定で上書きしない。set --in-place のみ入力ファイルを更新。
export は新規出力先専用。CODEX_HOME への自動適用はしない。
`;
class UsageError extends Error{}
const specs={init:['output'],show:['input'],validate:['input'],set:['input','path','value','output','in-place'],plan:['input'],export:['input','directory','zip'],simulate:['input','command','ast']};
const commandHelp={
 init: {
  usage:'init [--output NEW_FILE]',
  summary:'Web UI と共通の初期構成 JSON を作成します。',
  options:[['--output NEW_FILE','新規ファイルに保存。省略時は構成 JSON を stdout に出力。既存ファイルは上書きしません。']],
  examples:['codex-customizer init','codex-customizer init --output customizer.json'],
  notes:'このコマンドは入力ファイル・ビルド済みフックを必要としません。',
 },
 show: {
  usage:'show --input FILE|-',
  summary:'構成を検証・正規化して JSON を stdout に表示します。旧 v1 は v2 に読み替えます。',
  options:[['--input FILE|-','必須。100KB 以下の構成 JSON。- は標準入力。']],
  examples:['codex-customizer show --input customizer.json','codex-customizer init | codex-customizer show --input -'],
  notes:'入力ファイルは変更しません。生成用ファイルを出力するコマンドは export です。',
 },
 validate: {
  usage:'validate --input FILE|-',
  summary:'構成スキーマと設定ファイルの生成処理を検証します。結果と注意点を JSON で返します。',
  options:[['--input FILE|-','必須。100KB 以下の構成 JSON。- は標準入力。']],
  examples:['codex-customizer validate --input customizer.json'],
  notes:'実行ポリシーを含む場合は npm run build が必要です。適用先の Codex のバージョンやモデルの可用性までは検証しません。',
 },
 set: {
  usage:'set --input FILE|- --path KEY --value JSON [--output NEW_FILE | --in-place]',
  summary:'指定した設定値を変更し、構成全体を再検証します。既定では変更後の JSON を stdout に出力します。',
  options:[['--input FILE|-','必須。100KB 以下の構成 JSON。- は標準入力。'],['--path KEY','必須。既存の設定パス。例: model / policy.rules.delegate / hooks.0.command。rules や hooks 全体の配列も置換可能。'],['--value JSON','必須。JSON 値。文字列は JSON の二重引用符で囲み、shell 側でも引用してください。'],['--output NEW_FILE','変更後の構成を新規ファイルに保存。既存ファイルは上書きしません。'],['--in-place','入力の通常ファイルをアトミックに置換。--output や標準入力と併用できません。']],
  examples:[`codex-customizer set --input customizer.json --path model --value '"your-model-id"' --in-place`,'codex-customizer set --input customizer.json --path policy.rules.delegate --value false --output updated.json',`codex-customizer set --input customizer.json --path rules --value '[{"pattern":["git","push"],"decision":"prompt","reason":"確認"}]'`],
  notes:'version・未知の設定パスは変更できません。検証に失敗した場合は保存しません。',
 },
 plan: {
  usage:'plan --input FILE|-',
  summary:'生成するファイルの名前・サイズ・要件・注意点を JSON で表示します。ファイルの内容は含めません。',
  options:[['--input FILE|-','必須。100KB 以下の構成 JSON。- は標準入力。']],
  examples:['codex-customizer plan --input customizer.json'],
  notes:'ファイルは書き込みません。実行ポリシーを含む場合は npm run build が必要です。',
 },
 export: {
  usage:'export --input FILE|- (--directory NEW_DIR | --zip NEW_FILE)',
  summary:'Codex 標準の設定セットを、新規ディレクトリまたは ZIP に出力します。結果は JSON で返します。',
  options:[['--input FILE|-','必須。100KB 以下の構成 JSON。- は標準入力。'],['--directory NEW_DIR','新規ディレクトリへ出力。既存ディレクトリは使用できません。親ディレクトリは事前に用意してください。'],['--zip NEW_FILE','新規 ZIP ファイルへ出力。既存ファイルは上書きしません。']],
  examples:['codex-customizer export --input customizer.json --directory ./generated-codex','codex-customizer export --input customizer.json --zip ./codex-settings.zip'],
  notes:'--directory と --zip はどちらか1つが必須です。実行ポリシーを含む場合は npm run build が必要です。CODEX_HOME への自動適用は行いません。',
 },
 simulate: {
  usage:'simulate --input FILE|- --command TEXT [--ast]',
  summary:'入力コマンドを追加の実行ポリシーで判定します。コマンド本体は実行しません。',
  options:[['--input FILE|-','必須。100KB 以下の構成 JSON。- は標準入力。'],['--command TEXT','必須。判定する shell コマンド。shell に展開・実行させないよう引数全体を引用してください。'],['--ast','解析した構文木を結果の JSON に追加。省略時は判定と理由だけを返します。']],
  examples:[`codex-customizer simulate --input customizer.json --command 'echo ok; python3 -c "print(1)"'`,`codex-customizer simulate --input customizer.json --command 'git status && git diff' --ast`],
  notes:'追加フックが有効な場合は npm run build が必要です。拒否は終了コード3。無効時は not-applied と終了コード0。判定通過は Codex の標準ルール・承認・サンドボックスの許可を意味しません。',
 },
};
function detailedHelp(cmd){
 if(!Object.hasOwn(commandHelp,cmd))throw new UsageError('未知のコマンド: '+cmd+'。--help で一覧を確認してください');
 const h=commandHelp[cmd];
 return `codex-customizer ${cmd}\n\n${h.summary}\n\n使い方:\n  codex-customizer ${h.usage}\n\nオプション:\n${h.options.map(([flag,description])=>'  '+flag+'\n    '+description).join('\n')}\n  --help, -h\n    このヘルプを表示して終了（構成の読込・変更は行いません）。\n\n使用例:\n${h.examples.map(e=>'  '+e).join('\n')}\n\n${h.notes}\n\n終了コード: 0=成功、1=入出力エラー、2=引数/設定エラー、3=ポリシー拒否。\n`;
}
function helpText(argv){
 if(!argv.length)return help;
 if(['--help','-h'].includes(argv[0])){if(argv.length!==1)throw new UsageError('コマンド別のヘルプは <COMMAND> --help または help <COMMAND> を使ってください');return help;}
 if(argv[0]==='help'){if(argv.length>2)throw new UsageError('使い方: codex-customizer help [COMMAND]');return argv[1]?detailedHelp(argv[1]):help;}
 if(argv.slice(1).some(a=>['--help','-h'].includes(a)))return detailedHelp(argv[0]);
 return null;
}
function options(argv){const [cmd,...rest]=argv;if(!Object.hasOwn(specs,cmd))throw new UsageError('未知のコマンドです。--help を参照してください');const out={};for(let i=0;i<rest.length;i++){const flag=rest[i];if(!flag.startsWith('--')||!specs[cmd].includes(flag.slice(2)))throw new UsageError('不明なオプション: '+flag);const k=flag.slice(2);if(Object.hasOwn(out,k))throw new UsageError('重複したオプション: '+flag);if(['in-place','ast'].includes(k))out[k]=true;else{if(i+1>=rest.length||rest[i+1].startsWith('--'))throw new UsageError(flag+' の値が必要です');out[k]=rest[++i];}}return {cmd,opts:out};}
const json=x=>JSON.stringify(x,null,2)+'\n';
async function readConfig(path,stdin){if(!path)throw new UsageError('--input が必要です（標準入力は -）');let raw;if(path==='-'){if(stdin.isTTY)throw new UsageError('標準入力に構成 JSON を渡してください');raw='';stdin.setEncoding?.('utf8');for await(const chunk of stdin){raw+=chunk.toString();if(Buffer.byteLength(raw)>100000)throw new UsageError('構成 JSON は100KB以下にしてください');}}else{const stat=await lstat(path);if(!stat.isFile()||stat.size>100000)throw new UsageError('入力は100KB以下の通常ファイルにしてください');raw=await readFile(path,'utf8');}try{return validate(JSON.parse(raw));}catch(e){throw new UsageError(e.message);}}
function setValue(a,path,value){if(!path)throw new UsageError('--path が必要です');const parts=path.split('.');if(parts.some(p=>!p||['__proto__','prototype','constructor','version'].includes(p)))throw new UsageError('変更できないパスです');let cursor=a;for(const p of parts.slice(0,-1)){if(!cursor||typeof cursor!=='object'||!Object.hasOwn(cursor,p))throw new UsageError('存在しない設定パス: '+path);cursor=cursor[p];}const last=parts.at(-1);if(!cursor||typeof cursor!=='object'||!Object.hasOwn(cursor,last)||last==='length')throw new UsageError('存在しない設定パス: '+path);cursor[last]=value;try{return validate(a);}catch(e){throw new UsageError(e.message);}}
async function runtimeFiles(config){if(!config.policyEnabled)return {};const out={};for(const f of ['hook.mjs','worker-node.mjs']){try{out[f]=await readFile(join(root,'dist/runtime',f),'utf8');}catch(e){if(e.code==='ENOENT')throw new UsageError('実行用フックがありません。npm run build を先に実行してください');throw e;}}return out;}
async function assemble(a){try{return compile(a,await runtimeFiles(a));}catch(e){if(e instanceof UsageError)throw e;throw new UsageError(e.message);}}
async function saveNew(path,data){await writeFile(path,data,{flag:'wx',mode:0o600});}
async function replaceInput(path,data){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw new UsageError('--in-place は通常ファイルだけ更新できます');const folder=await mkdtemp(join(dirname(resolve(path)),'.codex-customizer-'));try{const staged=join(folder,'config.json');await writeFile(staged,data,{mode:stat.mode&0o777});await rename(staged,path);}finally{await rm(folder,{recursive:true,force:true});}}
async function exportDirectory(directory,files){const dest=resolve(directory);await mkdir(dest,{mode:0o700});try{for(const [p,s]of Object.entries(files)){const target=join(dest,p);await mkdir(dirname(target),{recursive:true,mode:0o700});await saveNew(target,s);}return dest;}catch(e){await rm(dest,{recursive:true,force:true});throw e;}}
async function simulate(a,command,ast){if(command===undefined)throw new UsageError('--command が必要です');if(!a.policyEnabled)return {decision:'not-applied',findings:[],note:'追加フックは無効です。Codex の標準判定は別途適用されます。'};const workerPath=join(root,'dist/runtime/worker-node.mjs');try{await lstat(workerPath);}catch(e){if(e.code==='ENOENT')throw new UsageError('npm run build を先に実行してください');throw e;}
 return new Promise((resolveResult)=>{const w=new Worker(workerPath,{workerData:{command,policy:a.policy},resourceLimits:{maxOldGenerationSizeMb:64}});let done=false;const finish=r=>{if(done)return;done=true;clearTimeout(timer);w.terminate();if(!ast)delete r.ast;resolveResult(r);};const timer=setTimeout(()=>finish({decision:'deny',findings:[{rule:'timeout',message:'解析が3秒を超えたため拒否'}]}),3000);w.once('message',finish);w.once('error',e=>finish({decision:'deny',findings:[{rule:'error',message:e.message}]}));w.once('exit',()=>{if(!done)finish({decision:'deny',findings:[{rule:'error',message:'解析結果を得られないまま終了しました'}]});});});}
export async function run(argv,{stdin=process.stdin,stdout=process.stdout,stderr=process.stderr}={}){
 try{
  const requestedHelp=helpText(argv);
  if(requestedHelp!==null){stdout.write(requestedHelp);return 0;}
  const {cmd,opts:o}=options(argv);
  if(cmd==='init'){const a=structuredClone(defaults);if(o.output){await saveNew(o.output,json(a));stdout.write(json({ok:true,output:resolve(o.output)}));}else stdout.write(json(a));return 0;}
  if(cmd==='set'&&o['in-place']&&(o.output||o.input==='-'))throw new UsageError('--in-place はファイル入力だけに使えます。--output との併用はできません');
  if(cmd==='export'&&Boolean(o.directory)===Boolean(o.zip))throw new UsageError('--directory または --zip を1つ指定してください');
  const a=await readConfig(o.input,stdin);
  if(cmd==='show'){stdout.write(json(a));return 0;}
  if(cmd==='validate'){const out=await assemble(a);stdout.write(json({ok:true,version:a.version,setId:a.setId,warnings:out.warnings}));return 0;}
  if(cmd==='set'){let v;try{if(o.value===undefined)throw Error('missing');v=JSON.parse(o.value);}catch{throw new UsageError('--value に JSON 値を指定してください（文字列は引用符で囲む）');}const updated=setValue(a,o.path,v);if(o['in-place']){await replaceInput(o.input,json(updated));stdout.write(json({ok:true,output:resolve(o.input)}));}else if(o.output){await saveNew(o.output,json(updated));stdout.write(json({ok:true,output:resolve(o.output)}));}else stdout.write(json(updated));return 0;}
  if(cmd==='simulate'){const result=await simulate(a,o.command,o.ast);stdout.write(json({ok:true,...result}));return result.decision==='deny'?3:0;}
  const out=await assemble(a);
  if(cmd==='plan'){stdout.write(json({ok:true,...out.manifest,files:Object.entries(out.files).map(([path,s])=>({path,bytes:Buffer.byteLength(s)}))}));return 0;}
  if(cmd==='export'){let output;if(o.directory)output=await exportDirectory(o.directory,out.files);else{await saveNew(o.zip,zipSync(Object.fromEntries(Object.entries(out.files).map(([p,s])=>[p,strToU8(s)]))));output=resolve(o.zip);}stdout.write(json({ok:true,output,files:Object.keys(out.files),warnings:out.warnings}));return 0;}
 }catch(e){const code=e instanceof UsageError?2:1;stderr.write(json({ok:false,error:{code:code===2?'INVALID_INPUT':e.code||'IO_ERROR',message:e.message}}));return code;}
}
