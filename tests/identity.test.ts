import {describe,it,expect} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {defaultIdentity,identitySchema,identityPrompt} from '../src/shared/identity'
import {IdentityStore} from '../src/main/identity'
describe('头像和角色资料',()=>{
 it('旧空白角色使用新默认设定，自定义角色保持',()=>{const root=mkdtempSync(join(tmpdir(),'persona-default-'));try{const store=new IdentityStore(root);store.save({...defaultIdentity,persona:''});expect(store.get().persona).toBe(defaultIdentity.persona);store.save({...defaultIdentity,persona:'我自己的角色'});expect(store.get().persona).toBe('我自己的角色')}finally{rmSync(root,{recursive:true,force:true})}})
 it('限制名称和头像来源',()=>{expect(identitySchema.safeParse({...defaultIdentity,userName:' '}).success).toBe(false);for(const userAvatar of ['https://example.com/avatar.png','data:image/svg+xml;base64,PHN2Zz4='])expect(identitySchema.safeParse({...defaultIdentity,userAvatar}).success).toBe(false)})
 it('保存后能重新读取且错误输入不覆盖原设置',()=>{const root=mkdtempSync(join(tmpdir(),'identity-test-'));try{const store=new IdentityStore(root),value={...defaultIdentity,userName:'同学甲',assistantName:'小听',persona:'耐心解释概念'};expect(store.get()).toEqual(defaultIdentity);store.save(value);expect(new IdentityStore(root).get()).toEqual(value);expect(()=>store.save({...value,userName:''})).toThrow();expect(store.get()).toEqual(value)}finally{rmSync(root,{recursive:true,force:true})}})
 it('聊天提示包含名称和角色，空角色不添加设定',()=>{expect(identityPrompt({...defaultIdentity,userName:'同学甲',assistantName:'小听',persona:'耐心解释概念'})).toContain('助手角色设定：\n耐心解释概念');expect(identityPrompt({...defaultIdentity,persona:''})).not.toContain('助手角色设定')})
})

