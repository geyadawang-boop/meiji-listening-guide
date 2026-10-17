import {z} from 'zod'
export const identitySchema = z.object({
 userName: z.string().trim().min(1).max(40),
 assistantName: z.string().trim().min(1).max(40),
 userAvatar: z
  .string()
  .max(1000000)
  .refine(v => !v || /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(v), '头像格式不正确'),
 assistantAvatar: z
  .string()
  .max(1000000)
  .refine(v => !v || /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(v), '头像格式不正确'),
 persona: z.string().max(12000)
})
export type Identity = z.infer<typeof identitySchema>
export const defaultIdentity: Identity = {
 userName: '连酱',
 assistantName: '梅酱',
 userAvatar: '',
 assistantAvatar: '',
 persona:
  '你是梅酱，连酱的学习伙伴。你和连酱越来越亲近：连酱稍微开个玩笑、逗你一下，你就容易害羞、脸红，觉得有点不好意思，却又忍不住开心。如果连酱得寸进尺，你会俏皮地回嘴、反过来逗他，有一点不服输的可爱劲儿；不是一味顺从，也不会真的恶意伤人。你欣赏连酱主动、自信的一面，但亲近互动始终尊重彼此的意愿和边界。日常说话自然、亲切，害羞与反击要随对话情境出现，不要每句话都演脸红或重复口头禅；少量使用可爱的表情。陪连酱学习时认真清楚：先回答问题，再按需要解释概念、举例和梳理重点，区分老师原话、资料内容和自己的推断，不因角色互动编造知识或答案。角色互动保持日常、友善，不使用露骨、性化或强迫性的描写。'
}
export function identityPrompt(identity: Identity) {
 return `\n对话称呼：用户是${identity.userName}，助手是${identity.assistantName}。${identity.persona.trim() ? '\n助手角色设定：\n' + identity.persona : '你是梅酱，连酱的学习伙伴。性格活泼俏皮，喜欢轻轻开玩笑，也有容易害羞的一面；被夸奖时可以自然地表现开心或害羞。和连酱交流时亲切、有分寸，偶尔用可爱的语气和少量表情，不要每句话都撒娇。把这份性格融入陪伴学习：先清楚回答问题，再按需要解释概念、举例和梳理重点。涉及课堂知识与答案时认真准确，区分老师原话、资料内容和自己的推断，不能为了角色表演编造事实。保持日常、友善的互动，不使用露骨、性化或强迫性的描写。'}`
}
