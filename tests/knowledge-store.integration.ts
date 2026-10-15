import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { NativeKnowledgeStore } from '../src/main/knowledge-store';
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
export async function verifyNativeKnowledge(directory: string) {
  const root = join(directory, 'native-knowledge'), data = join(root, 'knowledge_base'), chunks = join(data, 'chunks');
  await mkdir(chunks, { recursive: true });
  const entry = { bvid: 'LV' + sha('legacy-source'), title: '原有绪论', text: '旧教材原文：牙釉质结构及组成。', textLength: 18, savedAt: '2025-09-17T12:00:00', folder: '牙体牙髓', source_locator: 'D:/legacy/chapter.pdf', sourceHash: sha('source'), generation_id: 'gen_' + 'a'.repeat(32), source_revision_id: 'rev_' + 'b'.repeat(32), content_hash: '', kb_root_id: 'kbr_' + 'c'.repeat(32), source_kind: 'local_text_v1' };
  entry.content_hash = sha(entry.text); entry.textLength = Array.from(entry.text).length;
  const evidence = 'evi_' + sha(JSON.stringify(['evi', entry.kb_root_id, entry.source_revision_id, { chunk_index: 0 }])).slice(0, 32);
  const entryPath = join(data, entry.bvid + '.json'); await writeFile(entryPath, JSON.stringify(entry));
  const chunk = { ...entry, content: entry.text, chunkIndex: 0, totalChunks: 1, evidence_id: evidence };
  await writeFile(join(chunks, entry.bvid + '_0.json'), JSON.stringify(chunk));
  const legacy = new Database(join(root, 'knowledge.sqlite'));
  legacy.exec(`CREATE TABLE kb_generation_catalog(kb_root_id TEXT,source_id TEXT,generation_id TEXT,source_revision_id TEXT,source_kind TEXT,source_locator TEXT,entry_filename TEXT,content_hash TEXT,published_at TEXT); CREATE TABLE kb_delete_tombstones(kb_root_id TEXT,source_id TEXT); CREATE TABLE kb_evidence_membership(evidence_id TEXT,kb_root_id TEXT,source_id TEXT,generation_id TEXT,source_revision_id TEXT,chunk_index INTEGER,content_digest TEXT,retired INTEGER);`);
  legacy.prepare('INSERT INTO kb_generation_catalog VALUES(?,?,?,?,?,?,?,?,?)').run(entry.kb_root_id, entry.bvid, entry.generation_id, entry.source_revision_id, entry.source_kind, entry.source_locator, entry.bvid + '.json', entry.content_hash, entry.savedAt);
  legacy.prepare('INSERT INTO kb_evidence_membership VALUES(?,?,?,?,?,?,?,?)').run(evidence, entry.kb_root_id, entry.bvid, entry.generation_id, entry.source_revision_id, 0, sha(entry.text), 0);
  legacy.close(); const before = await readFile(entryPath);
  let store = new NativeKnowledgeStore(root);
  try {
    assert.deepEqual(await store.importLegacyBaseline(), { imported: 1, citations: 1 });
    assert.equal(store.citation(evidence).generation_id, entry.generation_id); assert.equal(store.citation(evidence).content, entry.text);
    assert.deepEqual(await readFile(entryPath), before);
    assert.equal(store.search('牙釉质').hits[0].evidence_id, evidence); assert.equal(store.search('牙釉质', []).hits.length, 0);
    const text = '新的课程字幕：牙釉质具有釉柱结构。', request = { title: '新分集', locator: 'https://www.bilibili.com/video/BV1Q5HXzuEJX/?p=2', text, sourceHash: sha(text), category: '课程', expectedGeneration: null };
    const added = store.import(request); assert.equal(added.unchanged, false);
    assert.equal(store.import(request).unchanged, true);
    const citation = store.search('釉柱结构').hits[0]; assert.ok(citation);
    assert.throws(() => store.import({ ...request, text: '旧任务试图覆盖', sourceHash: sha('old') }), /已有更新/);
    assert.equal(store.read(added.entry.bvid).text, text);
    assert.throws(() => store.organize([{ id: added.entry.bvid, generation: added.entry.generation_id }, { id: entry.bvid, generation: 'stale' }], '错误分类'), /已改变/);
    assert.equal(store.list().entries.find(row => row.bvid === added.entry.bvid)?.folder, '课程');
    store.organize([{ id: added.entry.bvid, generation: added.entry.generation_id }], '移动后');
    assert.equal(store.citation(citation.evidence_id).digest, citation.digest);
    const updated = store.import({ ...request, text: '更新的课程正文', sourceHash: sha('updated'), expectedGeneration: added.entry.generation_id });
    assert.notEqual(updated.entry.generation_id, added.entry.generation_id); assert.throws(() => store.citation(citation.evidence_id), /已改变/);
    const selection = { type: '教育', topic: '绪论', subtopics: ['教材定义'], difficulty: '入门', duration: 'unknown', language: '中文', keywords: ['定义'] };
    const draft = store.classificationRead(updated.entry.bvid); store.classificationSave(draft.token, selection);
    assert.equal(store.list().entries.find(row => row.bvid === updated.entry.bvid)?.classification?.type, '教育');
    const staleDraft = store.classificationRead(updated.entry.bvid);
    store.import({ ...request, text: '再次修改正文', sourceHash: sha('newest'), expectedGeneration: updated.entry.generation_id });
    assert.throws(() => store.classificationSave(staleDraft.token, selection), /已改变/);
    store.close(); store = new NativeKnowledgeStore(root);
    assert.equal(store.read(updated.entry.bvid).text, '再次修改正文'); assert.deepEqual(await store.importLegacyBaseline(), { imported: 1, citations: 1 });
    store.delete(entry.bvid); assert.throws(() => store.citation(evidence), /已改变/);
    assert.equal(store.list().stats.totalVideos, 1);
  } finally { store.close(); }
  const blockedRoot = join(directory, 'native-knowledge-blocked'); await mkdir(join(blockedRoot, 'knowledge_base/.bilisum-publish-journal'), { recursive: true });
  await writeFile(join(blockedRoot, 'knowledge_base/.bilisum-publish-journal/pending.json'), '{}');
  const blocked = new NativeKnowledgeStore(blockedRoot);
  try { await assert.rejects(blocked.importLegacyBaseline(), /未完成发布/); assert.equal(blocked.list().stats.totalVideos, 0); } finally { blocked.close(); }
  return ['旧知识库基线和引用身份', '关键词及课程范围', '幂等导入', '旧任务覆盖拒绝', '整批移动事务回滚', '新版本失效旧引用', '重启资料保留', '删除引用级联', '待恢复发布不迁移', '分类保存与过期草稿拒绝'];
}
