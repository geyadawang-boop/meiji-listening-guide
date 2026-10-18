import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {NativeResearchStore} from '@main/research/research-store'
const op = z.string().regex(/^[a-f0-9]{32}$/),
 name = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const text = (max: number) =>
 z
  .string()
  .max(max)
  .refine(value => !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value), '学习方法包含无效字符')
const plugins = [
 {id: 'library', name: '资料库阅读与管理', description: '阅读原生知识库中的版本与引用原文。', channels: ['library']},
 {
  id: 'papers',
  name: '论文检索与阅读',
  description: '按明确选定渠道检索题录、摘要和全文。',
  channels: ['arxiv', 'crossref', 'semantic', 'arxiv_fulltext']
 },
 {id: 'web', name: '网页搜索与阅读', description: '后台搜索公开网页并保留范围回执。', channels: ['web', 'web_pages']},
 {id: 'memory', name: '学习记忆', description: '仅召回用户保存且可用的记忆。', channels: ['memory']},
 {id: 'notes', name: '笔记检索', description: '检索用户明确保存的笔记。', channels: ['notes']},
 {
  id: 'conversations',
  name: '历史问答',
  description: '读取选定知识会话，历史回答不作为原文。',
  channels: ['conversations']
 },
 {id: 'practice', name: '练习题查找', description: '检索题干，不读取答案或成绩。', channels: ['practice']},
 {id: 'organize', name: '分类建议', description: '准备分类草稿，由用户确认保存。', channels: ['organize']}
]
const resources = z
 .array(
  z.object({
   path: z
    .string()
    .min(1)
    .max(200)
    .refine(
     value =>
      !/[\\:\x00]/.test(value) &&
      !value.startsWith('/') &&
      value.split('/').every(part => part && part !== '.' && part !== '..'),
     '方法资料路径无效'
    ),
   content: text(6000).min(1)
  })
 )
 .max(12)
 .refine(
  rows =>
   new Set(rows.map(row => row.path.toLowerCase())).size === rows.length &&
   rows.reduce((sum, row) => sum + row.content.length, 0) <= 24000,
  '方法资料重复或过长'
 )
