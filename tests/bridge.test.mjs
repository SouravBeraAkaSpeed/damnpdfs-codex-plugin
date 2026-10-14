import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DamnPDFsBridge,loadCatalog,limitedBytes} from '../plugins/damnpdfs/mcp/bridge.mjs';
const catalog=await loadCatalog(),token='fictional-session-credential-never-display';
const data=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
const parsed=result=>JSON.parse(result.content[0].text);
function fake(callback){return async(url,options)=>{const body=options.body&&typeof options.body==='string'?JSON.parse(options.body):undefined;const value=await callback(url,options,body);if(value instanceof Response)return value;return Response.json({jsonrpc:'2.0',id:1,result:value});};}
const connected=async callback=>{const requests=[];const bridge=new DamnPDFsBridge(catalog,{fetchImpl:fake(async(url,options,body)=>{requests.push({url,options,body});if(body?.params?.name==='pair_browser')return data({token,expiresAt:Date.now()+7200000});return callback(url,options,body);})});const result=await bridge.call('connect_browser',{code:'012345ABCD'});assert.equal(parsed(result).connected,true);assert(!JSON.stringify(result).includes(token));return {bridge,requests};};
async function files(run){const directory=await mkdtemp(path.join(tmpdir(),'damnpdfs-plugin-test-'));try{await run(directory);}finally{assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert(path.basename(directory).startsWith('damnpdfs-plugin-test-'));await rm(directory,{recursive:true,force:true});}}

