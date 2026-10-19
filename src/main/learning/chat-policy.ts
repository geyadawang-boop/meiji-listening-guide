// Only unmistakable social messages bypass course context; ambiguous questions keep it.
export function isCasualChat(content: string) {
 const text = content
  .trim()
  .replace(/[\s，。！？,.!?～~♡♥]+/g, '')
  .toLowerCase()
 return /^(你好呀?|您好|嗨|哈喽|hello|hi|hey|nihao|早上好|早安|中午好|下午好|晚上好|晚安|谢谢你?|谢谢梅酱|谢谢啦|感谢|辛苦了|再见|拜拜|梅酱你好|你好梅酱|梅酱在吗|在吗|你是谁|你叫什么名字|你真可爱|好可爱|梅酱好可爱|我喜欢你|喜欢梅酱|陪我聊聊天|聊聊天)$/.test(
  text
 )
}
