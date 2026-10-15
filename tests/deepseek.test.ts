import { describe,it,expect } from 'vitest'
import { deepseekCatalog,validateDeepSeek } from '../src/main/deepseek'
const profile={id:'test',name:'DeepSeek',model:'deepseek-flash',baseUrl:'https://api.deepseek.com/v1',key:'test-key'}
describe('DeepSeek connection',()=>{
  it('normalizes the official endpoint and rejects credential redirection',()=>{
    expect(validateDeepSeek(profile).baseUrl).toBe('https://api.deepseek.com')
    for(const baseUrl of ['http://api.deepseek.com','https://example.com','https://api.deepseek.com/?secret=1','https://user:password@api.deepseek.com','https://api.deepseek.com/responses'])expect(()=>validateDeepSeek({...profile,baseUrl})).toThrow()
  })
  it('rejects missing credentials, retired models and unsupported efforts',()=>{
    expect(()=>validateDeepSeek({...profile,key:''})).toThrow(/Key/)
    expect(()=>validateDeepSeek({...profile,model:'deepseek-chat'})).toThrow(/请选择/)
    expect(()=>validateDeepSeek({...profile,parameters:{'deepseek-flash':{reasoningEffort:'medium'}}})).toThrow(/推理/)
  })
  it('declares image support only on Flash and contains no credentials',()=>{
    const catalog=deepseekCatalog()
    expect(catalog.models[0].input_modalities).toContain('image')
    expect(catalog.models[1].input_modalities).not.toContain('image')
    expect(JSON.stringify(catalog)).not.toContain(profile.key)
  })
})
