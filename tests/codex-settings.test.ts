import {test,expect,vi} from 'vitest'
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {join,resolve,sep} from 'node:path'
const mocks=vi.hoisted(()=>({decrypt:vi.fn(()=>{throw new Error('synthetic damaged API key')})}))
vi.mock('electron',()=>({app:{isPackaged:false,getAppPath:()=>process.cwd()},safeStorage:{decryptString:mocks.decrypt}}))
import {SettingsStore} from '../src/main/settings'
test('Codex model selection does not decrypt unrelated API keys',()=>{
 const base=resolve('tmp');mkdirSync(base,{recursive:true});const root=mkdtempSync(join(base,'codex-settings-'))
 try{
  writeFileSync(join(root,'settings.json'),JSON.stringify({profiles:[{id:'fixture',encryptedKey:'invalid-fixture'}],prompts:{},videoPolicyVersion:2,codex:{model:'fixture-model',effort:'low'}}))
  const settings=new SettingsStore(root);expect(settings.codexSelection()).toEqual({model:'fixture-model',effort:'low'});expect(mocks.decrypt).not.toHaveBeenCalled()
  expect(()=>settings.get()).toThrow('synthetic damaged API key')
 }finally{if(!resolve(root).startsWith(base+sep))throw new Error('Invalid test cleanup target');rmSync(root,{recursive:true,force:true})}
})