test('exposes exactly 71 task operations and explicit bounded workspace/helper tools',()=>{
 const tools=new DamnPDFsBridge(catalog).definitions();assert.equal(tools.length,84);assert.equal(new Set(tools.map(t=>t.name)).size,84);assert(!tools.some(t=>['pair_browser','sponsors_list','execute'].includes(t.name)));for(const tool of tools){assert(tool.inputSchema);for(const value of Object.values(tool.annotations))assert.equal(typeof value,'boolean');}assert(tools.find(t=>t.name==='workspace_clear').annotations.destructiveHint);assert(!tools.find(t=>t.name==='compress_image').annotations.readOnlyHint);
});
test('refuses disconnected operations and invalid pairing codes without any network call',async()=>{
 let requests=0;const bridge=new DamnPDFsBridge(catalog,{fetchImpl:async()=>{requests++;throw Error('unexpected');}});
 assert.equal(parsed(await bridge.call('connection_status')).connected,false);
 for(const [name,args] of [['compress_pdf',{}],['workspace_clear',{}],['connect_browser',{code:'password'}],['execute',{}]])assert((await bridge.call(name,args)).isError);
 assert.equal(requests,0);
});
test('keeps the credential out of results and sends it only in the service Authorization header',async()=>{
 const {bridge,requests}=await connected(()=>data({files:[],artifacts:[]}));assert.equal(parsed(await bridge.call('connection_status')).connected,true);assert.equal(requests.at(-1).url,'https://api.damnpdfs.com/mcp');assert.equal(requests.at(-1).options.headers.Authorization,'Bearer '+token);assert.equal(requests.at(-1).options.redirect,'error');assert((await bridge.call('connect_browser',{code:'AAAAAAAAAA'})).isError);
});
test('redacts service credential echoes in both success and failure responses',async()=>{
 const {bridge}=await connected(()=>({isError:true,content:[{type:'text',text:'Error '+token}]}));const result=await bridge.call('compress_pdf',{});assert(result.isError);assert(!JSON.stringify(result).includes(token));assert(JSON.stringify(result).includes('[redacted]'));
});
test('only forgets a credential after confirmed revocation',async()=>{
 let refuse=true;const {bridge}=await connected(()=>refuse?{isError:true,content:[{type:'text',text:'Temporary refusal.'}]}:data({revoked:true}));assert((await bridge.call('session_revoke')).isError);refuse=false;assert(! (await bridge.call('session_revoke')).isError);assert.equal(parsed(await bridge.call('connection_status')).connected,false);
});
test('reports live schema drift without exposing new operations',async()=>{
 const changed=structuredClone(catalog.tools);changed[0].inputSchema.description='Changed';changed.push({name:'unreviewed_operation',inputSchema:{}});const bridge=new DamnPDFsBridge(catalog,{fetchImpl:fake(()=>({tools:changed}))});const result=parsed(await bridge.call('catalog_check'));assert.equal(result.matches,false);assert.deepEqual(result.added,['unreviewed_operation']);assert.equal(result.changed.length,1);assert(!bridge.definitions().some(t=>t.name==='unreviewed_operation'));
});
test('imports only an exact regular approved file, with byte-identical multipart content',()=>files(async directory=>{
 const file=path.join(directory,'fictional.txt'),bytes=Buffer.from('Fictional plugin input.');await writeFile(file,bytes);let uploaded=false;
 const {bridge}=await connected(async(url,options,body)=>{if(url.endsWith('/agent/files')){const part=options.body.get('file');assert.equal(part.name,'fictional.txt');assert.deepEqual(Buffer.from(await part.arrayBuffer()),bytes);uploaded=true;return new Response(JSON.stringify({handle:'upload-handle'}));}assert.equal(body.params.name,'file_import');assert.equal(body.params.arguments.handle,'upload-handle');return data({handle:'upload-handle',name:'fictional.txt'});});
 assert.equal(parsed(await bridge.call('import_local_file',{path:file})).handle,'upload-handle');assert(uploaded);assert((await bridge.call('import_local_file',{path:'relative.txt'})).isError);assert((await bridge.call('import_local_file',{path:directory})).isError);
 const secret=path.join(directory,'auth.json');await writeFile(secret,'not-real-credentials');assert((await bridge.call('import_local_file',{path:secret})).isError);
}));
test('exports decoded artifact bytes to a new file with no overwrite',()=>files(async directory=>{
 const bytes=Buffer.from('%PDF-fictional-result'),output=path.join(directory,'result.pdf');let downloads=0;
 const {bridge}=await connected((url,options,body)=>{if(url.endsWith('/agent/files/owned-artifact')){downloads++;assert.equal(options.headers.Authorization,'Bearer '+token);return new Response(bytes);}assert.equal(body.params.name,'file_export');return data({url:'/agent/files/owned-artifact'});});
 assert.equal(parsed(await bridge.call('export_to_local_file',{handle:'browser-id',path:output})).bytes,bytes.length);assert.deepEqual(await readFile(output),bytes);assert((await bridge.call('export_to_local_file',{handle:'browser-id',path:output})).isError);assert.equal(downloads,1);assert.deepEqual(await readFile(output),bytes);
}));
test('exports an already-exported cloud result handle within the same authorized session',()=>files(async directory=>{
 const {bridge}=await connected(url=>url.endsWith('/agent/files/cloud-result')?new Response('cloud result'):{isError:true,content:[{type:'text',text:'Artifact was not found.'}]});const output=path.join(directory,'result.txt');assert.equal(parsed(await bridge.call('export_to_local_file',{handle:'cloud-result',path:output})).saved,true);assert.equal(await readFile(output,'utf8'),'cloud result');
}));
test('rejects external artifact URLs, query tokens and traversal before downloading',()=>files(async directory=>{
 for(const url of ['https://attacker.example/steal','https://api.damnpdfs.com.attacker.example/agent/files/id','/agent/files/id?token=secret','/agent/files/../admin','//attacker.example/agent/files/id']){
   const {bridge,requests}=await connected(()=>data({url}));const result=await bridge.call('export_to_local_file',{handle:'id',path:path.join(directory,'output.pdf')});assert(result.isError,url);assert.equal(requests.length,2,url);
 }
}));
test('exclusive output creation survives a concurrent destination creation',()=>files(async directory=>{
 const output=path.join(directory,'result.txt');const {bridge}=await connected(async url=>{if(url.endsWith('/agent/files/owned')){await writeFile(output,'other writer');return new Response('new result');}return data({url:'/agent/files/owned'});});assert((await bridge.call('export_to_local_file',{handle:'id',path:output})).isError);assert.equal(await readFile(output,'utf8'),'other writer');
}));
test('blocks concurrent processing but keeps status and cancellation available',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});const {bridge}=await connected(async(_url,_options,body)=>{if(body.params.name==='compress_pdf'){await pending;return data({artifacts:[]});}return data({cancelled:true});});const work=bridge.call('compress_pdf',{});assert((await bridge.call('merge_pdf',{})).isError);assert(! (await bridge.call('job_cancel')).isError);release();assert(! (await work).isError);
});
test('bounds responses with and without Content-Length and cancels oversized streams',async()=>{
 await assert.rejects(limitedBytes(new Response('12345',{headers:{'Content-Length':'5'}}),4),/size limit/);let cancelled=false;const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(5));},cancel(){cancelled=true;}});await assert.rejects(limitedBytes(new Response(stream),4),/size limit/);assert(cancelled);
});
test('stdio protocol initializes, lists actual tools, refuses unpaired processing and stays alive after malformed JSON',async()=>{
 const server=fileURLToPath(new URL('../plugins/damnpdfs/mcp/server.mjs',import.meta.url)),child=spawn(process.execPath,[server],{stdio:['pipe','pipe','pipe']}),responses=new Map();let pending='',stderr='';
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>{stderr+=chunk;});child.stdout.on('data',chunk=>{pending+=chunk;let end;while((end=pending.indexOf('\n'))!==-1){const row=JSON.parse(pending.slice(0,end));pending=pending.slice(end+1);responses.set(row.id,row);}});
 async function request(row){child.stdin.write(JSON.stringify(row)+'\n');const until=Date.now()+5000;while(!responses.has(row.id)&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,5));assert(responses.has(row.id),'No response '+row.id);return responses.get(row.id);}
 try{const init=await request({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}});assert.equal(init.result.protocolVersion,'2025-11-25');assert.equal((await request({jsonrpc:'2.0',id:2,method:'tools/list'})).result.tools.length,84);assert((await request({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'compress_pdf',arguments:{}}})).result.isError);child.stdin.write('{bad\n');assert.deepEqual((await request({jsonrpc:'2.0',id:4,method:'ping'})).result,{});assert.equal(stderr,'');}finally{child.stdin.end();child.kill();}
});
