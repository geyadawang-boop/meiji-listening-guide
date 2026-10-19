import {createHash, randomUUID} from 'node:crypto'
import {z} from 'zod'
import {NativeResearchStore} from '@main/research/research-store'
import {NativeResearchSources, type ResearchBinding} from '@main/research/research-sources'
import {NativeResearchEngine, type NativeResearchTask} from '@main/research/research-engine'
const op = z.string().regex(/^[a-f0-9]{32}$/)
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
export type NativeResearchFlow = {
 workflow_id: string
 question: string
 status: 'paused' | 'running' | 'completed' | 'stopped' | 'failed'
 revision: number
 fence: number
 outcome_unknown: boolean
 bindings: ResearchBinding[]
 steps: {
  name: string
  status: string
  answer: string
  answer_sha256: string | null
  task_id: string | null
  create_op: string
 }[]
 error_code: string
 created_at: string
 updated_at: string
}
/** Two explicit persisted stages share checked sources; a saved draft never becomes evidence. */
export class NativeResearchWorkflows {
 private active = new Map<string, {controller: AbortController; done: Promise<void>}>()
 private initialized = false
 constructor(
  private store: NativeResearchStore,
  private sources: NativeResearchSources,
  private engine: NativeResearchEngine
 ) {}
 private initialize() {
  if (this.initialized) return
  this.initialized = true
  for (const flow of this.store.list<NativeResearchFlow>('workflow'))
   if (flow.status === 'running')
    this.save({...flow, status: 'paused', outcome_unknown: true, error_code: '上次工作流中断，需核对模型请求后再继续'})
 }
 private save(flow: NativeResearchFlow) {
  const next = {...flow, revision: flow.revision + 1, updated_at: new Date().toISOString()}
  this.store.put('workflow', flow.workflow_id, next.revision, next)
  return next
 }
 list() {
  this.initialize()
  return this.store.list<NativeResearchFlow>('workflow').sort((a, b) => b.updated_at.localeCompare(a.updated_at))
 }
 read(id: string) {
  this.initialize()
  op.parse(id)
  return this.store.read<NativeResearchFlow>('workflow', id)
 }
 create(input: unknown) {
  const request = z
   .object({op, question: z.string().trim().min(1).max(800), materials: z.array(z.unknown()).min(1).max(6)})
   .parse(input)
  const result = this.store.operation(request.op, request, () => {
   const materials = request.materials.map(binding => this.sources.read(binding))
   this.sources.verify(materials)
   const now = new Date().toISOString(),
    flow: NativeResearchFlow = {
     workflow_id: randomUUID().replaceAll('-', ''),
     question: request.question,
     status: 'paused',
     revision: 0,
     fence: 0,
     outcome_unknown: false,
     bindings: materials.map(source => source.binding),
     steps: ['材料整理', '综合回答'].map(name => ({
      name,
      status: 'pending',
      answer: '',
      answer_sha256: null,
      task_id: null,
      create_op: randomUUID().replaceAll('-', '')
     })),
     error_code: '',
     created_at: now,
     updated_at: now
    }
   this.store.put('workflow', flow.workflow_id, 0, flow)
   return {id: flow.workflow_id}
  })
  return this.read(result.id)
 }
 action(input: unknown) {
  const value = z
   .object({
    id: op,
    op,
    revision: z.number().int().nonnegative(),
    fence: z.number().int().nonnegative(),
    retry_unknown: z.boolean(),
    kind: z.enum(['stop', 'resume'])
   })
   .parse(input)
  const result = this.store.operation(value.op, value, () => {
   const flow = this.read(value.id)
   if (flow.revision !== value.revision || flow.fence !== value.fence) throw new Error('工作流版本已改变，请刷新')
   if (value.kind === 'stop') {
    if (flow.status !== 'running') throw new Error('工作流未运行')
    this.active.get(flow.workflow_id)?.controller.abort()
    for (const step of flow.steps) if (step.task_id && step.status === 'running') this.engine.stop(step.task_id)
    return {
     id: this.save({...flow, status: 'stopped', fence: flow.fence + 1, error_code: '用户停止工作流'}).workflow_id
    }
   }
   if (flow.status === 'completed' || flow.status === 'running') throw new Error('当前工作流不能继续')
   if (flow.outcome_unknown && !value.retry_unknown) throw new Error('存在未确认模型请求，需要明确确认后再继续')
   this.sources.verify(flow.bindings.map(binding => this.sources.read(binding)))
   this.save({...flow, status: 'running', fence: flow.fence + 1, outcome_unknown: false, error_code: ''})
   return {id: flow.workflow_id}
  })
  const flow = this.read(result.id)
  if (value.kind === 'resume' && flow.status === 'running' && !this.active.has(flow.workflow_id)) {
   const controller = new AbortController(),
    active = {controller, done: Promise.resolve()}
   this.active.set(flow.workflow_id, active)
   active.done = this.run(flow.workflow_id, flow.fence, value.retry_unknown, controller.signal).finally(() => {
    if (this.active.get(flow.workflow_id) === active) this.active.delete(flow.workflow_id)
   })
  }
  return this.read(result.id)
 }
 private async wait(id: string, signal: AbortSignal) {
  while (true) {
   signal.throwIfAborted()
   const task = this.engine.read(id)
   if (task.status !== 'running' && task.status !== 'paused') return task
   await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, 25)
    function done() {
     signal.removeEventListener('abort', abort)
     resolve()
    }
    function abort() {
     clearTimeout(timer)
     reject(new Error('工作流已停止'))
    }
    signal.addEventListener('abort', abort, {once: true})
    if (signal.aborted) abort()
   })
  }
 }
 private async run(id: string, fence: number, retryUnknown: boolean, signal: AbortSignal) {
  try {
   for (let index = 0; index < 2; index++) {
    signal.throwIfAborted()
    let flow = this.read(id)
    if (flow.status !== 'running' || flow.fence !== fence) throw new Error('工作流已改变')
    const step = flow.steps[index]
    if (step.status === 'completed') {
     if (step.answer_sha256 !== hash(step.answer)) throw new Error('已有步骤内容已改变')
     this.engine.verifyResult(step.task_id!)
     continue
    }
    this.sources.verify(flow.bindings.map(binding => this.sources.read(binding)))
    let task: NativeResearchTask
    if (step.task_id) {
     task = this.engine.read(step.task_id)
     if (task.status !== 'completed') task = this.engine.resume(task.task_id, task.revision, retryUnknown)
    } else {
     const question =
      index === 0
       ? `请为以下问题整理原文证据，区分资料中的共识和缺失：${flow.question}`
       : `请依据所选原文回答：${flow.question}\n前一步草稿仅为整理线索，不是额外来源，不得替代原文核对：\n${flow.steps[0].answer.slice(0, 10000)}`
     task = this.engine.create({
      op: step.create_op,
      question: question.slice(0, 1500),
      channels: ['library'],
      materials: flow.bindings
     })
    }
    flow = {
     ...flow,
     steps: flow.steps.map((item, i) => (i === index ? {...item, status: 'running', task_id: task.task_id} : item))
    }
    this.save(flow)
    const result = task.status === 'completed' ? task : await this.wait(task.task_id, signal)
    if (result.status !== 'completed') throw new Error(result.error_code || '工作流步骤未完成')
    this.engine.verifyResult(result.task_id)
    flow = this.read(id)
    if (flow.status !== 'running' || flow.fence !== fence) throw new Error('工作流已停止，步骤未发布')
    this.save({
     ...flow,
     steps: flow.steps.map((item, i) =>
      i === index ? {...item, status: 'completed', answer: result.note, answer_sha256: hash(result.note)} : item
     )
    })
   }
   const flow = this.read(id)
   if (flow.status !== 'running' || flow.fence !== fence) throw new Error('工作流已改变')
   this.sources.verify(flow.bindings.map(binding => this.sources.read(binding)))
   this.save({...flow, status: 'completed', outcome_unknown: false})
  } catch (error) {
   const current = this.read(id)
   if (current.status === 'running' && current.fence === fence)
    this.save({
     ...current,
     status: signal.aborted ? 'stopped' : 'failed',
     outcome_unknown: current.steps.some(step => step.task_id && this.engine.read(step.task_id).outcome_unknown),
     error_code: error instanceof Error ? error.message : '工作流未完成'
    })
  }
 }
 verify(id: string) {
  const flow = this.read(id)
  if (
   flow.status !== 'completed' ||
   flow.steps.some(step => step.status !== 'completed' || step.answer_sha256 !== hash(step.answer))
  )
   throw new Error('工作流尚未完整核验')
  for (const step of flow.steps) this.engine.verifyResult(step.task_id!)
  return flow
 }
 async dispose() {
  for (const [id, active] of this.active) {
   active.controller.abort()
   const flow = this.read(id)
   for (const step of flow.steps) if (step.task_id && step.status === 'running') this.engine.stop(step.task_id)
  }
  await Promise.allSettled([...this.active.values()].map(active => active.done))
 }
}
