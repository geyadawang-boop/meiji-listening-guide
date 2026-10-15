import {describe,it,expect} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {AppearanceStore} from '../src/main/appearance'
import {defaultAppearance,resolveAppearance,appearanceSchema} from '../src/shared/appearance'
import {IdentityStore} from '../src/main/identity'
import {defaultIdentity} from '../src/shared/identity'
const id='fe20e744-9a8e-4408-80aa-d3a789197768'
describe('聊天外观独立设置',()=>{
 it('课程独立配置不受全局更新影响，清除后恢复继承且重启保持',()=>{const root=mkdtempSync(join(tmpdir(),'appearance-'));try{const s=new AppearanceStore(root);s.save({...defaultAppearance,fontSize:18});s.save({...defaultAppearance,fontSize:22},id);s.save({...defaultAppearance,fontSize:16});expect(resolveAppearance(new AppearanceStore(root).get(),id).fontSize).toBe(22);s.clear(id);expect(resolveAppearance(s.get(),id).fontSize).toBe(16)}finally{rmSync(root,{recursive:true,force:true})}})
 it('拒绝越界数值和外部图片URL，失败不覆盖原配置',()=>{expect(appearanceSchema.safeParse({...defaultAppearance,image:'https://example.com/img.jpg'}).success).toBe(false);const root=mkdtempSync(join(tmpdir(),'appearance-'));try{const s=new AppearanceStore(root);s.save(defaultAppearance);expect(()=>s.save({...defaultAppearance,opacity:2})).toThrow();expect(s.get().global).toEqual(defaultAppearance)}finally{rmSync(root,{recursive:true,force:true})}})
 it('旧默认名字变为连酱，自定义名字保持',()=>{const root=mkdtempSync(join(tmpdir(),'lian-'));try{const s=new IdentityStore(root);expect(s.get().userName).toBe('连酱');s.save({...defaultIdentity,userName:'你'});expect(s.get().userName).toBe('连酱');s.save({...defaultIdentity,userName:'自定义称呼'});expect(s.get().userName).toBe('自定义称呼')}finally{rmSync(root,{recursive:true,force:true})}})
})
