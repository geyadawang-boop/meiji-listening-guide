import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { canonicalJson, discussionDigest, discussionPolicy, DiscussionStore, type DiscussionPack } from '../src/main/discussion-evidence';

export function verifyDiscussionStore(directory: string) {
  const root = join(directory, 'discussion-store'), store = new DiscussionStore(root);
  const packet = (text = '参考原书中的定义'): DiscussionPack => ({ schema: 'video-discussion-v1', bvid: 'BV1Q5HXzuEJX', cid: 200, page: 2, fetched_at: 1, classification_method: 'heuristic_candidates_v1', policy: discussionPolicy,
    coverage: { comments: { status: 'partial', complete: false, errors: [] }, danmaku: { status: 'empty', complete: false, errors: [] }, items_truncated: false },
    items: [{ id: 'comment:1', kind: 'comment', text, text_sha256: discussionDigest(text), labels: ['supplement'], score: 3, selected: false, verification: 'unverified', reviewed: false, note: '', url: 'https://www.bilibili.com/video/BV1Q5HXzuEJX/#reply1' }] });
  const first = store.save(packet()), changes = [{ id: 'comment:1', selected: true, label: 'supplement', note: '人工选择，尚未核实' }];
  assert.throws(() => store.select(first.ref, [...changes, ...changes]), /选择无效/);
  const reviewed = store.select(first.ref, changes);
  assert.ok(reviewed.text.includes('未核实')); assert.ok(reviewed.text.includes('人工选择，尚未核实'));
  assert.throws(() => store.select(first.ref, changes), /已有更新/);
  const restart = new DiscussionStore(root), readAgain = restart.save(packet());
  assert.equal(readAgain.items[0].selected, true); assert.equal(readAgain.items[0].reviewed, true);
  const changed = restart.save(packet('相同编号但正文已改变'));
  assert.equal(changed.items[0].selected, false); assert.equal(changed.items[0].reviewed, false);
  assert.throws(() => restart.select(changed.ref, [{ ...changes[0], selected: false }]), /至少选择/);
  // Old Python canonical JSON retains .0 for integral floats. Verify its hash
  // against the stored bytes, rather than silently reserializing and invalidating it.
  const legacy = packet('旧版中文记录'), payload = canonicalJson(legacy).replace('"score":3,', '"score":3.0,');
  const normalized = process.platform === 'win32' ? resolve(root, 'knowledge_base').toLowerCase() : resolve(root, 'knowledge_base');
  const rootId = 'kbr_' + discussionDigest(['kbr', normalized]).slice(0, 32);
  const ref = createHash('sha256').update('[' + JSON.stringify(rootId) + ',' + payload + ']').digest('hex');
  const db = new Database(join(root, 'cache/video-discussion/evidence.sqlite3'));
  try {
    db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,?)').run(ref, rootId, legacy.bvid, legacy.cid, legacy.page, payload);
    db.prepare('INSERT OR REPLACE INTO heads VALUES(?,?,?,?,?)').run(rootId, legacy.bvid, legacy.cid, legacy.page, ref);
  } finally { db.close(); }
  const legacyResult = new DiscussionStore(root).select(ref, changes);
  assert.equal(legacyResult.pack.items[0].text, '旧版中文记录');
  const foreign = new DiscussionStore(join(directory, 'other-root'));
  assert.throws(() => foreign.select(legacyResult.pack.ref, changes), /不存在/);
  return ['讨论事务回滚', '旧快照拒绝', '重启保留人工选择', '正文改变失效旧选择', 'Python小数快照兼容', '讨论来源隔离'];
}
