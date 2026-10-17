import encodeQR from 'qr'
import {randomUUID} from 'node:crypto'
import {join} from 'node:path'
import {z} from 'zod'
import {NativeImStore, imId, imScope} from './im-store'
import {NativeNapcatRuntime} from './im-napcat-runtime'
import {NativeNapcatLogin, NativeQqSession, onebotConfig} from './im-qq'
import {NativeILinkSession} from './im-ilink'
import {NativeWeixinWebSession} from './im-weixin-web'
import {NativeWeixinLocal} from './im-weixin-local'
import {NativeImAutomation, type NativeImKnowledge} from './im-automation'
import type {ResearchModel} from './research-engine'
import {NativeImCleanup} from './im-cleanup'
import type {MediaCrypt} from './media-encryption'
type Projection = {
 operation_id: string
 connection_id: string
 generation: string
 state: string
 account: string
 has_qr: boolean
 createdAt: number
 boundRevision?: string
 detail?: {message: string}
}
type Login = {
 projection: Projection
 revision: string
 controller: AbortController
 adapter?: NativeNapcatLogin | NativeILinkSession | NativeWeixinWebSession
 qr: string
}
/** Native selected-account facade. Model requests have no path to login, sync or send actions. */
export class NativeImService {
 private store: NativeImStore
 private runtime: NativeNapcatRuntime
 private logins = new Map<string, Login>()
 private controller = new AbortController()
 private closing: Promise<void> | undefined
 private syncing = new Set<string>()
 private local = new NativeWeixinLocal()
 private profile = ''
 private automation: NativeImAutomation
 constructor(
  root: string,
  resources: string,
  private fetcher: typeof fetch = fetch,
  model?: ResearchModel,
  knowledge?: NativeImKnowledge,
  crypt?: MediaCrypt
 ) {
  this.store = new NativeImStore(root, crypt)
  this.runtime = new NativeNapcatRuntime(resources, join(root, 'runtime-components/napcat'), crypt)
  this.automation = new NativeImAutomation(this.store, {
   profile: () => (this.profile ? 'native-' + this.profile : ''),
   sync: (scope, signal) => this.sync(scope, signal),
   model: (system, user, signal) => {
    if (!model || !this.profile) throw new Error('请先连接模型')
    return model({connection: this.profile, system, user}, signal)
   },
   send: input => this.execute('send', input),
   knowledge
  })
  this.knowledge = knowledge
 }
 private knowledge: NativeImKnowledge | undefined
 configure(profile: string) {
  if (profile !== this.profile) this.automation.pauseAll()
  this.profile = profile
 }
 private persist(login: Login) {
  this.store.db
   .prepare(
    'INSERT INTO login_operations VALUES(?,?,?) ON CONFLICT(operation_id) DO UPDATE SET projection=excluded.projection'
   )
   .run(
    login.projection.operation_id,
    JSON.stringify({version: 'native-v1', connection_id: login.projection.connection_id, revision: login.revision}),
    JSON.stringify(login.projection)
   )
  return {...login.projection}
 }
 private operation(input: unknown) {
  const value = z.object({operation_id: imId, connection_id: imId, generation: imId}).parse(input),
   login = this.logins.get(value.operation_id)
  if (!login) {
   const row = this.store.db
    .prepare('SELECT projection FROM login_operations WHERE operation_id=?')
    .get(value.operation_id) as {projection: string} | undefined
   if (!row) throw new Error('登录操作不存在')
   const saved = JSON.parse(row.projection) as Projection
   if (saved.connection_id !== value.connection_id || saved.generation !== value.generation)
    throw new Error('登录操作归属已改变')
   return {value, saved}
  }
  if (login.projection.connection_id !== value.connection_id || login.projection.generation !== value.generation)
   throw new Error('登录操作归属不符')
  return {value, login, saved: login.projection}
 }
 private signal(login?: Login) {
  return AbortSignal.any([this.controller.signal, ...(login ? [login.controller.signal] : [])])
 }
 private current(login: Login) {
  this.signal(login).throwIfAborted()
  if (this.logins.get(login.projection.operation_id) !== login) throw new Error('登录操作已被替换')
  this.store.capture(login.projection.connection_id, login.revision)
  if (Date.now() - login.projection.createdAt > 10 * 60 * 1000) throw new Error('本次登录已过期，请重新开始')
 }
 async execute(action: string, input: unknown = {}, profile?: string) {
  if (this.controller.signal.aborted) throw new Error('通讯后台已关闭')
  if (profile !== undefined) this.configure(profile)
  if (action === 'status')
   return {
    ...this.store.listing(),
    platforms: {
     qq_napcat: {label: '个人 QQ · 后台组件'},
     weixin_local: {label: '个人微信 · 本机只读'},
     weixin_web: {label: '微信 Web · 实验'},
     weixin_ilink: {label: '微信 Bot · iLink'}
    },
    qq_component: this.runtime.status()
   }
  if (action === 'change') {
   const result = await this.store.change(input),
    value = z.record(z.string(), z.unknown()).parse(input)
   if (value.action === 'delete' && typeof value.id === 'string') await this.local.invalidate(value.id)
   return result
  }
  if (action === 'personal-processes') return this.local.request('processes', {}, this.signal())
  if (action === 'personal-probe') {
   const value = z
     .object({connection_id: imId, revision: imId, pid: z.number().int().positive(), created: z.number().finite()})
     .parse(input),
    row = this.store.capture(value.connection_id, value.revision)
   if (row.platform !== 'weixin_local') throw new Error('请先选择本机微信连接')
   const result = await this.local.request('probe', value, this.signal())
   this.store.capture(value.connection_id, value.revision)
   return result
  }
  if (action === 'personal-confirm') {
   const value = z
     .object({
      connection_id: imId,
      revision: imId,
      probe_id: imId,
      account: z.string().min(1).max(200),
      user_confirmed: z.literal(true)
     })
     .parse(input),
    row = this.store.capture(value.connection_id, value.revision)
   if (row.platform !== 'weixin_local') throw new Error('当前连接不是本机微信')
   const {result, owner} = await this.local.confirm<{account: string; session: unknown; capabilities: unknown}>(
    value.connection_id,
    value,
    this.signal()
   )
   try {
    owner()
    await this.store.bind(
     value.connection_id,
     value.revision,
     result.account,
     result.session,
     result.capabilities,
     () => {
      this.signal().throwIfAborted()
      owner()
     }
    )
    return this.store.listing()
   } catch (error) {
    await this.local.invalidateOwned(value.connection_id, owner).catch(() => {})
    throw error
   }
  }
  if (action === 'model') return {profile_id: this.profile ? 'native-' + this.profile : '', model: '梅酱当前连接'}
  if (action === 'libraries')
   return {libraries: this.knowledge ? [{library_id: this.knowledge.id, label: '当前知识库', available: true}] : []}
  if (action === 'rules') return this.automation.rules(input)
  if (action === 'runs') return this.automation.runs(input)
  if (action === 'reply-jobs') return this.automation.jobs(input)
  if (action === 'cleanup') return new NativeImCleanup(this.store).execute(input)
  if (action === 'start') {
   const value = z.object({operation_id: imId, connection_id: imId, expected_revision: imId}).parse(input),
    row = this.store.capture(value.connection_id, value.expected_revision)
   const old = this.store.db
    .prepare('SELECT projection FROM login_operations WHERE operation_id=?')
    .get(value.operation_id) as {projection: string} | undefined
   if (old) {
    const saved = JSON.parse(old.projection) as Projection
    if (saved.connection_id !== row.id) throw new Error('登录编号已用于其他连接')
    return {
     ...saved,
     has_qr: false,
     state: saved.state === 'online' ? 'online' : 'unknown',
     detail: {message: '已有操作不自动重复启动；中断后请明确新建登录操作。'}
    }
   }
   if (!['qq_napcat', 'weixin_ilink', 'weixin_web'].includes(row.platform))
    throw new Error('此平台的原生登录适配仍在迁移，未启动旧后台')
   for (const login of this.logins.values())
    if (
     login.projection.connection_id === row.id &&
     !['online', 'cancelled', 'failed', 'expired'].includes(login.projection.state)
    ) {
     login.controller.abort()
     login.projection = {...login.projection, state: 'superseded', has_qr: false}
     this.persist(login)
    }
   const login: Login = {
    projection: {
     operation_id: value.operation_id,
     connection_id: row.id,
     generation: randomUUID().replaceAll('-', ''),
     state: 'verifying',
     account: '',
     has_qr: false,
     createdAt: Date.now()
    },
    revision: row.revision,
    controller: new AbortController(),
    qr: ''
   }
   this.logins.set(value.operation_id, login)
   this.persist(login)
   try {
    if (row.platform === 'weixin_ilink' || row.platform === 'weixin_web') {
     login.adapter =
      row.platform === 'weixin_ilink'
       ? new NativeILinkSession(undefined, this.fetcher)
       : new NativeWeixinWebSession(undefined, this.fetcher)
     const state = await login.adapter.start(this.signal(login))
     this.current(login)
     login.qr = state.qr
     login.projection = {...login.projection, state: state.state, has_qr: !!state.qr}
     return this.persist(login)
    }
    const privateRow = await this.store.privateState(row.id, row.revision),
     managed = row.fields.mode !== 'manual'
    this.current(login)
    const component = managed ? await this.runtime.ensure() : undefined
    this.current(login)
    login.adapter = new NativeNapcatLogin(
     managed ? 'http://127.0.0.1:' + component!.webui_port : row.fields.webui_url,
     managed ? component!.webui_token : privateRow.secrets.webui_token || '',
     onebotConfig.parse({
      url: managed ? 'http://127.0.0.1:' + component!.onebot_port : row.fields.onebot_url,
      token: managed ? component!.onebot_token : privateRow.secrets.onebot_token || '',
      ...(row.account ? {account: row.account} : {})
     }),
     managed,
     this.fetcher
    )
    const state = await login.adapter.start(this.signal(login))
    this.current(login)
    login.qr = state.qr
    login.projection = {...login.projection, state: state.state, has_qr: !!login.qr}
    this.persist(login)
    return state.state === 'verifying' ? this.inspect(login) : this.persist(login)
   } catch (error) {
    if (!login.controller.signal.aborted) {
     login.projection = {
      ...login.projection,
      state: 'failed',
      has_qr: false,
      detail: {message: '登录未完成，请检查所选连接状态。'}
     }
     this.persist(login)
    }
    throw error
   }
  }
  if (['inspect', 'cancel', 'confirm', 'qr'].includes(action)) {
   const value = z.record(z.string(), z.unknown()).parse(input),
    operation = this.operation(value),
    login = operation.login
   if (!login) {
    if (action === 'qr') throw new Error('中断后的二维码不恢复，请重新开始登录')
    return {...operation.saved, has_qr: false, state: operation.saved.state === 'online' ? 'online' : 'unknown'}
   }
   if (action === 'cancel') {
    if (login.projection.state !== 'online') {
     login.controller.abort()
     login.qr = ''
     login.projection = {...login.projection, state: 'cancelled', has_qr: false}
     this.persist(login)
    }
    return this.persist(login)
   }
   if (action === 'qr') {
    this.current(login)
    if (!login.qr) throw new Error('当前登录尚未取得二维码')
    return encodeQR(login.qr, 'data-url', {border: 4, scale: 5})
   }
   if (action === 'inspect') {
    if (value.verify_code !== undefined) {
     if (!(login.adapter instanceof NativeILinkSession)) throw new Error('此连接不使用手机配对码')
     login.adapter.submitCode(z.string().parse(value.verify_code))
    }
    return login.projection.state === 'online' ? this.persist(login) : this.inspect(login)
   }
   if (login.projection.state === 'online') return {login: this.persist(login)}
   this.current(login)
   if (login.projection.state !== 'awaiting_bind' || value.displayed_account !== login.projection.account)
    throw new Error('请先核对本次显示的账号')
   const result = await login.adapter!.verify(this.signal(login))
   this.current(login)
   if (result.account !== login.projection.account) throw new Error('确认期间登录账号改变，未绑定')
   const bound = await this.store.bind(
    login.projection.connection_id,
    login.revision,
    result.account,
    result.session,
    result.capabilities,
    () => {
     this.current(login)
     if (
      this.operation(value).login !== login ||
      login.projection.state !== 'awaiting_bind' ||
      value.displayed_account !== login.projection.account ||
      result.account !== login.projection.account
     )
      throw new Error('确认期间登录状态或账号已改变，未绑定')
    }
   )
   login.qr = ''
   login.projection = {...login.projection, state: 'online', has_qr: false, boundRevision: bound.revision}
   return {login: this.persist(login)}
  }
  if (action === 'read') return this.store.readMessages(input)
  if (action === 'send-status') return this.store.sendStatus(input)
  if (['directory', 'sync', 'send'].includes(action)) {
   const localScope = this.store.checkScope(input)
   if (localScope.row.platform === 'weixin_local') {
    if (action === 'send') throw new Error('本机个人微信仅支持只读和草稿')
    this.store.requireRead(localScope.scope)
    if (action === 'sync') return this.sync(localScope.scope, this.signal())
    const result = await this.local.request('directory', await this.localInput(localScope.scope), this.signal())
    this.store.checkScope(localScope.scope)
    return result
   }
   const {scope, row} = this.store.checkScope(input)
   if (!['qq_napcat', 'weixin_ilink', 'weixin_web'].includes(row.platform))
    throw new Error('此平台的原生通讯会话仍在迁移')
   if (action === 'send') {
    const claim = this.store.claimSend(input)
    if (!claim.fresh)
     return {...claim.receipt, state: claim.receipt.state === 'sending' ? 'unknown' : claim.receipt.state}
    try {
     if (row.platform === 'weixin_ilink' || row.platform === 'weixin_web') {
      const session = await this.weixin(row.platform, scope.connection_id, scope.revision)
      this.signal().throwIfAborted()
      this.store.checkScope(scope)
      await session.verify(this.signal(), scope.account)
      this.store.checkScope(scope)
      const receipt = await session.send(scope.peer, claim.value.text, claim.value.operation_id, this.signal())
      return this.store.finishSend(claim.value.operation_id, receipt ? 'sent' : 'unknown', receipt || undefined)
     }
     const session = await this.session(scope.connection_id, scope.revision)
     this.signal().throwIfAborted()
     this.store.checkScope(scope)
     await session.verify(scope.account, this.signal())
     this.store.checkScope(scope)
     const receipt = await session.send(scope.peer, claim.value.text, this.signal())
     return this.store.finishSend(claim.value.operation_id, 'sent', receipt)
    } catch {
     return this.store.finishSend(claim.value.operation_id, 'unknown')
    }
   }
   this.store.requireRead(scope)
   if (action === 'sync') return this.sync(scope, this.signal())
   if (row.platform === 'weixin_ilink' || row.platform === 'weixin_web') {
    const session = await this.weixin(row.platform, scope.connection_id, scope.revision)
    this.signal().throwIfAborted()
    this.store.checkScope(scope)
    this.store.requireRead(scope)
    await session.verify(this.signal(), scope.account)
    const result = await session.directory(this.signal())
    this.store.checkScope(scope)
    return result
   }
   const session = await this.session(scope.connection_id, scope.revision)
   this.signal().throwIfAborted()
   this.store.checkScope(scope)
   this.store.requireRead(scope)
   await session.verify(scope.account, this.signal())
   this.store.checkScope(scope)
   const result = await session.directory(this.signal())
   this.store.checkScope(scope)
   return result
  }
  throw new Error('此通讯操作尚未完成原生适配：' + action)
 }
 private async sync(input: unknown, signal: AbortSignal) {
  const {scope} = this.store.checkScope(input)
  if (this.syncing.has(scope.connection_id)) throw new Error('此账号正在同步，请待本次完成后再试')
  this.syncing.add(scope.connection_id)
  try {
   return await this.syncSelected(scope, signal)
  } finally {
   this.syncing.delete(scope.connection_id)
  }
 }
 private async syncSelected(input: unknown, signal: AbortSignal) {
  const {scope, row} = this.store.checkScope(input)
  this.store.requireRead(scope)
  if (!this.store.accountLimits(scope).archive_enabled) throw new Error('此账号已停用消息保存，未请求同步')
  const privateRow = await this.store.privateState(scope.connection_id, scope.revision)
  signal.throwIfAborted()
  this.store.requireRead(scope)
  if (!this.store.accountLimits(scope).archive_enabled) throw new Error('此账号已停用消息保存，未请求同步')
  const beforeCommit = () => signal.throwIfAborted()
  if (row.platform === 'weixin_local') {
   const result = await this.local.request<{session: unknown; messages: unknown; coverage: unknown}>(
    'receive',
    {connection_id: scope.connection_id, account: scope.account, peer: scope.peer, session: privateRow.session},
    signal
   )
   signal.throwIfAborted()
   return {
    ...(await this.store.saveSessionAndMessages(
     scope,
     result.session,
     result.messages,
     privateRow.snapshot,
     beforeCommit
    )),
    coverage: result.coverage
   }
  }
  if (row.platform === 'weixin_ilink' || row.platform === 'weixin_web') {
   const session =
    row.platform === 'weixin_web'
     ? new NativeWeixinWebSession(privateRow.session, this.fetcher)
     : new NativeILinkSession(privateRow.session, this.fetcher)
   await session.verify(signal, scope.account)
   const result = await session.receive(scope.peer, scope.account, signal)
   await session.verify(signal, scope.account)
   signal.throwIfAborted()
   return this.store.saveSessionAndMessages(scope, result.session, result.messages, privateRow.snapshot, beforeCommit)
  }
  if (row.platform !== 'qq_napcat') throw new Error('此平台的原生读取仍在迁移')
  const session = new NativeQqSession(z.object({onebot: onebotConfig}).parse(privateRow.session).onebot, this.fetcher)
  await session.verify(scope.account, signal)
  this.store.checkScope(scope)
  const messages = await session.receive(scope.peer, scope.account, signal)
  await session.verify(scope.account, signal)
  signal.throwIfAborted()
  return this.store.saveMessages(scope, messages)
 }
 private async localInput(input: unknown) {
  const {scope} = this.store.checkScope(input),
   privateRow = await this.store.privateState(scope.connection_id, scope.revision)
  this.signal().throwIfAborted()
  this.store.requireRead(scope)
  return {
   connection_id: scope.connection_id,
   account: scope.account,
   peer: scope.peer,
   session: privateRow.session
  }
 }
 private async weixin(platform: string, id: string, revision: string) {
  const saved = (await this.store.privateState(id, revision)).session
  return platform === 'weixin_web'
   ? new NativeWeixinWebSession(saved, this.fetcher)
   : new NativeILinkSession(saved, this.fetcher)
 }
 private async session(id: string, revision: string) {
  const row = await this.store.privateState(id, revision),
   session = z.object({onebot: onebotConfig}).parse(row.session)
  return new NativeQqSession(session.onebot, this.fetcher)
 }
 private async inspect(login: Login) {
  this.current(login)
  if (!login.adapter) throw new Error('本次登录状态已中断')
  const state = await login.adapter.poll(this.signal(login))
  this.current(login)
  login.qr = state.qr
  login.projection = {
   ...login.projection,
   state: state.state,
   has_qr: !!login.qr,
   ...('detail' in state && z.object({message: z.string()}).safeParse(state.detail).success
    ? {detail: z.object({message: z.string()}).parse(state.detail)}
    : {})
  }
  if (state.state === 'verifying') {
   const result = await login.adapter.verify(this.signal(login))
   this.current(login)
   login.projection = {...login.projection, state: 'awaiting_bind', account: result.account, has_qr: false}
  }
  return this.persist(login)
 }
 dispose() {
  return (this.closing ??= (async () => {
   this.controller.abort()
   for (const login of this.logins.values()) login.controller.abort()
   await this.automation.dispose()
   await this.local.dispose()
   this.runtime.dispose()
   this.store.close()
  })())
 }
}
