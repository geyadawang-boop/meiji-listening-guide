import {app, safeStorage} from 'electron'
import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {release} from 'node:os'

const root = process.env.MEIJI_SMOKE_ROOT,
 work = process.env.MEIJI_SMOKE_WORK,
 results = process.env.MEIJI_SMOKE_RESULTS,
 phase = process.env.MEIJI_SMOKE_PHASE
if (!root || !work || !results || !['seed', 'restart'].includes(phase || ''))
 throw new Error('Invalid smoke fixture scope')
app.setName('Meiji Runtime Smoke')
app.setPath('userData', join(work, 'electron-profile'))
const checks: string[] = []
function check(value: unknown, label: string): asserts value {
 if (!value) throw new Error(label)
 checks.push(label)
}
const owners: Array<{dispose: () => Promise<void>}> = []
let exitCode = 0,
 failure: string | undefined
async function run(root: string, work: string, results: string) {
 await app.whenReady()
 let backend = process.platform === 'win32' ? 'dpapi' : 'keychain'
 try {
  if (process.platform === 'linux') backend = safeStorage.getSelectedStorageBackend()
  check(safeStorage.isEncryptionAvailable(), 'OS secure storage is available')
  if (process.platform === 'linux')
   check(backend === 'gnome_libsecret', 'Linux uses the requested secure libsecret backend')
  const plain = 'SYNTHETIC_RUNTIME_STORAGE'
  check(safeStorage.decryptString(safeStorage.encryptString(plain)) === plain, 'Real Electron safeStorage roundtrip')
  const {systemProtect, NativeMediaAuth, NativeDownloadJobs, NativeDownloads, NativeResearchBackend, Database} =
   await import(pathToFileURL(join(work, 'owners.mjs')).href)
  const bytes = Buffer.from([0, 255, 1, 128, 0])
  check(systemProtect(systemProtect(bytes), true).equals(bytes), 'Production media cipher binary roundtrip')
  check(
   systemProtect(systemProtect(bytes, false, 'im'), true, 'im').equals(bytes),
   'Production IM cipher binary roundtrip'
  )
  const mediaRoot = join(work, 'media'),
   imRoot = join(work, 'research'),
   identityPath = join(work, 'fixture-ids.json'),
   cookie = {
    name: 'fixture updated',
    site: 'example.com',
    cookies: 'example.com\tFALSE\t/\tTRUE\t0\tfixture\tSYNTHETIC_RUNTIME_COOKIE'
   }
  let ids: {auth: string; job: string; im: string}
  if (phase === 'seed') {
   const auth = new NativeMediaAuth(mediaRoot, systemProtect),
    authRow = await auth.save({...cookie, name: 'fixture seed'}),
    jobs = new NativeDownloadJobs(mediaRoot, systemProtect),
    job = await jobs.create({
     identity: 'runtime-fixture',
     url: 'https://example.com/synthetic-video',
     title: 'SYNTHETIC_PRIVATE_JOB',
     options: {privacy: true}
    })
   ids = {auth: authRow.id, job: job.id, im: ''}
  } else ids = JSON.parse(await readFile(identityPath, 'utf8'))
  const media = new NativeDownloads(join(root, 'resources'), mediaRoot, {
   readMedia: async () => {
    throw new Error('External media requests are forbidden in this fixture')
   }
  })
  owners.push(media)
  const authRows = await media.request('auth-list')
  check(
   authRows.some((row: {id: string}) => row.id === ids.auth),
   'Production media utilityProcess reads persisted cookie vault'
  )
  if (phase === 'restart')
   check(authRows[0].name === 'fixture updated', 'Cookie update survives Electron process restart')
  await media.request('auth-save', {...cookie, id: ids.auth})
  const jobs = await media.request('list'),
   restored = jobs.find((row: {id: string}) => row.id === ids.job)
  check(restored?.state === 'interrupted', 'Private journal decrypts and recovers through production utilityProcess')
  const privateJob = await readFile(join(mediaRoot, 'native-downloads', ids.job, 'job.dpapi'))
  check(!privateJob.includes(Buffer.from('SYNTHETIC_PRIVATE_JOB')), 'Private journal contains no fixture plaintext')
  check(
   JSON.parse(systemProtect(privateJob, true).toString()).state === 'interrupted',
   'Recovered journal is readable by its parent vault'
  )
  const research = new NativeResearchBackend(
   imRoot,
   async () => {
    throw new Error('Model requests are forbidden in this fixture')
   },
   join(root, 'resources')
  )
  owners.push(research)
  const status = await research.request('im', {action: 'status'}),
   fields = {mode: 'manual', webui_url: 'http://127.0.0.1:3000'}
  if (phase === 'seed') {
   const changed = await research.request('im', {
    action: 'change',
    value: {
     action: 'create',
     expected_revision: status.revision,
     name: 'runtime fixture',
     platform: 'qq_napcat',
     fields,
     secrets: {webui_token: 'SYNTHETIC_RUNTIME_IM'}
    }
   })
   ids.im = changed.connections[0].id
  } else {
   check(
    status.connections.some((row: {id: string}) => row.id === ids.im),
    'IM connection survives Electron process restart'
   )
   await research.request('im', {
    action: 'change',
    value: {
     action: 'update',
     id: ids.im,
     expected_revision: status.revision,
     name: 'runtime restarted',
     platform: 'qq_napcat',
     fields,
     secrets: {onebot_token: 'SYNTHETIC_RUNTIME_SECOND'}
    }
   })
  }
  const db = new Database(join(imRoot, 'im-connections.sqlite3'), {readonly: true})
  try {
   const sealed: Buffer = db.prepare('SELECT sealed FROM connections WHERE id=?').get(ids.im).sealed
   check(!sealed.includes(Buffer.from('SYNTHETIC_RUNTIME_IM')), 'IM database contains no fixture credential plaintext')
   check(
    JSON.parse(systemProtect(sealed, true, 'im').toString()).webui_token === 'SYNTHETIC_RUNTIME_IM',
    'Research utilityProcess preserves encrypted IM credentials'
   )
  } finally {
   db.close()
  }
  if (phase === 'seed') await writeFile(identityPath, JSON.stringify(ids))
  else {
   await media.request('auth-remove', {id: ids.auth, confirmed: true})
   check((await media.request('auth-list')).length === 0, 'Cookie CRUD completes through production utilityProcess')
   const current = await research.request('im', {action: 'status'})
   await research.request('im', {
    action: 'change',
    value: {action: 'delete', id: ids.im, expected_revision: current.revision}
   })
   check(
    (await research.request('im', {action: 'status'})).connections.length === 0,
    'IM CRUD completes through production utilityProcess'
   )
  }
 } catch (error) {
  exitCode = 1
  failure = error instanceof Error ? error.message : 'Unknown fixture failure'
 } finally {
  for (const owner of owners)
   await owner.dispose().catch(() => {
    exitCode = 1
    failure = 'Owner shutdown failed'
   })
  await writeFile(
   join(results, phase + '.json'),
   JSON.stringify(
    {
     status: exitCode ? 'failed' : 'passed',
     phase,
     platform: process.platform,
     arch: process.arch,
     osRelease: release(),
     osProductVersion: process.env.MEIJI_SMOKE_OS_PRODUCT_VERSION,
     electron: process.versions.electron,
     node: process.versions.node,
     backend,
     checks,
     ...(failure ? {error: failure} : {})
    },
    null,
    2
   )
  )
  app.exit(exitCode)
 }
}
const reportPath = join(results, phase + '.json')
void run(root, work, results).catch(async error => {
 await writeFile(
  reportPath,
  JSON.stringify(
   {status: 'failed', phase, error: error instanceof Error ? error.message : 'Fixture initialization failed'},
   null,
   2
  )
 )
 app.exit(1)
})
