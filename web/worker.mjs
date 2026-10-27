import {evaluate} from 'exec-policy/src/policy.mjs';
self.onmessage=({data})=>{try{self.postMessage(evaluate(data.command,data.policy));}catch(e){self.postMessage({decision:'deny',findings:[{message:e.message}],ast:null});}};
