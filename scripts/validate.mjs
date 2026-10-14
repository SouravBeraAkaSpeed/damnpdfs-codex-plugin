import {readFile,readdir,stat,realpath} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {DamnPDFsBridge,loadCatalog} from '../plugins/damnpdfs/mcp/bridge.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),plugin=path.join(root,'plugins/damnpdfs');
const json=async name=>JSON.parse(await readFile(name,'utf8'));
const manifest=await json(path.join(plugin,'.codex-plugin/plugin.json'));
const marketplace=await json(path.join(root,'.agents/plugins/marketplace.json'));
assert.equal(manifest.name,'damnpdfs');assert.match(manifest.version,/^\d+\.\d+\.\d+$/);
const entry=marketplace.plugins.find(row=>row.name===manifest.name);assert(entry);assert.equal(path.resolve(root,entry.source.path),plugin);assert.equal(entry.policy.installation,'AVAILABLE');assert.equal(entry.policy.authentication,'ON_USE');
const ui=manifest.interface;
for(const field of ['displayName','shortDescription'])assert(ui[field]?.length&&ui[field].length<=30);
assert(ui.developerName);assert(ui.longDescription.length<=4000);assert(ui.capabilities.length>0);
for(const field of ['websiteURL','supportURL','privacyPolicyURL','termsOfServiceURL'])assert.equal(new URL(ui[field]).origin,'https://damnpdfs.com');
assert.equal(ui.defaultPrompt.length,3);for(const prompt of ui.defaultPrompt)assert(prompt.length<=128);
for(const field of ['logo','logoDark','composerIcon','composerIconDark']){
  const relative=ui[field];assert(relative.startsWith('./'));const file=await realpath(path.join(plugin,relative));assert(file.startsWith(plugin+path.sep));const bytes=await readFile(file);assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(bytes.readUInt32BE(16),bytes.readUInt32BE(20));assert(bytes.readUInt32BE(16)>=48);assert(bytes.length<5*1024*1024);
}
const mcp=await json(path.join(plugin,'.mcp.json'));assert.deepEqual(Object.keys(mcp.mcpServers),['damnpdfs']);assert.equal(mcp.mcpServers.damnpdfs.command,'node');assert.equal(mcp.mcpServers.damnpdfs.cwd,'.');assert.equal(mcp.mcpServers.damnpdfs.args[0],'./mcp/server.mjs');assert(!mcp.mcpServers.damnpdfs.env);
const catalog=await loadCatalog(),tools=new DamnPDFsBridge(catalog).definitions();assert.equal(catalog.tools.length,79);assert.equal(tools.length,84);assert.equal(new Set(tools.map(t=>t.name)).size,tools.length);
for(const tool of tools){assert(tool.description.trim());assert.equal(tool.inputSchema.type,'object');for(const key of ['readOnlyHint','destructiveHint','openWorldHint'])assert.equal(typeof tool.annotations[key],'boolean');}
const skill=await readFile(path.join(plugin,'skills/file-tools/SKILL.md'),'utf8');assert.match(skill,/^---\r?\nname: file-tools\r?\ndescription:/);assert(!skill.includes('[TODO'));for(const name of ['compress_pdf','edit_pdf_text','sign_pdf','word_to_pdf','pptx_to_pdf','compress_image','remove_background'])assert(tools.some(tool=>tool.name===name));
async function walk(directory){for(const name of await readdir(directory)){const file=path.join(directory,name),info=await stat(file);if(info.isDirectory())await walk(file);else{assert(!/^(?:\.env|auth\.json|credentials\.json|config\.toml)$/i.test(name));if(/\.(?:md|mjs|json|svg)$/.test(name)){const content=await readFile(file,'utf8');assert(!content.includes('D:\\personal_work'));assert(!content.includes('C:\\Users\\'));assert(!/-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/.test(content));assert(!content.includes('[TODO:'));}}}}
await walk(plugin);
console.log('Codex manifest, marketplace paths/policy, four square icons, skill, 71 task tools and 84 commands validate. No private paths, credentials or install hooks are packaged.');
