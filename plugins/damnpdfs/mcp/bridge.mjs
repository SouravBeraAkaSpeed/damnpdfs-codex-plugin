import {readFile, stat, open} from 'node:fs/promises';
import path from 'node:path';

export const API_ORIGIN = 'https://api.damnpdfs.com';
export const MAX_INPUT = 100 * 1024 * 1024;
export const MAX_OUTPUT = 300 * 1024 * 1024;
const JSON_LIMIT = 24 * 1024 * 1024;
const text = value => ({content:[{type:'text',text:JSON.stringify(value)}]});
const failure = message => ({isError:true,content:[{type:'text',text:message}]});
const readonly = new Set(['workspace_inspect','document_inspect','job_status']);
const destructive = new Set(['workspace_clear','session_revoke','job_cancel']);
const openworld = new Set(['p2p_share','collab_whiteboard','chat_with_pdf','summarize_pdf','translate_pdf','ai_pdf_assistant']);
const schema = (properties={},required=[]) => ({type:'object',properties,required,additionalProperties:false});
const string = description => ({type:'string',minLength:1,description});
const annotation = (readOnlyHint,destructiveHint=false,openWorldHint=false) => ({readOnlyHint,destructiveHint,openWorldHint});
const helperTools = [
  {name:'connect_browser',description:'Connect only the user-approved DamnPDFs browser workspace using its single-use five-minute Agent access code. Keeps the resulting session credential in process memory, never in tool output. Requires that tab to stay open. Does not upload any documents.',inputSchema:schema({code:{type:'string',pattern:'^[A-Fa-f0-9]{10}$',description:'Single-use code created in DamnPDFs Agent access, not an account password or API key.'}},['code']),annotations:annotation(false)},
  {name:'connection_status',description:'Check whether the approved browser workspace responds and return file/result counts. Does not expose the pairing credential or modify documents.',inputSchema:schema(),annotations:annotation(true)},
  {name:'catalog_check',description:'Compare the packaged tool names and schemas with the public DamnPDFs catalog, without pairing or uploading documents. Reports drift; does not install or execute new tools.',inputSchema:schema(),annotations:annotation(true)},
  {name:'import_local_file',description:'Read one exact user-approved absolute file path and upload its bytes to DamnPDFs temporary cloud storage, then import the handle into the connected browser workspace. Up to 100 MB. Never use to search for files, read credentials or import an unrelated file.',inputSchema:schema({path:string('Absolute path of the exact file selected or approved by the user.')},['path']),annotations:annotation(false)},
  {name:'export_to_local_file',description:'Download one artifact from the connected DamnPDFs workspace to an exact user-approved absolute path. Refuses overwriting an existing path and does not create directories. Up to 300 MB. Only downloads authenticated DamnPDFs artifact URLs.',inputSchema:schema({handle:string('Actual result/file handle returned by this workspace.'),path:string('New absolute destination file path approved by the user; parent directory must exist.')},['handle','path']),annotations:annotation(false)},
];

export async function limitedBytes(response,limit){
  const length=response.headers.get('content-length');
  if(length!==null&&Number(length)>limit)throw Error('Response exceeds the supported size limit.');
  if(!response.body)return Buffer.alloc(0);
  const reader=response.body.getReader(),chunks=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit)throw Error('Response exceeds the supported size limit.');chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  return Buffer.concat(chunks,total);
}

