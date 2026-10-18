import {readFile, writeFile, mkdir, rename, readdir, lstat, rm} from 'node:fs/promises'
import {join, isAbsolute, relative, resolve, sep} from 'node:path'
import {createHash, randomUUID} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {z} from 'zod'
import type {MediaBackend} from '@main/media/core/media'
import {visualOutputRecoveryReason, type VisualOutputRecovery} from '@shared/visual'
export type VisualFrame = {
 path: string
 time: number
 hash: string
 status: '等待识别' | '已完成' | '失败'
 text?: string
 error?: string
}
type OutputJournal = {output: string; temp: string; hash: string; previousHash?: string; backup?: string}
export type VisualTask = {
 id: string
 source: string
 sourceHash: string
 duration: number
 frames: VisualFrame[]
 gaps: unknown[]
 connection: string
 output?: string
 outputHash?: string
 outputJournal?: OutputJournal
 outputPending?: boolean
 outputRecovery?: VisualOutputRecovery
 cleaned?: boolean
 preparation?: {cap: number; policy: string; status: string; error?: string}
}
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
async function fileDigest(path: string) {
 const hash = createHash('sha256')
 for await (const chunk of createReadStream(path)) hash.update(chunk)
 return hash.digest('hex')
}
export class VisualTasks {
 constructor(
  private root: string,
  private media: MediaBackend
 ) {}
 private async save(task: VisualTask) {
  await mkdir(this.root, {recursive: true})
  const path = join(this.root, task.id + '.json')
  const persisted = {...task}
  delete persisted.outputRecovery
  await writeFile(path + '.tmp', JSON.stringify(persisted, null, 2))
  await rename(path + '.tmp', path)
 }
 private canonicalOutput(id: string) {
  return resolve(this.root, id + '-画面识别.md')
 }
 private outputPath(task: VisualTask) {
  const output = resolve(task.output || this.canonicalOutput(task.id)),
   root = resolve(this.root),
   location = relative(root, output)
  if (!location || location === '..' || location.startsWith('..' + sep) || isAbsolute(location))
   throw new Error('识别成果路径无效，保留当前文件')
  return output
 }
 private async optionalDigest(path: string) {
  try {
   const item = await lstat(path)
   if (!item.isFile() || item.isSymbolicLink()) throw new Error('识别成果路径类型无效，保留当前文件')
   return await fileDigest(path)
  } catch (error) {
   if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
   throw error
  }
 }
 private async recoverOutput(task: VisualTask) {
  const journal = task.outputJournal
  if (!journal) return
  const output = this.outputPath(task),
   temp = journal.temp
  const tempPrefix = output + '.pending-',
   backupPrefix = output + '.previous-'
  if (
   journal.output !== output ||
   !journal.temp.startsWith(tempPrefix) ||
   !/^[a-f0-9]{32}$/.test(journal.temp.slice(tempPrefix.length)) ||
   (journal.backup !== undefined &&
    (!journal.backup.startsWith(backupPrefix) || !/^[a-f0-9]{32}$/.test(journal.backup.slice(backupPrefix.length)))) ||
   !/^[a-f0-9]{64}$/.test(journal.hash) ||
   (journal.previousHash !== undefined && !/^[a-f0-9]{64}$/.test(journal.previousHash))
  )
   throw new Error('识别成果恢复记录无效，保留当前文件')
  const current = await this.optionalDigest(output)
  if (current === journal.hash) {
   task.output = output
   task.outputHash = journal.hash
   delete task.outputJournal
   delete task.outputPending
   await this.save(task)
   if (journal.backup && (await this.optionalDigest(journal.backup)) === journal.previousHash)
    await rm(journal.backup, {force: true})
   if ((await this.optionalDigest(journal.temp)) === journal.hash) await rm(journal.temp, {force: true})
   return
  }
  if (current !== journal.previousHash && current !== undefined)
   throw new Error('识别成果已改变，保留当前文件，恢复已中止')
  if ((await this.optionalDigest(temp)) !== journal.hash)
   throw new Error('识别成果暂存文件校验失败，保留当前文件以便恢复')
  if (current === undefined && journal.previousHash !== undefined) {
   if (!journal.backup || (await this.optionalDigest(journal.backup)) !== journal.previousHash)
    throw new Error('识别成果备份校验失败，保留当前文件以便恢复')
  }
  await this.replaceTemp(temp, output, journal.backup, journal.previousHash, journal.hash)
  if ((await this.optionalDigest(output)) !== journal.hash) throw new Error('画面成果替换核验失败，保留恢复记录')
  task.output = output
  task.outputHash = journal.hash
  delete task.outputJournal
  delete task.outputPending
  await this.save(task)
  if (journal.backup && (await this.optionalDigest(journal.backup)) === journal.previousHash)
   await rm(journal.backup, {force: true})
 }
 private async replaceTemp(
  temp: string,
  output: string,
  backup: string | undefined,
  previousHash: string | undefined,
  newHash: string
 ) {
  try {
   await rename(temp, output)
   return
  } catch (error) {
   const code = (error as NodeJS.ErrnoException).code
   if (!backup || !['EEXIST', 'EPERM', 'ENOTEMPTY'].includes(code || '')) throw error
  }
  if (
   (await this.optionalDigest(output)) !== previousHash ||
   (await this.optionalDigest(backup!)) !== undefined ||
   (await this.optionalDigest(temp)) !== newHash
  )
   throw new Error('识别成果替换前校验失败，保留当前文件')
  await rename(output, backup!)
  if ((await this.optionalDigest(backup!)) !== previousHash) throw new Error('识别成果备份校验失败，保留恢复记录')
  try {
   await rename(temp, output)
  } catch (error) {
   if ((await this.optionalDigest(output)) === undefined && (await this.optionalDigest(backup!)) === previousHash)
    await rename(backup!, output).catch(() => {})
   throw error
  }
 }
 private async commitOutput(task: VisualTask, text: string) {
  const output = this.outputPath(task),
   temp = output + '.pending-' + randomUUID().replaceAll('-', ''),
   hash = digest(text)
  const previousHash = task.outputHash,
   current = await this.optionalDigest(output)
  if (task.output && previousHash && current !== previousHash)
   throw new Error('识别成果已改变，保留当前文件，请重新建立任务')
  if (current !== undefined && (!task.outputHash || current !== task.outputHash))
   throw new Error('已有识别成果文件，保留当前文件')
  const backup = previousHash ? output + '.previous-' + randomUUID().replaceAll('-', '') : undefined
  if (backup && (await this.optionalDigest(backup)) !== undefined)
   throw new Error('识别成果备份路径已存在，保留当前文件')
  await writeFile(temp, text, {encoding: 'utf8', flag: 'wx'})
  if ((await this.optionalDigest(temp)) !== hash) throw new Error('画面成果暂存校验失败，保留当前文件')
  task.outputJournal = {output, temp, hash, previousHash, backup}
  await this.save(task)
  if ((await this.optionalDigest(output)) !== previousHash) throw new Error('识别成果已改变，保留当前文件，替换已中止')
  await this.replaceTemp(temp, output, backup, previousHash, hash)
  if ((await this.optionalDigest(output)) !== hash) throw new Error('画面成果替换核验失败，保留恢复记录')
  task.output = output
  task.outputHash = hash
  delete task.outputJournal
  delete task.outputPending
  await this.save(task)
  if (backup && (await this.optionalDigest(backup)) === previousHash) await rm(backup, {force: true})
 }
 async list() {
  await mkdir(this.root, {recursive: true})
  const result: VisualTask[] = []
  for (const name of await readdir(this.root))
   if (/^[a-f0-9]{32}\.json$/.test(name)) {
    const task = JSON.parse(await readFile(join(this.root, name), 'utf8')) as VisualTask
    try {
     const output = this.outputPath(task),
      currentHash = await this.optionalDigest(output)
     task.outputRecovery = visualOutputRecoveryReason(task, {
      currentHash,
      hasOutput: currentHash !== undefined,
      hasLegacyOutput: !task.output && currentHash !== undefined
     })
    } catch {
     task.outputRecovery = 'changed'
    }
    result.push(task)
   }
  return result.reverse()
 }
 async create(path: string, cap: number, policy: string, connection: string, signal?: AbortSignal) {
  const task: VisualTask = {
   id: randomUUID().replaceAll('-', ''),
   source: path,
   sourceHash: await fileDigest(path),
   duration: 0,
   frames: [],
   gaps: [],
   connection,
   preparation: {cap, policy, status: '等待提取'}
  }
  await this.save(task)
  return this.prepare(task.id, connection, signal)
 }
 async prepare(id: string, connection: string, signal?: AbortSignal) {
  z.string()
   .regex(/^[a-f0-9]{32}$/)
   .parse(id)
  const task: VisualTask = JSON.parse(await readFile(join(this.root, id + '.json'), 'utf8'))
  if (task.connection !== connection) throw new Error('连接已变化，请重新建立任务')
  if (!task.preparation) throw new Error('任务没有待提取记录')
  if (task.frames.length) return task
  if ((await fileDigest(task.source)) !== task.sourceHash) throw new Error('原文件已改变，请重新建立任务')
  const cancel = () => {
   void this.media.request('visual-cancel', {id}).catch(() => {})
  }
  signal?.addEventListener('abort', cancel, {once: true})
  try {
   signal?.throwIfAborted()
   task.preparation.status = '提取中'
   await this.save(task)
   const captured = await this.media.request<VisualTask>('visual-frames', {
    id,
    path: task.source,
    cap: task.preparation.cap,
    policy: task.preparation.policy,
    expectedHash: task.sourceHash
   })
   signal?.throwIfAborted()
   task.frames = captured.frames.map(frame => ({...frame, status: '等待识别'}))
   task.duration = captured.duration
   task.gaps = captured.gaps
   task.preparation.status = '已提取'
   delete task.preparation.error
   await this.save(task)
   return task
  } catch (reason) {
   task.preparation.status = '等待继续'
   task.preparation.error = reason instanceof Error ? reason.message : String(reason)
   await this.save(task)
   throw reason
  } finally {
   signal?.removeEventListener('abort', cancel)
  }
 }
 async run(
  id: string,
  connection: string,
  recognize: (frame: VisualFrame, signal: AbortSignal) => Promise<string>,
  progress: (message: string) => void,
  signal: AbortSignal
 ) {
  z.string()
   .regex(/^[a-f0-9]{32}$/)
   .parse(id)
  const task: VisualTask = JSON.parse(await readFile(join(this.root, id + '.json'), 'utf8'))
  if (task.id !== id || task.connection !== connection)
   throw new Error('识别连接已有改变，请用当前配置新建任务；旧成果保留')
  if (!task.frames.length) throw new Error('请先完成画面提取')
  await this.recoverOutput(task)
  if (task.output && (await this.optionalDigest(task.output)) !== task.outputHash)
   throw new Error('识别成果已改变，保留当前文件，请重新建立任务')
  const current = async () => {
   if ((await fileDigest(task.source)) !== task.sourceHash) throw new Error('源文件已经改变，请新建画面识别任务')
  }
  await current()
  task.outputPending = true
  await this.save(task)
  for (const [index, frame] of task.frames.entries()) {
   signal.throwIfAborted()
   if (frame.status === '已完成') continue
   progress(`识别画面 ${index + 1}/${task.frames.length}`)
   try {
    if (digest(await readFile(frame.path)) !== frame.hash) throw new Error('所选画面已改变')
    const text = await recognize(frame, signal)
    signal.throwIfAborted()
    await current()
    if (!text.trim()) throw new Error('识别未返回文字')
    frame.text = text
    frame.status = '已完成'
    delete frame.error
   } catch (reason) {
    signal.throwIfAborted()
    frame.status = '失败'
    frame.error = reason instanceof Error ? reason.message : String(reason)
   }
   await this.save(task)
  }
  await current()
  await this.commitOutput(task, this.outputText(task))
  const failed = task.frames.filter(frame => frame.status !== '已完成')
  if (!failed.length) {
   await this.media.request('visual-cleanup', {id})
   task.cleaned = true
   await this.save(task)
  }
  return task
 }
 private outputText(task: VisualTask) {
  const failed = task.frames.filter(frame => frame.status !== '已完成'),
   gapText = task.gaps.length
    ? task.gaps.map(gap => `- ${JSON.stringify(gap)}`).join('\n')
    : '- 提取器没有报告缺口；稀疏采样仍不代表识别了未选取的时段。'
  return (
   `# 画面文字与内容\n\n来源：${task.source}\n源文件 SHA256：${task.sourceHash}\n总时长：${task.duration.toFixed(2)} 秒\n\n仅识别所选的 ${task.frames.filter(frame => frame.status === '已完成').length}/${task.frames.length} 个画面，不代表视频全部内容。\n\n## 抽样缺口\n\n${gapText}\n\n## 识别结果\n\n` +
   task.frames
    .map(
     frame =>
      `### ${Math.floor(frame.time / 60)}:${Math.floor(frame.time % 60)
       .toString()
       .padStart(
        2,
        '0'
       )} · ${frame.status}\n\n${frame.status === '已完成' ? frame.text : `未得到可用识别结果：${frame.error || '仍待处理'}`}\n\n画面 SHA256：${frame.hash}`
    )
    .join('\n\n') +
   `\n\n## 未完成项目\n\n${
    failed.length
     ? failed
        .map(
         frame =>
          `- ${Math.floor(frame.time / 60)}:${Math.floor(frame.time % 60)
           .toString()
           .padStart(2, '0')}：${frame.error || '仍待处理'}`
        )
        .join('\n')
     : '- 无'
   }`
  )
 }
 async recoverSavedOutput(id: string) {
  z.string()
   .regex(/^[a-f0-9]{32}$/)
   .parse(id)
  const task = JSON.parse(await readFile(join(this.root, id + '.json'), 'utf8')) as VisualTask
  if (task.outputJournal) {
   await this.recoverOutput(task)
   return task
  }
  if (!task.frames.length || !task.frames.some(frame => frame.status === '已完成'))
   throw new Error('没有已保存的画面识别文字可恢复')
  const current = await this.optionalDigest(this.outputPath(task)),
   tracked = !!task.output && !!task.outputHash && current === task.outputHash
  if ((!tracked && current !== undefined) || (task.output && current === undefined)) {
   task.output = join(this.root, `${id}-画面识别-恢复-${randomUUID().replaceAll('-', '')}.md`)
   delete task.outputHash
  }
  task.outputPending = true
  await this.save(task)
  await this.commitOutput(task, this.outputText(task))
  return task
 }
}
