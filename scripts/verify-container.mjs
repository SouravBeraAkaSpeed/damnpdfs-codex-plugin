import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const child=spawn('docker',['run','--rm','-i','--network','none','--read-only','--cap-drop','ALL','damnpdfs-mcp-test'],{stdio:['pipe','pipe','inherit']});
const expected=new Map([[1,'initialize'],[2,'tools/list']]);
let buffer='',complete=false;
const timeout=setTimeout(()=>{console.error('Container did not complete its stdio handshake.');child.kill();process.exitCode=1;},20000);
child.on('error',error=>{clearTimeout(timeout);console.error(error.message);process.exitCode=1;});
child.stdout.setEncoding('utf8');
child.stdout.on('data',data=>{
 buffer+=data;
 while(buffer.includes('\n')){
  const index=buffer.indexOf('\n'),line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;
  try{
   const response=JSON.parse(line),method=expected.get(response.id);assert(method,'Unexpected protocol output');assert(!response.error,JSON.stringify(response.error));
   if(method==='initialize')assert(response.result.serverInfo.name);
   if(method==='tools/list'){const names=response.result.tools.map(tool=>tool.name);assert.equal(names.length,84);assert.equal(new Set(names).size,84);assert(names.includes('connect_browser')&&names.includes('compress_image'));}
   expected.delete(response.id);
   if(!expected.size){complete=true;child.stdin.end();}
  }catch(error){console.error(error.message);child.kill();process.exitCode=1;}
 }
});
child.on('exit',code=>{clearTimeout(timeout);if(code!==0||!complete){console.error(`Container exited before successful verification: ${code}`);process.exitCode=1;}else console.log('Non-root, network-disabled, read-only container starts and exposes 84 MCP commands.');});
for(const request of [
 {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'damnpdfs-container-check',version:'1.0.0'}}},
 {jsonrpc:'2.0',method:'notifications/initialized'},
 {jsonrpc:'2.0',id:2,method:'tools/list',params:{}},
])child.stdin.write(JSON.stringify(request)+'\n');
