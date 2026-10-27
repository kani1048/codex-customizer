import {build} from 'esbuild';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
await mkdir('dist/runtime',{recursive:true});
await build({entryPoints:{hook:'node_modules/exec-policy/src/hook.mjs','worker-node':'node_modules/exec-policy/src/worker-node.mjs'},bundle:true,format:'esm',platform:'node',outdir:'dist/runtime',outExtension:{'.js':'.mjs'},banner:{js:'import { createRequire as _createRequire } from "node:module"; const require = _createRequire(import.meta.url);'}});
await build({entryPoints:{app:'web/app.mjs',worker:'web/worker.mjs'},bundle:true,format:'esm',platform:'browser',outdir:'dist',minify:true,define:{global:'globalThis','process.env.NODE_ENV':'"production"','process.env.NODE_NEV':'"production"'},plugins:[{name:'unused-cli-builtins',setup(b){b.onResolve({filter:/^(fs|path)$/},a=>({path:a.path,namespace:'cli-only'}));b.onLoad({filter:/.*/,namespace:'cli-only'},()=>({contents:'module.exports = new Proxy({}, { get() { throw new Error("CLI filesystem API unavailable in browser"); } });'}));}}]});
for(const f of ['index.html','style.css'])await copyFile('web/'+f,'dist/'+f);