export class DamnPDFsBridge {
  #token='';#initialExpiresAt;#fetch;#api;#snapshot;#busy=false;
  constructor(snapshot,{fetchImpl=fetch,apiOrigin=API_ORIGIN}={}){
    this.#snapshot=snapshot;
    this.#fetch=fetchImpl;
    this.#api=apiOrigin;
    if(!Array.isArray(snapshot?.tools)||!snapshot.tools.length)throw Error('The packaged tool catalog is missing.');
    const names=new Set();for(const tool of snapshot.tools){if(!/^[a-z][a-z0-9_]+$/.test(tool.name)||names.has(tool.name)||!tool.inputSchema||['pair_browser','sponsors_list'].includes(tool.name))throw Error('The packaged tool catalog is invalid.');names.add(tool.name);}
    for(const tool of helperTools)if(names.has(tool.name))throw Error('Duplicate helper tool.');
  }
  definitions(){return [
    ...helperTools,
    ...this.#snapshot.tools.map(tool=>({...tool,annotations:annotation(readonly.has(tool.name),destructive.has(tool.name),openworld.has(tool.name)),description:tool.description+' Operates only in the connected DamnPDFs browser workspace. Use actual workspace handles; original files remain unchanged unless this is an explicit workspace cleanup action.'})),
  ];}
  #safe(message){let result=String(message);if(this.#token)result=result.replaceAll(this.#token,'[redacted]');return result;}
  async #request(route,options={},limit=JSON_LIMIT){
    if(!route.startsWith('/')||route.startsWith('//'))throw Error('Invalid service path.');
    const timeout=AbortSignal.timeout(615000),signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
    const response=await this.#fetch(this.#api+route,{...options,redirect:'error',signal});
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error(`DamnPDFs request failed (HTTP ${response.status}). Check the connection or retry later.`);}
    const bytes=await limitedBytes(response,limit);
    return {response,bytes};
  }
  async #rpc(name,args={},signal,publicRequest=false){
    const {bytes}=await this.#request('/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(!publicRequest&&this.#token?{Authorization:`Bearer ${this.#token}`}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}),signal});
    const response=JSON.parse(bytes.toString('utf8'));
    if(response.error)throw Error(response.error.message||'DamnPDFs protocol error.');
    if(!response.result||!Array.isArray(response.result.content))throw Error('Invalid DamnPDFs tool response.');
    return response.result;
  }
  #data(result){
    if(result.isError)throw Error(result.content.find(part=>part.type==='text')?.text||'The tool could not complete.');
    const part=result.content.find(part=>part.type==='text');if(!part)throw Error('Missing DamnPDFs tool data.');return JSON.parse(part.text);
  }
  async catalogCheck(signal){
    const {bytes}=await this.#request('/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}}),signal});
    const list=JSON.parse(bytes.toString('utf8')).result?.tools;if(!Array.isArray(list))throw Error('Invalid live catalog.');
    const live=new Map(list.filter(t=>!['pair_browser','sponsors_list'].includes(t.name)).map(t=>[t.name,t]));
    const missing=[],changed=[];for(const tool of this.#snapshot.tools){const current=live.get(tool.name);if(!current)missing.push(tool.name);else if(JSON.stringify(current.inputSchema)!==JSON.stringify(tool.inputSchema))changed.push(tool.name);live.delete(tool.name);}
    return {matches:!missing.length&&!changed.length&&!live.size,packagedCommands:this.#snapshot.tools.length,missing,changed,added:[...live.keys()],checkedAt:new Date().toISOString()};
  }
  async call(name,args={},signal){
    if(!args||typeof args!=='object'||Array.isArray(args))return failure('Supply a JSON object of arguments.');
    if(!this.definitions().some(tool=>tool.name===name))return failure('Unknown DamnPDFs tool.');
    if(this.#busy&&!['connection_status','catalog_check','workspace_inspect','job_status','job_cancel','session_revoke'].includes(name))return failure('Another workspace operation is active. Inspect job_status or cancel it before starting a new operation.');
    const exclusive=!['connection_status','catalog_check','workspace_inspect','job_status','job_cancel','session_revoke'].includes(name);
    if(exclusive)this.#busy=true;
    try{
      if(name==='catalog_check')return text(await this.catalogCheck(signal));
      if(name==='connect_browser'){
        if(this.#token)throw Error('A workspace is already paired. Revoke that session deliberately before connecting another workspace.');
        if(typeof args.code!=='string'||!/^[a-fA-F0-9]{10}$/.test(args.code))throw Error('Use the ten-character single-use code from DamnPDFs Agent access.');
        const result=this.#data(await this.#rpc('pair_browser',{code:args.code.toUpperCase()},signal,true));
        if(typeof result.token!=='string'||result.token.length<20||!Number.isFinite(result.expiresAt))throw Error('Invalid pairing response.');
        this.#token=result.token;this.#initialExpiresAt=result.expiresAt;
        return text({connected:true,initialExpiresAt:result.expiresAt,browserTabRequired:true,autoRenewal:'Controlled by the connected browser tab; does not extend document retention.'});
      }
      if(name==='connection_status'){
        if(!this.#token)return text({connected:false,website:'https://damnpdfs.com/',nextStep:'Open Agent access in an approved browser workspace and call connect_browser with its single-use code.'});
        const result=await this.#rpc('workspace_inspect',{},signal);
        if(result.isError)return text({connected:false,message:this.#safe(result.content.find(x=>x.type==='text')?.text||'Browser unavailable.'),credentialRetained:true,nextStep:'Reopen the paired tab. If the session expired or was revoked, revoke/forget this connection and create a new pairing.'});
        const data=this.#data(result);return text({connected:true,fileCount:data.files?.length||0,resultCount:data.artifacts?.length||0,initialExpiresAt:this.#initialExpiresAt,browserTabRequired:true});
      }
      if(!this.#token)throw Error('Connect an approved DamnPDFs browser workspace first with connect_browser.');
      if(name==='import_local_file'){
        if(typeof args.path!=='string'||!path.isAbsolute(args.path))throw Error('Supply an absolute path to the exact approved input file.');
        const info=await stat(args.path);if(!info.isFile()||info.size>MAX_INPUT)throw Error('Choose a regular file up to 100 MB.');
        const forbidden=/^(?:\.env(?:\..*)?|auth\.json|credentials(?:\.json)?|id_(?:rsa|ed25519)|config\.toml)$/i;
        if(forbidden.test(path.basename(args.path)))throw Error('This helper does not import credential or environment files.');
        const bytes=await readFile(args.path);if(bytes.length>MAX_INPUT)throw Error('Choose a regular file up to 100 MB.');
        const form=new FormData();form.append('file',new Blob([bytes]),path.basename(args.path));
        const {bytes:response}=await this.#request('/agent/files',{method:'POST',headers:{Authorization:`Bearer ${this.#token}`},body:form,signal});
        const upload=JSON.parse(response.toString('utf8'));if(typeof upload.handle!=='string')throw Error('The upload did not return a file handle.');
        const imported=await this.#rpc('file_import',{handle:upload.handle},signal);return imported;
      }
      if(name==='export_to_local_file'){
        if(typeof args.path!=='string'||!path.isAbsolute(args.path)||typeof args.handle!=='string'||!args.handle)throw Error('Supply a workspace handle and an approved new absolute output path.');
        const forbidden=/^(?:\.env(?:\..*)?|auth\.json|credentials(?:\.json)?|id_(?:rsa|ed25519)|config\.toml)$/i;
        if(forbidden.test(path.basename(args.path)))throw Error('Choose a document destination, not an authentication/configuration path.');
        // Check before creating a temporary export or downloading; O_EXCL below
        // also prevents an overwrite if another process creates the path meanwhile.
        try{await stat(args.path);throw Error('The output path already exists. Choose a new filename.');}catch(error){if(error.code!=='ENOENT')throw error;}
        const result=await this.#rpc('file_export',{handle:args.handle},signal);
        let value;
        if(result.isError&&/Artifact was not found/i.test(result.content.find(part=>part.type==='text')?.text||'')){
          // Execution results may already be exported cloud handles, distinct
          // from browser artifact IDs. The authenticated download endpoint still
          // verifies workspace ownership; never fetch an arbitrary URL.
          if(!/^[a-zA-Z0-9-]+$/.test(args.handle))throw Error('Invalid artifact handle.');
          value='/agent/files/'+args.handle;
        }else{const exported=this.#data(result);value=exported.url||exported.downloadUrl;}
        if(typeof value!=='string')throw Error('No authenticated download URL was returned.');
        const url=new URL(value,this.#api);if(url.origin!==this.#api||!/^\/agent\/files\/[a-zA-Z0-9-]+$/.test(url.pathname)||url.search||url.hash||url.username||url.password)throw Error('The service returned an unexpected artifact URL.');
        const {bytes}=await this.#request(url.pathname,{headers:{Authorization:`Bearer ${this.#token}`},signal},MAX_OUTPUT);
        const file=await open(args.path,'wx',0o600);try{await file.writeFile(bytes);}finally{await file.close();}
        return text({saved:true,path:args.path,bytes:bytes.length,handle:args.handle});
      }
      const result=await this.#rpc(name,args,signal);
      if(name==='session_revoke'&&!result.isError){this.#token='';this.#initialExpiresAt=undefined;}
      return JSON.parse(this.#safe(JSON.stringify(result)));
    }catch(error){return failure(this.#safe(error instanceof Error?error.message:'The operation failed.'));}
    finally{if(exclusive)this.#busy=false;}
  }
}

export async function loadCatalog(){return JSON.parse(await readFile(new URL('../assets/catalog.json',import.meta.url),'utf8'));}
