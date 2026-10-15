import { _electron as electron } from 'playwright';
import { PDFDocument, PDFArray, PDFName } from 'pdf-lib';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'test-results', 'typescript-migration-' + randomUUID()), data = join(output, 'data');
await mkdir(data, { recursive: true });
const document = await PDFDocument.create(); document.addPage([300, 400]).drawText('Isolated textbook');
const original = Buffer.from(await document.save()), bookPath = join(output, 'book.pdf');
await writeFile(bookPath, original);
const fixture = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  let code = 0, data: unknown;
  if (url.pathname.endsWith('/nav')) {
    code = -101; data = { isLogin: false, wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/0123456789abcdef0123456789abcdef.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/fedcba9876543210fedcba9876543210.png' } };
  } else if (url.pathname.endsWith('/generate')) data = { qrcode_key: 'isolated', url: 'https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=isolated' };
  else if (url.pathname.endsWith('/poll')) data = { code: 86101 };
  else if (url.pathname.endsWith('/popular')) data = { list: [{ bvid: 'BV1Q5HXzuEJX', title: '隔离热门视频', owner: { name: '隔离老师' }, duration: 120 }] };
  else if (url.pathname.endsWith('/type')) data = { result: [{ bvid: 'BV1Q5HXzuEJX', title: '<em>口腔</em> &amp; 学习', author: '隔离老师', duration: '2:00' }], numPages: 3 };
  else if (url.pathname.endsWith('/view')) data = { bvid: 'BV1Q5HXzuEJX', aid: 42, desc: '隔离作者介绍', owner: { mid: 99 }, pages: [{ page: 1, cid: 100, duration: 20 }, { page: 2, cid: 200, duration: 720 }] };
  else if (url.pathname === '/x/v2/reply') data = { replies: [{ rpid_str: '111', member: { uname: '隔离观众' }, content: { message: '补充参考教材原文' }, rcount: 0 }], page: { count: 1, size: 20 } };
  else if (url.pathname.endsWith('/seg.so')) { response.setHeader('Content-Type', 'application/octet-stream'); response.end('<i><d p="12,1,25,0,42,0,x,55">隔离补充弹幕</d></i>'); return; }
  else { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ code, data }));
});
await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve));
const address = fixture.address(); assert.ok(address && typeof address !== 'string');
const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), LISTENING_ASSISTANT_DATA: data, LISTENING_ASSISTANT_BILI_FIXTURE: `http://127.0.0.1:${address.port}` };
delete env.ELECTRON_RUN_AS_NODE;
let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  app = await electron.launch({ executablePath: join(root, 'node_modules/electron/dist/electron.exe'), args: [root], env, timeout: 45000 });
  let page;
  for (let i = 0; i < 120 && !page; i++) { page = app.windows().find(window => window.url().includes('/out/renderer/')); if (!page) await new Promise(resolve => setTimeout(resolve, 250)); }
  assert.ok(page, '源码窗口未启动');
  await page.waitForFunction(() => !!(window as unknown as { assistant?: unknown }).assistant);
  const downloadChoices = await page.evaluate(async () => (window as unknown as { assistant: { invoke(action: string): Promise<{ defaults: { use_cookies: boolean; filename_template: string }; heights: number[] }> } }).assistant.invoke('media:options'));
  assert.equal(downloadChoices.defaults.use_cookies, false); assert.ok(downloadChoices.heights.includes(1080)); assert.ok(downloadChoices.defaults.filename_template.endsWith('.%(ext)s'));
  await page.locator('.app-icon-rail').getByRole('button', { name: '视频资源', exact: true }).click();
  const panel = page.getByRole('region', { name: '视频资源', exact: true });
  await panel.getByRole('button', { name: '扫码登录 B 站', exact: true }).click();
  await panel.locator('img').first().waitFor();
  await panel.locator('img').first().scrollIntoViewIfNeeded();
  await panel.locator('img').first().evaluate(image => { assertImage(image as HTMLImageElement); function assertImage(image: HTMLImageElement) { if (!image.complete || !image.naturalWidth) throw Error('二维码图片未能渲染'); } });
  const result = await page.evaluate(async () => {
    const assistant = (window as unknown as { assistant: { invoke(action: string, args: unknown): Promise<unknown> } }).assistant;
    return { popular: await assistant.invoke('bili-resources:browse', { kind: 'popular', page: 1 }), search: await assistant.invoke('bili-resources:browse', { kind: 'search', query: '口腔', page: 2 }) };
  });
  assert.equal((result.popular as { videos: { title: string }[] }).videos[0].title, '隔离热门视频');
  assert.equal((result.search as { videos: { title: string }[]; page: number }).videos[0].title, '口腔 & 学习');
  assert.equal((result.search as { page: number }).page, 2);
  const discussion = await page.evaluate(async () => (window as unknown as { assistant: { invoke(action: string, args: unknown): Promise<{ page: number; cid: number; items: { kind: string; selected: boolean }[] }> } }).assistant.invoke('media:discussion', { url: 'https://www.bilibili.com/video/BV1Q5HXzuEJX/?p=2', pages: 1 }));
  assert.equal(discussion.page, 2); assert.equal(discussion.cid, 200); assert.ok(discussion.items.some(item => item.kind === 'comment')); assert.ok(discussion.items.every(item => !item.selected));
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, bookPath);
  const selected = await page.evaluate(async () => (window as unknown as { assistant: { invoke(action: string): Promise<{ id: string }> } }).assistant.invoke('textbook:pick'));
  const highlight = { id: randomUUID(), page: 1, rect: [10, 20, 100, 15], source: 'focus', quote: '教材中文', evidence: '教师重点原句', extension: false };
  await page.evaluate(async args => (window as unknown as { assistant: { invoke(action: string, args: unknown): Promise<unknown> } }).assistant.invoke('textbook:manual', args), { id: selected.id, highlight });
  const saved = await readFile(bookPath); assert.ok(saved.subarray(0, original.length).equals(original));
  assert.equal((await PDFDocument.load(saved)).getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).size(), 1);
  assert.ok((await readFile(bookPath + '.划线前备份.pdf')).equals(original));
  await page.evaluate(async args => (window as unknown as { assistant: { invoke(action: string, args: unknown): Promise<unknown> } }).assistant.invoke('textbook:clear', args), { id: selected.id });
  assert.equal((await PDFDocument.load(await readFile(bookPath))).getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).size(), 0);
  const knowledgePath = join(output, 'knowledge.txt'); await writeFile(knowledgePath, '隔离课程资料：牙釉质由釉柱构成，学习时需要核对教材原文。');
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, knowledgePath);
  await page.locator('.app-icon-rail').getByRole('button', { name: '知识库', exact: true }).click();
  const knowledge = page.getByRole('region', { name: '知识库', exact: true });
  await knowledge.getByRole('button', { name: '导入资料', exact: true }).click();
  await knowledge.locator('.knowledge-entry strong').filter({ hasText: 'knowledge.txt' }).waitFor();
  await knowledge.getByRole('button', { name: '启用中文模型', exact: true }).click();
  await knowledge.getByRole('button', { name: '建立语义索引', exact: true }).waitFor();
  await knowledge.getByRole('button', { name: '建立语义索引', exact: true }).click();
  await knowledge.getByText('语义索引已建立', { exact: true }).waitFor();
  const nativeSearch = await page.evaluate(async () => (window as unknown as { assistant: { invoke(action: string, args: unknown): Promise<{ hits: { content: string }[]; trace: { vector?: { state: string } } }> } }).assistant.invoke('knowledge:search', { query: '牙釉质' }));
  assert.equal(nativeSearch.trace.vector?.state, 'ready'); assert.ok(nativeSearch.hits.some(hit => hit.content.includes('釉柱')));
  await page.locator('.app-icon-rail').getByRole('button',{name:'工具与工作流',exact:true}).click();
  const tools=page.getByRole('region',{name:'工具与工作流',exact:true});
  const loaded=await Promise.race([tools.getByRole('heading',{name:'本次资料范围',exact:true}).waitFor().then(()=>''),tools.getByRole('alert').waitFor().then(()=>tools.getByRole('alert').innerText())]);if(loaded)throw new Error('原生工具页面：'+loaded);
  await tools.locator('label.media-check').filter({hasText:'knowledge.txt'}).first().waitFor();
  const nativeTools=await page.evaluate(async()=>{const bridge=(window as unknown as {assistant:{invoke(action:string,args:unknown):Promise<{runtime:{dependencies:{id:string}[]};migration:{complete:boolean}}>} }).assistant;return bridge.invoke('tools:request',{action:'overview'})});
  assert.ok(nativeTools.runtime.dependencies.some(item=>item.id==='typescript'));assert.equal(nativeTools.migration.complete,false);
  await tools.getByRole('checkbox',{name:'所选网页正文',exact:true}).check();
  await tools.getByRole('textbox',{name:'本轮正文网址',exact:true}).fill('https://example.com/article');
  await tools.getByRole('checkbox',{name:'所选论文页',exact:true}).check();
  assert.equal(await tools.getByRole('textbox',{name:'本轮正文网址',exact:true}).inputValue(),'https://example.com/article');
  await tools.getByRole('button',{name:'学习记录',exact:true}).click();
  await tools.getByRole('textbox',{name:'知识会话名称',exact:true}).fill('原生会话按钮检查');
  await tools.getByRole('button',{name:'新建知识会话',exact:true}).click();
  await tools.getByRole('heading',{name:'原生会话按钮检查',exact:true}).waitFor();
  assert.equal(await tools.getByRole('alert').count(),0);
  await page.screenshot({path:join(output,'native-research.png')});
  await page.locator('.app-icon-rail').getByRole('button',{name:'通讯助手',exact:true}).click();
  const communications=page.getByRole('region',{name:'通讯助手',exact:true});await communications.getByRole('textbox',{name:'通讯连接名称',exact:true}).fill('隔离QQ连接');
  await communications.getByRole('button',{name:'添加连接',exact:true}).click();await communications.getByRole('option',{name:'隔离QQ连接',exact:true}).waitFor({state:'attached'});
  await communications.getByRole('button',{name:'开始登录',exact:true}).waitFor();assert.equal(await communications.getByRole('alert').count(),0);
  const component=await page.evaluate(async()=>{const assistant=(window as unknown as {assistant:{invoke(action:string,args:unknown):Promise<{qq_component:{owned_running:boolean}}>} }).assistant;return assistant.invoke('tools:request',{action:'im',args:{action:'status'}})});assert.equal(component.qq_component.owned_running,false);

  assert.equal(await page.locator('iframe,webview').count(), 0);
  await page.screenshot({ path: join(output, 'native-panels.png') });
  const report = { sourceRuntimeVerified: true, nativeDownloadOptionsIPC: true, qrRendered: true, browseSigned: true, discussionNativeCollector: true, nativeKnowledgeButtons: true, nativeResearchPageAndSourceCatalog:true,nativeFulltextSelectionControls:true,nativeConversationCreateButton:true,nativeCommunicationCreateButton:true,noComponentStartedForListing:true, localSemanticSearch: true, editablePdfIncremental: true, originalBackupVerified: true, isolatedMaterialsOnly: true, completeMigration: false };
  await writeFile(join(output, 'report.json'), JSON.stringify(report)); console.log(JSON.stringify({ ...report, output }));
} finally {
  if (app) await app.close();
  await new Promise<void>(resolve => fixture.close(() => resolve()));
}
