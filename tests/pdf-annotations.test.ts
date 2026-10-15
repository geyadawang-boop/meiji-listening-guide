import { describe, expect, it } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { executePdfOperation, type PdfBookInfo } from '../src/main/pdf-annotations';

const row = () => ({ id: randomUUID(), page: 2, rect: [10, 20, 80, 15], source: 'focus' as const, quote: '教材中文原文', evidence: '老师说这是重点', extension: false, color: [1, .57, .57], description: '老师重点\n教材中文原文' });
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'meijiang-typescript-pdf-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}
describe('TypeScript PDF incremental annotation backend', () => {
  it('keeps historical batch identities while adding new UI annotations', async () => fixture(async root => {
    const source = join(root, 'legacy.pdf'), output = join(root, 'updated.pdf');
    const doc = await PDFDocument.create(); doc.addPage([300, 400]); doc.addPage([300, 400]);
    const { color, description, ...legacy } = { ...row(), id: '2025-2026-绪论-重点-01' };
    doc.getPage(1).node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Highlight', Rect: [10, 20, 90, 35], NM: PDFHexString.fromText('meijiang:' + legacy.id), MeijiangData: PDFHexString.fromText(JSON.stringify(legacy)) })));
    await writeFile(source, await doc.save());
    const before = await executePdfOperation({ action: 'inspect', path: source }) as PdfBookInfo;
    expect(before.previous[0].id).toBe(legacy.id);
    const addition = { ...row(), rect: [10, 60, 80, 15] };
    await executePdfOperation({ action: 'write', path: source, output, rows: [{ ...before.previous[0], color, description }, addition] });
    expect((await executePdfOperation({ action: 'inspect', path: output }) as PdfBookInfo).previous.map(mark => mark.id)).toEqual([legacy.id, addition.id]);
  }));
  it.each([true, false])('preserves every original byte, Chinese metadata and external annotations (object streams=%s)', async useObjectStreams => fixture(async root => {
    const source = join(root, 'original.pdf'), output = join(root, 'highlight.pdf'), cleared = join(root, 'cleared.pdf');
    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i++) doc.addPage([300, 400]).drawText('Original page ' + i);
    const external = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 20, 20], NM: PDFString.of('external'), Contents: PDFHexString.fromText('保留其他软件批注') }));
    doc.getPage(1).node.addAnnot(external);
    const original = Buffer.from(await doc.save({ useObjectStreams })); await writeFile(source, original);
    const mark = row();
    await executePdfOperation({ action: 'write', path: source, output, rows: [mark] });
    const bytes = await readFile(output); expect(bytes.subarray(0, original.length)).toEqual(original);
    const info = await executePdfOperation({ action: 'inspect', path: output }) as PdfBookInfo;
    expect(info.sizes).toEqual([[300, 400, 0], [300, 400, 0], [300, 400, 0]]);
    expect(info.previous).toEqual([{ id: mark.id, page: mark.page, rect: mark.rect, source: mark.source, quote: mark.quote, evidence: mark.evidence, extension: mark.extension }]);
    const saved = await PDFDocument.load(bytes);
    expect(saved.getPage(1).node.lookup(PDFName.of('Annots'), PDFArray).size()).toBe(2);
    expect(saved.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.size() ?? 0).toBe(0);
    await executePdfOperation({ action: 'write', path: output, output: cleared, rows: [] });
    expect((await readFile(cleared)).subarray(0, bytes.length)).toEqual(bytes);
    const final = await PDFDocument.load(await readFile(cleared));
    const annots = final.getPage(1).node.lookup(PDFName.of('Annots'), PDFArray);
    expect(annots.size()).toBe(1);
    expect(final.context.lookup(annots.get(0), PDFDict).lookup(PDFName.of('Contents'), PDFHexString).decodeText()).toBe('保留其他软件批注');
    expect(await readFile(source)).toEqual(original);
  }));
  it('does not overwrite a pre-existing output or the original PDF', async () => fixture(async root => {
    const source = join(root, 'book.pdf'), output = join(root, 'existing.pdf');
    const doc = await PDFDocument.create(); doc.addPage(); doc.addPage(); await writeFile(source, await doc.save());
    const original = await readFile(source); await writeFile(output, 'existing user file');
    await expect(executePdfOperation({ action: 'write', path: source, output, rows: [row()] })).rejects.toThrow();
    expect(await readFile(output, 'utf8')).toBe('existing user file');
    await expect(executePdfOperation({ action: 'write', path: source, output: source, rows: [] })).rejects.toThrow('不能直接覆盖');
    expect(await readFile(source)).toEqual(original);
  }));
  it('rejects an incomplete final index before producing an output', async () => fixture(async root => {
    const doc = await PDFDocument.create(); doc.addPage();
    const source = join(root, 'damaged.pdf'), output = join(root, 'output.pdf');
    const bytes = Buffer.from(await doc.save()); await writeFile(source, Buffer.concat([bytes, Buffer.from('trailing invalid data')]));
    await expect(executePdfOperation({ action: 'write', path: source, output, rows: [] })).rejects.toThrow('尾部索引');
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
  }));
});
