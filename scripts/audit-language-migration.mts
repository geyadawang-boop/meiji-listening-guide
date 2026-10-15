import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function files(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('迁移清单不跟随目录链接');
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}
const entrypoints = ['resources/knowledge/worker.py', 'resources/knowledge/media-worker.py', 'resources/knowledge/tools-worker.py', 'resources/asr/worker.py'];
const workers = [];
for (const entry of entrypoints) {
  const source = await readFile(join(root, entry), 'utf8');
  const actions = new Set([...source.matchAll(/\baction\s*==\s*['"]([^'"]+)['"]/g)].map(match => match[1]));
  for (const match of source.matchAll(/\baction\s+in\s*\(([^\n)]+)\)/g)) for (const quoted of match[1].matchAll(/['"]([^'"]+)['"]/g)) actions.add(quoted[1]);
  const nativeKnowledge = entry.endsWith('/worker.py') && entry.includes('/knowledge/');
  const migratedActions = nativeKnowledge || entry.includes('/asr/') ? [...actions].sort() : entry.endsWith('/media-worker.py') ? ['options', 'bili-browse', 'discussion', 'discussion-select', 'visual-frames', 'visual-cancel', 'visual-cleanup','catalog','create','list','retry','cancel','file'] : [...actions].filter(action=>action!=='im');
  workers.push({ entrypoint: entry, explicitActions: [...actions].sort(), migratedActions, status: nativeKnowledge || entry.includes('/asr/') ? 'migrated-source-runtime-verified' : migratedActions.length ? 'partial' : 'pending' });
}
const launchSites = [];
for (const path of await files(join(root, 'src'))) {
  if (!/\.tsx?$/.test(path)) continue;
  const source = await readFile(path, 'utf8');
  const matches = source.split('\n').map((line, index) => ({ line: index + 1, code: line.trim() })).filter(row => /python\.exe|worker\.py|annotations\.py/.test(row.code));
  if (matches.length) launchSites.push({ file: relative(root, path).replaceAll('\\', '/'), matches });
}
const scripts = await files(join(root, 'scripts'));
const report = {
  updatedAt: new Date().toISOString(), target: 'TypeScript application source, no Python runtime or Python-backed executables', complete: false,
  migrated: ['教材 PDF 检查及可编辑批注：TypeScript 增量保存', 'B站二维码生成：TypeScript 本地编码', 'B站热门/搜索：TypeScript 官方接口及 WBI 签名', '评论/弹幕：TypeScript 采集、SQLite人工选择与旧快照兼容', '构建发布/资源清单/集成测试入口：严格类型检查的 TypeScript', '本地转写：TypeScript独立进程、Whisper Small ONNX、VAD、取消、原时间点', '画面提取：TypeScript与FFmpeg，变化优先/时间覆盖、取消与成果后清理', '知识库：TypeScript独立进程、SQLite全文与本地BGE语义检索', '媒体下载与研究后台已接原生入口，实际窗口来源目录/会话按钮通过；所有功能与发行物仍未完成'],
  nativeConnectedButNotFullyAccepted: ['B站原生目录/下载队列/字幕封面章节/断点取消/哈希清理，真实站点下载尚待验收', '原生研究来源/上下文/笔记/记忆/MCP/工作流；题录摘要网页片段为受控网络验证', '媒体守护进程：实际杀掉调用者后停止FFmpeg，活动取消通过', '源码不存在Python启动点；旧资源仍保留，静态数量不等于完整替换完成'],
  workers, launchSites,
  maintenanceScripts: { typescript: scripts.filter(path => /\.(?:ts|mts|cts)$/.test(path)).length, javascript: scripts.filter(path => /\.(?:js|cjs|mjs)$/.test(path)).length, python: scripts.filter(path => /\.py$/.test(path)).length, powershell: scripts.filter(path => /\.ps1$/.test(path)).length },
  nativeDependencies: ['Electron / Node.js', 'FFmpeg / FFprobe', '模型连接 CLI'],
  mustReplace: ['通讯后台、旧研究/扩展完整适配及原生下载其余选项/多平台', 'yt-dlp.exe (包含 Python，不能计入无 Python 完成状态)', '网页/论文正文与旧方法/MCP只读适配已新增，仍待真实服务及其余兼容验收', '活跃维护脚本与完整发行物验收', '发行物中的旧ASR/PDF/knowledge Python资源，最终替代发布验证后移除'],
  releaseGate: ['旧知识库版本/引用/分类兼容', '持久任务恢复与用户成果保护', '完整字幕时长及媒体下载等价', '模型真实离线推理', '最终程序启动和原生界面', '发行清单及源码语言审查'],
};
await writeFile(join(root, 'TypeScript迁移清单.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ complete: false, workers: workers.map(worker => ({ entrypoint: worker.entrypoint, actions: worker.explicitActions.length })), remainingLaunchFiles: launchSites.length, maintenanceScripts: report.maintenanceScripts }));



