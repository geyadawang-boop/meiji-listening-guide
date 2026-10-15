import {describe,it,expect} from 'vitest'
import {isCasualChat} from '../src/main/chat-policy'
describe('日常聊天快速路径',()=>{
 it('问候及明确日常互动不用课程资料',()=>{for(const text of ['你好','NIHAO','你好呀！','谢谢梅酱','你是谁','梅酱好可爱'])expect(isCasualChat(text)).toBe(true)})
 it('知识问题和含问候的课程请求仍携带资料',()=>{for(const text of ['你好，解释牙釉质','这张图说了什么','总结重点','谢谢，刚才那题答案是什么','你好 PPT','翻译 hello','这个呢'])expect(isCasualChat(text)).toBe(false)})
})
