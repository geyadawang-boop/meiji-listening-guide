import {mkdir, readFile, writeFile, rename, readdir, rm} from 'node:fs/promises'
import {join, resolve, relative, isAbsolute} from 'node:path'
import {randomUUID, createHash} from 'node:crypto'
import {z} from 'zod'
import {parseSrt} from '@shared/srt'
import {noteTitles, notesSvg, type VideoNoteMode, type VideoNotePoint} from '@shared/video-notes'
import {folderName, libraryDirectory} from '@main/library/library'
import {subtitleLocator} from '@main/learning/subtitles/subtitle-sync'
import type {DerivedSource, SubtitleDerivedTask} from '@shared/subtitle-derived'
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const sourceSchema = z.object({
 url: z.string(),
 title: z.string().min(1).max(200),
 path: z.string(),
 hash: z.string().regex(/^[a-f0-9]{64}$/),
 generation: z.string().min(1)
})
const modeSchema = z.enum(['brief', 'detailed', 'keypoints', 'mindmap'])
const pointSchema = z.object({
 cue: z.number(),
 quote: z.string(),
 point: z.string(),
 topic: z.string(),
 timestamp: z.string()
})
const taskSchema = z.object({
 id: z.string().uuid(),
 createdAt: z.string(),
 courseName: z.string().optional(),
 interrupted: z.boolean(),
 items: z
  .array(
   z.object({
    source: sourceSchema,
    mode: modeSchema,
    status: z.enum(['等待处理', '已完成', '失败']),
    error: z.string().optional(),
    outputs: z.array(z.object({path: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/)})).optional(),
    prepared: z.object({markdown: z.string(), points: z.array(pointSchema)}).optional()
   })
  )
  .min(1)
  .max(4000)
})
export type Dependencies = {
 generation: (url: string) => Promise<string | null>
 summarize: (
  srt: string,
  mode: VideoNoteMode,
  signal: AbortSignal
 ) => Promise<{markdown: string; points: VideoNotePoint[]}>
 progress: (message: string) => void
}
export class SubtitleDerived {
 constructor(
  private root: string,
  private library: string
 ) {}
 private async save(task: SubtitleDerivedTask) {
  await mkdir(this.root, {recursive: true})
  const path = join(this.root, task.id + '.json')
  await writeFile(path + '.tmp', JSON.stringify(task, null, 2), 'utf8')
  await rename(path + '.tmp', path)
 }
 private async read(id: string) {
  z.string().uuid().parse(id)
  const task = taskSchema.parse(JSON.parse(await readFile(join(this.root, id + '.json'), 'utf8')))
  if (task.id !== id) throw new Error('笔记任务身份不一致')
  return task
 }
 private inside(path: string) {
  const location = relative(resolve(this.library), resolve(path))
  if (!location || location.startsWith('..') || isAbsolute(location)) throw new Error('笔记来源或成果不在课程资料目录')
 }
 async list() {
  await mkdir(this.root, {recursive: true})
  const tasks = []
  for (const name of await readdir(this.root)) {
   if (/^[0-9a-f-]{36}\.json$/.test(name)) tasks.push(await this.read(name.slice(0, -5)))
  }
  return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
 }
 async create(sources: DerivedSource[], modes: VideoNoteMode[], courseName?: string) {
  const checked = z.array(sourceSchema).min(1).max(1000).parse(sources),
   selected = z.array(modeSchema).min(1).max(4).parse(modes)
  if (
   new Set(checked.map(source => subtitleLocator(source.url))).size !== checked.length ||
   new Set(selected).size !== selected.length
  )
   throw new Error('不要重复选择分集或笔记形式')
  const task: SubtitleDerivedTask = {
   id: randomUUID(),
   createdAt: new Date().toISOString(),
   courseName,
   interrupted: true,
   items: checked.flatMap(source =>
    selected.map(mode => ({source: {...source, url: subtitleLocator(source.url)}, mode, status: '等待处理' as const}))
   )
  }
  for (const source of checked) this.inside(source.path)
  await this.save(task)
  return task
 }
 private async current(source: DerivedSource, dependencies: Dependencies) {
  this.inside(source.path)
  const srt = await readFile(source.path, 'utf8')
  if (digest(srt) !== source.hash || (await dependencies.generation(source.url)) !== source.generation)
   throw new Error('字幕来源已有改变，请重新同步并建立笔记任务；旧成果保留')
  parseSrt(srt)
  return srt
 }
 async run(id: string, dependencies: Dependencies, signal: AbortSignal) {
  const task = await this.read(id)
  task.interrupted = true
  await this.save(task)
  try {
   for (const [index, item] of task.items.entries()) {
    signal.throwIfAborted()
    dependencies.progress(
     `整理所选笔记 ${index + 1}/${task.items.length} · ${item.source.title} · ${noteTitles[item.mode]}`
    )
    const created: string[] = []
    try {
     const srt = await this.current(item.source, dependencies)
     if (item.outputs?.length) {
      for (const output of item.outputs) {
       this.inside(output.path)
       if (digest(await readFile(output.path, 'utf8')) !== output.hash)
        throw new Error('已保存笔记被修改或缺失，请核对原文件；未自动覆盖')
      }
      item.status = '已完成'
      delete item.error
      await this.save(task)
      continue
     }
     if (!item.prepared) {
      item.prepared = await dependencies.summarize(srt, item.mode, signal)
      signal.throwIfAborted()
      await this.current(item.source, dependencies)
      await this.save(task)
     }
     signal.throwIfAborted()
     await this.current(item.source, dependencies)
     const directory = await libraryDirectory(this.library, '笔记', task.courseName)
     const stem =
      folderName(item.source.title).slice(0, 40) +
      '-' +
      noteTitles[item.mode] +
      '-' +
      task.id.slice(0, 8) +
      '-' +
      (index + 1)
     const provenance = `\n\n---\n字幕来源：${item.source.url}\n来源版本：${item.source.generation}\n字幕 SHA256：${item.source.hash}\n`
     const files = [
      {path: join(directory, stem + '.md'), text: item.prepared.markdown + provenance},
      {path: join(directory, stem + '.json'), text: JSON.stringify(item.prepared.points, null, 2)}
     ]
     if (item.mode === 'mindmap')
      files.push({path: join(directory, stem + '.svg'), text: notesSvg(item.source.title, item.prepared.points)})
     for (const file of files) {
      try {
       const existing = await readFile(file.path, 'utf8')
       if (existing !== file.text) throw new Error('同名成果已有不同内容，未覆盖，请检查任务记录')
      } catch (error) {
       if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
       await writeFile(file.path, file.text, {encoding: 'utf8', flag: 'wx'})
       created.push(file.path)
      }
      if ((await readFile(file.path, 'utf8')) !== file.text) throw new Error('笔记保存校验失败')
     }
     signal.throwIfAborted()
     await this.current(item.source, dependencies)
     item.outputs = files.map(file => ({path: file.path, hash: digest(file.text)}))
     item.status = '已完成'
     delete item.error
     delete item.prepared
     await this.save(task)
    } catch (error) {
     for (const path of created) await rm(path, {force: true})
     signal.throwIfAborted()
     item.status = '失败'
     item.error = error instanceof Error ? error.message : '笔记处理失败'
     await this.save(task)
    }
   }
   task.interrupted = false
   await this.save(task)
   return task
  } finally {
   await this.save(task)
  }
 }
}
