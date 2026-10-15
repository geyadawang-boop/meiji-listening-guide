import assert from 'node:assert/strict'
import {PDFDocument} from 'pdf-lib'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {NativeResearchFulltext} from '../src/main/research-fulltext'
const root=resolve('test-results');await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'research-fulltext-'))
const pdf=await PDFDocument.create();pdf.addPage([300,400]).drawText('Original source on page one');pdf.addPage([300,400]).drawText('Selected physical page two')
const bytes=await pdf.save();let calls=0,closed=0
const service=new NativeResearchFulltext(async(url)=>{assert.equal(url,'https://arxiv.org/pdf/1706.03762v7');calls++;return {response:new Response(new Uint8Array(bytes),{headers:{'content-type':'application/pdf'}}),close:async()=>{closed++}}})
const rows=await service.read(['arxiv','arxiv_fulltext'],[{url:'https://arxiv.org/abs/1706.03762v7',pages:[2]}],new AbortController().signal)
assert.equal(rows.length,1);assert.equal(rows[0].page,2);assert.equal(rows[0].totalPages,2);assert.match(rows[0].text,/Selected physical page two/);assert.doesNotMatch(rows[0].text,/page one/);service.verify(rows);assert.equal(calls,1);assert.equal(closed,1)
await assert.rejects(()=>service.read(['arxiv','arxiv_fulltext'],[{url:'https://arxiv.org/abs/1706.03762v7',pages:[3]}],new AbortController().signal),/不存在/)
const cancelled=new AbortController();cancelled.abort();await assert.rejects(()=>service.read(['arxiv','arxiv_fulltext'],[{url:'https://arxiv.org/abs/1706.03762v7',pages:[1]}],cancelled.signal))
const report={realPdfTextExtraction:true,syntheticPaperOnly:true,explicitPhysicalPagesOnly:true,fixedArxivVersion:true,pageCountAndByteHash:true,outOfRangeRefused:true,preCancellation:true,noTemporaryPaperWritten:true,realExternalServiceTested:false,completeMigration:false}
await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,...report}))
