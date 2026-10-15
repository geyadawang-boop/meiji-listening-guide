import {describe,it,expect} from 'vitest'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {contained,RuntimeComponents} from '../src/main/runtime-components'
import {backendRequest,checkProtocol} from '../src/shared/backend-protocol'
import {dispatch} from '../src/main/ipc/handler'
async function fixture(){const root=await mkdtemp(join(tmpdir(),'mei-components-')),resources=join(root,'resources'),source=join(root,'pack');await mkdir(resources);await mkdir(join(source,'payload'),{recursive:true});await writeFile(join(source,'payload','worker.py'),'fixture');await writeFile(join(source,'component.json'),JSON.stringify({id:'knowledge',productVersion:'0.1.82'}));await writeFile(join(resources,'runtime-manifest.json'),JSON.stringify({schema:1,productVersion:'0.1.82',components:[{id:'knowledge',label:'后台',directory:'knowledge',bytes:7,files:[{path:'worker.py',size:7,sha256:createHash('sha256').update('fixture').digest('hex')}]}]}));return {root,resources,source,manager:new RuntimeComponents(resources,'0.1.82')}}
describe('runtime installation integrity',()=>{
 it('publishes verified component and refuses overwrite',async()=>{const f=await fixture();try{expect((await f.manager.status()).components[0].installed).toBe(false);await f.manager.install('knowledge',f.source,new AbortController().signal,()=>{});expect(await readFile(join(f.resources,'knowledge','worker.py'),'utf8')).toBe('fixture');expect((await f.manager.status()).components[0].installed).toBe(true);await expect(f.manager.install('knowledge',f.source,new AbortController().signal,()=>{})).rejects.toThrow('已存在')}finally{await rm(f.root,{recursive:true,force:true})}})
 it('tampered input cannot publish or leave staging',async()=>{const f=await fixture();try{await writeFile(join(f.source,'payload','worker.py'),'changed');await expect(f.manager.install('knowledge',f.source,new AbortController().signal,()=>{})).rejects.toThrow('校验失败');expect(await readdir(f.resources)).toEqual(['runtime-manifest.json'])}finally{await rm(f.root,{recursive:true,force:true})}})
 it('wrong product version cannot install',async()=>{const f=await fixture();try{await writeFile(join(f.source,'component.json'),JSON.stringify({id:'knowledge',productVersion:'old'}));await expect(f.manager.install('knowledge',f.source,new AbortController().signal,()=>{})).rejects.toThrow('版本一致')}finally{await rm(f.root,{recursive:true,force:true})}})
 it('cancellation cleans unpublished component',async()=>{const f=await fixture();try{const c=new AbortController();c.abort();await expect(f.manager.install('knowledge',f.source,c.signal,()=>{})).rejects.toThrow();expect(await readdir(f.resources)).toEqual(['runtime-manifest.json'])}finally{await rm(f.root,{recursive:true,force:true})}})
 it('rejects escape paths',()=>{for(const path of ['../outside','a/../../outside','C:/outside','a\\outside','/outside'])expect(()=>contained('D:/inside',path)).toThrow()})
})
describe('dispatch and protocol',()=>{
 it('unknown operations do not reach another domain',async()=>{let calls=0;await expect(dispatch([{actions:new Set(['known']),async invoke(){calls++;return true}}],'unknown',{})).rejects.toThrow('未知');expect(calls).toBe(0)})
 it('preserves handler failures and data',async()=>{const handler={actions:new Set(['known']),async invoke(_action:string,args:Record<string,unknown>){if(args.fail)throw Error('fixture failure');return args}};expect(await dispatch([handler],'known',{value:1})).toEqual({value:1});await expect(dispatch([handler],'known',{fail:true})).rejects.toThrow('fixture failure')})
 it('versions request and refuses incompatible response',()=>{expect(backendRequest(1,'list',{})).toEqual({protocol:1,id:1,action:'list',args:{}});expect(()=>checkProtocol({protocol:2})).toThrow('不兼容');expect(()=>checkProtocol({protocol:1})).not.toThrow()})
})
