import {readdir, readFile, writeFile} from 'node:fs/promises'
import {join, resolve, basename} from 'node:path'
import {createHash} from 'node:crypto'
const root = resolve('.'),
 directory = join(root, 'scripts'),
 names = (await readdir(directory, {withFileTypes: true}))
  .filter(entry => entry.isFile() && /\.(?:ts|mts|cts|js|cjs|mjs|py|ps1)$/.test(entry.name))
  .map(entry => entry.name)
  .sort()
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {scripts: Record<string, string>},
 bodies = new Map<string, string>()
for (const name of names) bodies.set(name, await readFile(join(directory, name), 'utf8'))
const direct = new Set<string>()
for (const command of Object.values(pkg.scripts))
 for (const match of command.matchAll(/scripts[/\\]([^\s"']+)/g)) if (names.includes(match[1])) direct.add(match[1])
const edges = new Map<string, string[]>()
for (const [name, text] of bodies)
 edges.set(
  name,
  names.filter(
   target =>
    target !== name &&
    new RegExp(`(?:[/'"\\\\])${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:['"\x60\s]|$)`).test(text)
  )
 )
const active = new Set(direct),
 queue = [...direct]
while (queue.length) {
 for (const next of edges.get(queue.shift()!) || [])
  if (!active.has(next)) {
   active.add(next)
   queue.push(next)
  }
}
const records = names.map(name => ({
 path: 'scripts/' + name,
 sha256: createHash('sha256').update(bodies.get(name)!).digest('hex'),
 bytes: Buffer.byteLength(bodies.get(name)!),
 language: /\.(?:ts|mts|cts)$/.test(name)
  ? 'typescript'
  : name.endsWith('.py')
    ? 'python'
    : name.endsWith('.ps1')
      ? 'powershell'
      : 'javascript',
 npmReachable: active.has(name),
 directNpmEntrypoint: direct.has(name),
 referencedBy: [...edges].filter(([, targets]) => targets.includes(name)).map(([name]) => name),
 references: edges.get(name),
 review: active.has(name) ? 'active-entrypoint' : 'not-proven-active-do-not-delete',
 legacyResourceReferences: [
  ...new Set(
   (bodies.get(name)!.match(/resources[/\\](?:asr|knowledge|pdf|video)[^'"\x60\r\n)]*/g) || []).map(value =>
    value.slice(0, 300)
   )
  )
 ]
}))
const report = {
 updatedAt: new Date().toISOString(),
 scope: '静态 npm 入口及脚本文本依赖图；外部手动调用和动态路径仍须复核，不以未引用为删除授权',
 activeEntrypoints: [...direct],
 activeLegacy: records.filter(row => row.npmReachable && row.language !== 'typescript'),
 counts: {
  total: records.length,
  npmReachable: records.filter(row => row.npmReachable).length,
  remainingLegacy: records.filter(row => row.language !== 'typescript').length
 },
 records
}
await writeFile(join(root, 'TypeScript维护脚本清单.json'), JSON.stringify(report, null, 2) + '\n')
console.log(
 JSON.stringify({
  counts: report.counts,
  activeEntrypoints: report.activeEntrypoints,
  activeLegacy: report.activeLegacy.map(row => row.path),
  filesDeleted: 0,
  scriptContentsNotExecuted: true
 })
)