const skill = z.object({
 id: op,
 name,
 description: text(500).min(1),
 body: text(6000).min(1),
 enabled: z.boolean(),
 resources: resources.optional()
})
type Skill = z.infer<typeof skill>
type Catalog = {
 revision: number
 skills: Skill[]
 standing_instructions: {enabled: boolean; body: string}
 disabled_plugins: string[]
}
export type ExtensionSnapshot = {revision: number; skills: Skill[]; instructions: string; channels: string[]}
export class NativeResearchExtensions {
 constructor(private store: NativeResearchStore) {}
 private catalog(): Catalog {
  const row = this.store.db.prepare('SELECT 1 FROM research_records WHERE kind=? AND id=?').get('extensions', 'catalog')
  if (row) return this.store.read('extensions', 'catalog')
  const prior = this.store.list<{content_json: string; revision: number}>('legacy:learning_agent_extensions')
  if (prior.length === 1) {
   const parsed = z
    .object({
     skills: z.array(skill).max(50).default([]),
     standing_instructions: z.object({enabled: z.boolean(), body: text(4000)}).default({enabled: false, body: ''}),
     disabled_plugins: z.array(z.string()).default([])
    })
    .parse(JSON.parse(prior[0].content_json))
   if (
    parsed.disabled_plugins.some(id => !plugins.some(plugin => plugin.id === id)) ||
    new Set(parsed.skills.map(row => row.id)).size !== parsed.skills.length ||
    new Set(parsed.skills.map(row => row.name)).size !== parsed.skills.length ||
    (parsed.standing_instructions.enabled && !parsed.standing_instructions.body.trim())
   )
    throw new Error('旧学习方法清单内容无效，原始快照保留')
   const catalog = {...parsed, revision: z.number().int().nonnegative().parse(prior[0].revision)}
   this.store.put('extensions', 'catalog', catalog.revision, catalog)
   return catalog
  }
  if (prior.length > 1) throw new Error('旧学习方法包含多个资料身份，需明确选择后迁入，未猜测当前版本')
  return {revision: 0, skills: [], standing_instructions: {enabled: false, body: ''}, disabled_plugins: []}
 }
 list() {
  const value = this.catalog()
  return {
   revision: value.revision,
   skills: value.skills,
   standing_instructions: value.standing_instructions,
   plugins: plugins.map(plugin => ({...plugin, enabled: !value.disabled_plugins.includes(plugin.id)}))
  }
 }
 change(input: unknown) {
  const value = z
   .object({
    op,
    revision: z.number().int().nonnegative(),
    change: z.discriminatedUnion('kind', [
     z.object({kind: z.literal('plugin'), id: z.string(), enabled: z.boolean()}),
     z.object({kind: z.literal('instructions'), enabled: z.boolean(), body: text(4000)}),
     z.object({
      kind: z.literal('skill'),
      id: op.nullable(),
      name,
      description: text(500).min(1),
      body: text(6000).min(1),
      enabled: z.boolean(),
      resources: resources.optional()
     }),
     z.object({kind: z.literal('remove'), id: op})
    ])
   })
   .parse(input)
  return this.store.operation(value.op, value, () => {
   const current = this.catalog()
   if (current.revision !== value.revision) throw new Error('学习方法版本已改变，请刷新')
   const edit = value.change,
    next = structuredClone(current)
   if (edit.kind === 'instructions') {
    if (edit.enabled && !edit.body.trim()) throw new Error('启用的固定要求不能为空')
    next.standing_instructions = {enabled: edit.enabled, body: edit.body.trim()}
   }
   if (edit.kind === 'plugin') {
    if (!plugins.some(plugin => plugin.id === edit.id)) throw new Error('未知工具组')
    next.disabled_plugins = edit.enabled
     ? current.disabled_plugins.filter(id => id !== edit.id)
     : [...new Set([...current.disabled_plugins, edit.id])]
   }
   if (edit.kind === 'remove') {
    if (!current.skills.some(s => s.id === edit.id)) throw new Error('学习方法不存在')
    next.skills = current.skills.filter(s => s.id !== edit.id)
   }
   if (edit.kind === 'skill') {
    const id = edit.id || randomUUID().replaceAll('-', '')
    if (edit.id && !current.skills.some(s => s.id === id)) throw new Error('学习方法不存在')
    if (current.skills.some(s => s.name === edit.name && s.id !== id)) throw new Error('学习方法名称已存在')
    if (!edit.id && current.skills.length >= 50) throw new Error('最多保存50个学习方法')
    const previous = current.skills.find(row => row.id === id),
     nextSkill = skill.parse({
      ...edit,
      id,
      ...(edit.resources === undefined && previous?.resources ? {resources: previous.resources} : {})
     })
    next.skills = [...current.skills.filter(s => s.id !== id), nextSkill]
   }
   next.revision++
   this.store.put('extensions', 'catalog', next.revision, next)
   return this.list()
  })
 }
 snapshot(selection: {revision: number; ids: string[]} | undefined, channels: string[]): ExtensionSnapshot {
  const current = this.catalog()
  if (selection && selection.revision !== current.revision) throw new Error('学习方法已改变，请重新选择')
  if (selection && new Set(selection.ids).size !== selection.ids.length) throw new Error('所选学习方法重复')
  const skills = (selection?.ids || []).map(id => {
   const selected = current.skills.find(s => s.id === id && s.enabled)
   if (!selected) throw new Error('所选学习方法已停用或删除')
   return selected
  })
  if (
   skills.length > 5 ||
   skills.reduce(
    (sum, skill) => sum + skill.body.length + (skill.resources || []).reduce((sum, row) => sum + row.content.length, 0),
    0
   ) > 36000
  )
   throw new Error('本轮最多选择5个方法，含附属资料合计不超过36000字')
  for (const channel of channels) {
   const group = plugins.find(plugin => plugin.channels.includes(channel))
   if (!group || current.disabled_plugins.includes(group.id)) throw new Error('本次所需工具组已停用')
  }
  if (channels.includes('organize') && current.disabled_plugins.includes('library'))
   throw new Error('分类建议需启用资料库阅读')
  return {
   revision: current.revision,
   skills,
   instructions: current.standing_instructions.enabled ? current.standing_instructions.body : '',
   channels
  }
 }
 verify(snapshot: ExtensionSnapshot) {
  const current = this.snapshot({revision: snapshot.revision, ids: snapshot.skills.map(s => s.id)}, snapshot.channels)
  if (JSON.stringify(current) !== JSON.stringify(snapshot))
   throw new Error('研究期间学习要求或方法已改变，旧结果未发布')
 }
 parseMarkdown(input: string) {
  text(12000).parse(input)
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/.exec(input)
  if (!match) throw new Error('方法文件需包含 name 和 description 的头部及正文')
  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
   if (!line.trim()) continue
   const pair = /^(name|description):\s*(.*?)\s*$/.exec(line)
   if (!pair || fields[pair[1]] !== undefined) throw new Error('方法文件头部格式不支持')
   let value = pair[2]
   if (value.startsWith('"')) {
    try {
     value = z.string().parse(JSON.parse(value))
    } catch {
     throw new Error('方法头部引号无效')
    }
   } else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replace(/''/g, "'")
   else if (/^[!&*\[{>|]/.test(value)) throw new Error('方法头部仅支持普通文本')
   fields[pair[1]] = value
  }
  const parsed = skill
   .omit({id: true})
   .parse({name: fields.name, description: fields.description, body: match[2].trim(), enabled: false})
  return parsed
 }
}
