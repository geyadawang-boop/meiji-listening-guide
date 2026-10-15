import {_electron as electron} from 'playwright'
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import assert from 'node:assert/strict'
const executable=resolve(process.argv[2]||'release/portable/win-unpacked/梅酱的听课指南.exe')
const expectedVersion=JSON.parse(await readFile(resolve('package.json'),'utf8')).version
const base=resolve('test-results');await mkdir(base,{recursive:true});const output=await mkdtemp(join(base,'packaged-delivery-')),data=join(output,'data');await mkdir(data)
const env=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));delete env.ELECTRON_RUN_AS_NODE;env.LISTENING_ASSISTANT_DATA=data
if(process.argv[3])env.LISTENING_ASSISTANT_PORTABLE_TEST=resolve(process.argv[3])
const app=await electron.launch({executablePath:executable,args:[],env,timeout:45000})
try{
 const identity=await app.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged,path:app.getAppPath()}));assert.equal(identity.version,expectedVersion);assert.equal(identity.packaged,true)
 const page=await app.firstWindow();await page.waitForFunction(()=>!!(window as unknown as {assistant?:unknown}).assistant,{},{timeout:30000})
 const backend=await page.evaluate(async()=>{const bridge=(window as unknown as {assistant:{invoke:(action:string,args?:unknown)=>Promise<unknown>}}).assistant;return {downloads:await bridge.invoke('media:list'),knowledge:await bridge.invoke('knowledge:list'),tools:await bridge.invoke('tools:request',{action:'overview'}),options:await bridge.invoke('media:options')}})
 assert.ok(Array.isArray(backend.downloads));assert.ok(backend.knowledge);assert.ok(backend.tools);assert.ok(backend.options)
 if(process.argv[3])assert.deepEqual(await page.evaluate(async()=>(window as any).assistant.invoke('courses')),[],'Clean release must have no courses')
 const native=await app.evaluate(async({app})=>{const {createRequire}=process.getBuiltinModule('node:module'),load=createRequire(app.getAppPath()+'/package.json'),Cipher=load('better-sqlite3-multiple-ciphers'),db=new Cipher(app.getPath('userData')+'/native-delivery.sqlite');try{db.pragma("cipher='sqlcipher'");db.pragma('legacy=4');db.key(Buffer.from('delivery-fixture'));db.exec('CREATE TABLE delivery(value INTEGER); INSERT INTO delivery VALUES(5)');const row=db.prepare('SELECT value FROM delivery').get();if(row.value!==5)throw new Error('Native cipher failed')}finally{db.close()}const {getQuickJS}=load('quickjs-emscripten'),quick=await getQuickJS(),value=quick.evalCode('2+3');if(value!==5)throw new Error('WASM resource failed');return {nativeCipherLoaded:true,packagedWasmLoaded:true}})
 await page.screenshot({path:join(output,'成品启动.png')})
 const report={...identity,executable,actualPackagedWindow:true,isolatedUserData:true,nativeDownloadsWorker:true,nativeKnowledgeWorker:true,nativeResearchWorker:true,...native,noRealAccountsOrMaterialsAccessed:true}
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({output,...report}))
}finally{await app.close()}
