import {readdir, readFile, writeFile, lstat} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
import ts from 'typescript'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
 require = createRequire(import.meta.url)
async function files(directory: string): Promise<string[]> {
 const result: string[] = []
 for (const entry of await readdir(directory, {withFileTypes: true})) {
  if (entry.isSymbolicLink()) throw new Error('语言审查不跟随目录链接')
  const path = join(directory, entry.name)
  if (entry.isDirectory()) result.push(...(await files(path)))
  else result.push(path)
 }
 return result
}
const sourceFiles = await files(join(root, 'src')),
 maintenance = await files(join(root, 'scripts'))
const authoredNonTypescript = sourceFiles.filter(path => /\.(?:[cm]?js|py|java)$/.test(path)).map(path => relative(root, path))
const legacyLaunches: {file: string; line: number; literal: string}[] = []
for (const path of sourceFiles.filter(path => /\.tsx?$/.test(path))) {
 const text = await readFile(path, 'utf8'),
  file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
 function visit(node: ts.Node) {
  if (ts.isStringLiteralLike(node) && /(?:^|[\\/])(?:python(?:w)?(?:\.exe)?|yt-dlp(?:\.exe)?|[^\\/]+\.py)(?:$|[\\/])/i.test(node.text)) legacyLaunches.push({file: relative(root, path).replaceAll('\\', '/'), line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, literal: node.text})
  ts.forEachChild(node, visit)
 }
 visit(file)
}
const installed = resolve(root, '../梅酱的听课指南-副本'),
 runtimeFiles = await files(join(installed, 'resources')),
 forbidden = /\.(?:py|pyc|pyo)$|(?:^|[\\/])(?:python(?:w)?\.exe|yt-dlp\.exe)(?:$|[\\/])/i
const foreignRuntimeFiles = runtimeFiles.filter(path => forbidden.test(path)).map(path => relative(installed, path))
const asar = join(installed, 'resources/app.asar')
await lstat(asar)
const packagedFiles = require('@electron/asar').listPackage(asar) as string[],
 foreignAsarFiles = packagedFiles.filter(path => forbidden.test(path))
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {version: string; scripts: Record<string, string>}
const commands = Object.entries(packageJson.scripts).map(([name, command]) => ({name, command, legacyInterpreter: /\bpython(?:w|3)?\b|yt-dlp|scripts[/\\][^\s]+\.(?:cjs|mjs|js|py)\b/i.test(command)}))
const ledgerPath = join(root, 'TypeScript迁移清单.json'),
 ledgerBefore = await readFile(ledgerPath, 'utf8')
const report = {
 updatedAt: new Date().toISOString(),
 version: packageJson.version,
 scope: '静态语言及已安装资源审查；不代表所有功能或真实站点已经验收',
 application: {typescriptFiles: sourceFiles.filter(path => /\.tsx?$/.test(path)).length, authoredNonTypescript, legacyLaunches},
 packageScripts: commands,
 maintenanceScripts: {
  typescript: maintenance.filter(path => /\.(?:ts|mts|cts)$/.test(path)).length,
  javascript: maintenance.filter(path => /\.(?:js|cjs|mjs)$/.test(path)).length,
  python: maintenance.filter(path => /\.py$/.test(path)).length,
  powershell: maintenance.filter(path => /\.ps1$/.test(path)).length,
  note: '历史维护脚本单独计数，不删除或伪称已完成迁移'
 },
 installed: {directory: installed, files: runtimeFiles.length, foreignRuntimeFiles, foreignAsarFiles},
 staticGatePassed: !authoredNonTypescript.length && !legacyLaunches.length && !foreignRuntimeFiles.length && !foreignAsarFiles.length && !commands.some(command => command.legacyInterpreter),
 functionalCompletion: JSON.parse(ledgerBefore).complete === true,
 migrationLedgerPreserved: true
}
await writeFile(join(root, 'TypeScript语言审查记录.json'), JSON.stringify(report, null, 2) + '\n')
if ((await readFile(ledgerPath, 'utf8')) !== ledgerBefore) throw new Error('迁移清单在审查过程中改变，未回写或覆盖')
console.log(JSON.stringify({staticGatePassed: report.staticGatePassed, functionalCompletion: report.functionalCompletion, maintenanceScripts: report.maintenanceScripts, application: report.application, foreignRuntimeFiles, foreignAsarFiles}))
if (process.argv.includes('--check') && !report.staticGatePassed) process.exitCode = 1
