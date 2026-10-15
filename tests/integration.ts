import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdir,writeFile,stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { Document,Paragraph,Packer } from 'docx'
import iconv from 'iconv-lite'
import { Store } from '../src/main/db'
import { verifyDiscussionStore } from './discussion-store.integration'
import { verifyNativeKnowledge } from './knowledge-store.integration'
import { Workflows } from '../src/main/workflows'
import { parseDocument, importDocument } from '../src/main/documents'
import { parseSrt,mergeSegments } from '../src/shared/srt'
import { readTranscript } from '../src/main/transcript'
import type { SettingsStore } from '../src/main/settings'
import type { Api } from '../src/main/api'
const root=join(process.cwd(),'test-results','integration-'+Date.now());await mkdir(root,{recursive:true})
const db=new Store(root),a=db.createCourse('解剖学'),b=db.createCourse('牙周病学')
try {
  console.log(JSON.stringify({discussionStorePassed:verifyDiscussionStore(root)}))
  console.log(JSON.stringify({nativeKnowledgeStorePassed:await verifyNativeKnowledge(root)}))
  await writeFile(join(root,'gbk.txt'),iconv.encode('老师说牙釉质结构这个必考。','gbk'))
  assert.equal((await parseDocument(join(root,'gbk.txt'))).text,'老师说牙釉质结构这个必考。')
  await writeFile(join(root,'notes.docx'),await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('学长笔记：牙釉质结构')]}]})))
  assert.ok((await parseDocument(join(root,'notes.docx'))).text.includes('牙釉质结构'))
  // Minimal valid text PDF plus a blank-page PDF, both parsed by the bundled PDF.js.
  const pdf=(text:string)=> {
    const stream=text?`BT /F1 12 Tf 30 100 Td (${text}) Tj ET`:''
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
    let out='%PDF-1.4\n';const offsets=[0];objects.forEach((v,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${v}\nendobj\n`});const start=out.length;out+=`xref\n0 6\n0000000000 65535 f \n`+offsets.slice(1).map(v=>`${String(v).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return out
  }
  await writeFile(join(root,'text.pdf'),pdf('A complete lecture document with extractable classroom text.'))
  await writeFile(join(root,'scan.pdf'),pdf(''))
  assert.equal((await parseDocument(join(root,'text.pdf'))).needsOcr,false)
  assert.equal((await parseDocument(join(root,'scan.pdf'))).needsOcr,true)
  const file=await importDocument(root,a.id,'past_exam',join(root,'gbk.txt'));db.insertFile(file)
  const id=randomUUID(),unrelated=randomUUID()
  db.replaceQuestions(a.id,file.id,[{id,courseId:a.id,sourceFile:file.filename,type:'简答',stem:'牙釉质结构包含什么？',knowledgePoints:['牙釉质结构']},{id:unrelated,courseId:a.id,sourceFile:file.filename,type:'简答',stem:'牙周手术步骤是什么？',knowledgePoints:['牙周手术']}])
  assert.equal(db.detail(b.id).questions.length,0)
  assert.throws(()=>db.saveQuestions(b.id,db.detail(a.id).questions))
  const lecture=db.createLecture(a.id,'第1讲',join(process.cwd(),'test-results','classroom.mp4'),'','')
  assert.throws(()=>db.message(b.id,lecture.id,'user','越界'))
  const srt='1\n00:00:01,000 --> 00:00:03,000\n【老师】牙釉质结构这个必考。\n\n2\n00:00:04,000 --> 00:00:06,000\n【老师】牙周手术这个不考。\n'
  db.saveSubtitles(lecture.id,parseSrt(srt))
  const mockSettings={get:()=>({maxMinutes:45,maxGB:1.5,compress:true}),prompt:(name:string)=>name,searchKey:()=> 'local-test'} as unknown as SettingsStore
  const calls:string[]=[]
  const mockApi={json:async(prompt:string,input:any,validate:(v:unknown)=>unknown)=> {
    calls.push(prompt)
    if(input.selfPractice)return validate(Array.from({length:5},(_,i)=>({stem:`牙釉质的课堂自测问题 ${i+1}`,type:'简答',topic:'牙釉质结构',reason:'依据本课字幕',answer:'釉柱',explanation:'依据教师讲授的牙釉质结构'})))
    if(prompt==='notes')return validate({keyPoints:[{level:'必考',topic:'牙釉质结构',detail:'掌握结构',quote:'牙釉质结构这个必考。',timestamp:'00:00:01'}],notTested:[{topic:'牙周手术',quote:'牙周手术这个不考。',timestamp:'00:00:04'}],uncertain:[]})
    if(prompt==='match'){assert.equal(input.questions.length,1);return validate([{id,topic:'牙釉质结构',reason:'本课必考'}])}
    if(prompt==='search')return validate([{stem:'牙釉质由哪些主要结构组成？',type:'简答',topic:'牙釉质结构',reason:'同一知识点',sourceUrl:'https://example.test/actual'},{stem:'这道题根本不在网页中。',type:'简答',topic:'牙釉质结构',reason:'编造',sourceUrl:'https://example.test/actual'}])
    throw new Error('unexpected prompt')
  }} as unknown as Api
  const workflows=new Workflows(db,mockSettings,mockApi,()=>{})
  await workflows.notes(lecture.id)
  globalThis.fetch=async()=>new Response(JSON.stringify({results:[{url:'https://example.test/actual',raw_content:'练习：牙釉质由哪些主要结构组成？'}]}),{headers:{'Content-Type':'application/json'}})
  const set=await workflows.practice(lecture.id,undefined,true)
  assert.equal(set.past.length,1);assert.equal(set.past[0].id,id);assert.equal(set.extended.length,1);assert.equal(set.extended[0].sourceUrl,'https://example.test/actual');assert.equal(set.shortage,0)
  db.saveSubtitles(lecture.id,parseSrt(srt));assert.equal(db.lectureDetail(lecture.id).notes,null);assert.equal(db.lectureDetail(lecture.id).practice,null)
  const original=join(root,'original.docx');await writeFile(original,await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('00:00:01 牙油质结构是重点。'),new Paragraph('00:00:05 牙周手术这个不考。')]}]})))
  const parsed=await readTranscript(original);assert.equal(parsed.segments.length,2);assert.equal(parsed.segments[0].start,1000);assert.ok(parsed.text.includes('牙油质'))
  db.removeFile(a.id,file.id);assert.equal(db.detail(a.id).questions.length,0)
  console.log(JSON.stringify({passed:['GBK 识别','DOCX 文本解析','PDF 文本解析','扫描 PDF 标记','课程数据隔离','跨课程拒绝','无关历年题排除','网上题原文核验','伪造拓展题拒绝','修改字幕失效旧结果','Word 原文读取','原文时间点解析','资料删除级联'],calls}))
}finally{db.close()}
