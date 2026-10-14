import {readFile,readdir,writeFile,mkdir,lstat} from 'node:fs/promises';
import {deflateRawSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),plugin=path.join(root,'plugins/damnpdfs');
const manifest=JSON.parse(await readFile(path.join(plugin,'.codex-plugin/plugin.json'),'utf8'));
const table=Array.from({length:256},(_,i)=>{let c=i;for(let b=0;b<8;b++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32=bytes=>{let c=0xffffffff;for(const byte of bytes)c=table[(c^byte)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
const entries=[];
async function collect(directory){for(const name of (await readdir(directory)).sort()){const file=path.join(directory,name),info=await lstat(file);if(info.isSymbolicLink())throw Error('Symlinks cannot be packaged.');if(info.isDirectory())await collect(file);else entries.push({name:path.relative(plugin,file).replaceAll('\\','/'),bytes:await readFile(file)});}}
await collect(plugin);
const local=[],central=[];let offset=0;
for(const entry of entries){
  const name=Buffer.from(entry.name),bytes=deflateRawSync(entry.bytes,{level:9}),crc=crc32(entry.bytes),header=Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(0x5821,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(entry.bytes.length,22);header.writeUInt16LE(name.length,26);
  local.push(header,name,bytes);const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(8,10);record.writeUInt16LE(0x5821,14);record.writeUInt32LE(crc,16);record.writeUInt32LE(bytes.length,20);record.writeUInt32LE(entry.bytes.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(offset,42);central.push(record,name);offset+=header.length+name.length+bytes.length;
}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
await mkdir(path.join(root,'dist'),{recursive:true});const output=path.join(root,'dist',`damnpdfs-${manifest.version}.zip`),archive=Buffer.concat([...local,directory,end]);await writeFile(output,archive);
console.log(JSON.stringify({output,files:entries.length,bytes:archive.length}));
