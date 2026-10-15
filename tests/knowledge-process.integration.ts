import { app } from 'electron';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { KnowledgeBase } from '../src/main/knowledge';
import type { KnowledgeHit } from '../src/shared/knowledge';
const root = process.cwd(), output = join(root, 'test-results/native-knowledge-' + randomUUID());
void (async () => {
  await mkdir(output, { recursive: true }); app.setPath('userData', output); await app.whenReady();
  let abort: AbortController | undefined;
  const knowledge = new KnowledgeBase(join(root, 'resources'), join(output, 'data'), message => { console.log(message); abort?.abort(); });
  try {
    const imported: { entry: { bvid: string; generation_id: string } }[] = [];
    for (const [index, text] of ['自行车车轮修理：先检查轮胎是否漏气，再检查轮轴和刹车。', '天气预报介绍下雨和气温变化，出门携带雨伞。', '咖啡制作需要研磨咖啡豆，使用热水冲泡。'].entries()) imported.push(await knowledge.request('import', { title: '隔离检索资料' + index, text, locator: 'isolated://document/' + index, sourceHash: createHash('sha256').update(text).digest('hex') }));
    assert.equal((await knowledge.list()).stats.totalVideos, 3);
    await knowledge.request('vector-enable'); await knowledge.request('vector-rebuild');
    const result = await knowledge.search('怎样修好自行车车轮'); assert.equal(result.trace.vector?.state, 'ready'); assert.equal(result.hits[0].bvid, imported[0].entry.bvid); await knowledge.verify(result.hits);
    const filtered = await knowledge.search('自行车', [imported[1].entry.bvid]); assert.ok(filtered.hits.every(hit => hit.bvid === imported[1].entry.bvid));
    const first = await knowledge.request<{ token: string }>('classification-read', { id: imported[0].entry.bvid });
    await knowledge.request('classification-save', { token: first.token, selection: { type: '教程', topic: '自行车维修', subtopics: ['车轮'], difficulty: '入门', duration: 'unknown', language: '中文', keywords: ['自行车'] } });
    assert.equal((await knowledge.list()).entries.find(entry => entry.bvid === imported[0].entry.bvid)?.classification?.topic, '自行车维修');
    abort = new AbortController(); await assert.rejects(knowledge.request('vector-rebuild', {}, abort.signal), /取消/); abort = undefined;
    assert.equal((await knowledge.request<{ index: string }>('vector-status')).index, 'ready');
    const changedText = '自行车车轮资料已更新：新的隔离测试版本';
    await knowledge.request('import', { title: '隔离检索资料0', text: changedText, locator: 'isolated://document/0', sourceHash: createHash('sha256').update(changedText).digest('hex'), expectedGeneration: imported[0].entry.generation_id });
    assert.equal((await knowledge.request<{ index: string }>('vector-status')).index, 'stale');
    await assert.rejects(knowledge.request<KnowledgeHit>('citation', { evidenceId: result.hits[0].evidence_id }), /已改变/);
    const current = await knowledge.search('自行车'); assert.equal(current.trace.vector?.state, 'stale'); assert.ok(current.hits.some(hit => hit.content === changedText));
    const report = { realUtilityProcess: true, offlineBgeInference: true, semanticRetrieval: true, sourceFiltering: true, nativeClassification: true, cancelledRebuildPreservesIndex: true, restartRecovery: true, updatedSourceInvalidatesCitation: true, staleIndexUsesCurrentKeywords: true };
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, output }));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { knowledge.dispose(); app.exit(Number(process.exitCode || 0)); }
})();
