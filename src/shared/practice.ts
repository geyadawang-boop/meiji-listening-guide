export function questionOptions(stem: string) {
 const matches = [...stem.matchAll(/(?:^|\n)\s*([A-H])[.、．)）:：]\s*([^]*?)(?=\n\s*[A-H][.、．)）:：]|$)/g)]
 const options = matches.map(m => ({key: m[1], text: m[2].trim()}))
 return options.length >= 2 && new Set(options.map(o => o.key)).size === options.length ? options : []
}
export function answerChoices(answer: string, allowed: string[]) {
 const match = /^(?:参考答案|正确答案|答案)?\s*[:：]?\s*([A-H](?:[、,，\s]*[A-H])*)(?=[.。\s、，,:：]|$)/.exec(
  answer.trim()
 )
 const keys = match?.[1].match(/[A-H]/g) || []
 return keys.length && keys.every(k => allowed.includes(k)) ? [...new Set(keys)].sort() : []
}
export function compareChoices(response: string, correct: string[]) {
 if (!/^[A-H](?:[,，、\s]*[A-H])*$/.test(response.trim())) return false
 return [...new Set(response.match(/[A-H]/g) || [])].sort().join('') === [...new Set(correct)].sort().join('')
}
