import {describe,it,expect} from 'vitest'
import {PDFDocument,PDFArray,PDFDict,PDFName,PDFString,PDFHexString} from 'pdf-lib'
import {randomUUID} from 'node:crypto'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {TextbookHighlighter} from '../src/main/study'
import {checkAt,highlightColors,prioritizedHighlights,type Highlight} from '../src/shared/study'
import {TextbookFiles} from '../src/main/textbook-files'
const row=(source:Highlight['source'],x=30):Highlight=>({id:randomUUID(),page:1,rect:[x,100,110,15],source,quote:'important',evidence:'teacher said important',extension:source==='ppt'})
async function fixture(){const doc=await PDFDocument.create(),p=doc.addPage([400,300]);p.drawText('Original textbook remains intact',{x:30,y:140,size:12});for(let i=0;i<4;i++)p.drawText(['Teacher speech','Teacher focus','PPT material','Senior notes'][i],{x:30,y:102-i*20,size:12});p.node.addAnnot(doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Text',Rect:[10,10,25,25],NM:PDFString.of('existing-note'),Contents:PDFString.of('keep this')})));return doc.save()}
async function withBook(run:(h:TextbookHighlighter,id:string,path:string)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'meijiang-production-highlight-'))
 try{const path=join(root,'book.pdf');await writeFile(path,await fixture());const h=new TextbookHighlighter({json:async()=>{throw new Error('unused')}}),book=await h.select(path);await run(h,book.id,path)}finally{await rm(root,{recursive:true,force:true})}
}
describe('editable textbook highlights',()=>{
 it('previews only requested bytes, and rejects unknown capability URLs',async()=>{const root=await mkdtemp(join(tmpdir(),'meijiang-range-'));try{const path=join(root,'book.pdf');await writeFile(path,await fixture());const server=new TextbookFiles(),url=await server.url(path),response=await fetch(url,{headers:{Range:'bytes=0-7'}});expect(response.status).toBe(206);expect((await response.arrayBuffer()).byteLength).toBe(8);expect((await fetch(url.replace(/[^/]+$/,'unknown'))).status).toBe(404);expect((await fetch(url,{headers:{Range:'bytes=999999999-'}})).status).toBe(416)}finally{await rm(root,{recursive:true,force:true})}})
 it('uses teacher focus, senior notes, teacher speech, then PPT for the same area',()=>{const rows=(['ppt','teacher','senior','focus'] as const).map(s=>row(s));expect(prioritizedHighlights(rows).map(r=>r.source)).toEqual(['focus']);expect(prioritizedHighlights(rows.slice(0,3)).map(r=>r.source)).toEqual(['senior']);expect(prioritizedHighlights(rows.slice(0,2)).map(r=>r.source)).toEqual(['teacher'])})
 it('preserves the uncovered part of a lower-priority line',()=>{const result=prioritizedHighlights([{...row('ppt'),rect:[0,0,100,10]},{...row('focus'),rect:[20,0,30,10]}]);expect(result.map(r=>[r.source,r.rect])).toEqual([['focus',[20,0,30,10]],['ppt',[0,0,20,10]],['ppt',[50,0,50,10]]])})
 it('applies priority through the production save path and preserves external notes',async()=>withBook(async(h,id,path)=>{
  await h.manual(id,row('ppt'));await h.manual(id,row('focus'))
  const doc=await PDFDocument.load(await readFile(path)),annots=doc.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray)
  expect(annots.size()).toBe(2);const mark=doc.context.lookup(annots.get(1),PDFDict)
  mark.lookup(PDFName.of('C'),PDFArray).asArray().forEach((n,i)=>expect(Number(n.toString())).toBeCloseTo(highlightColors.focus[i]))
 }))
 it('writes all four editable colors and clears only assistant annotations through production',async()=>withBook(async(h,id,path)=>{
  const sources=Object.keys(highlightColors) as Highlight['source'][]
  for(const [i,source]of sources.entries())await h.manual(id,{...row(source),rect:[30,100-i*20,110,15]})
  const doc=await PDFDocument.load(await readFile(path)),page=doc.getPage(0),annots=page.node.lookup(PDFName.of('Annots'),PDFArray)
  expect(page.getSize()).toEqual({width:400,height:300});expect(annots.size()).toBe(5)
  for(let i=1;i<5;i++){const a=doc.context.lookup(annots.get(i),PDFDict);expect(a.get(PDFName.of('Subtype'))?.toString()).toBe('/Highlight');expect(a.lookup(PDFName.of('QuadPoints'),PDFArray).size()).toBe(8);const data=JSON.parse(a.lookup(PDFName.of('MeijiangData'),PDFString,PDFHexString).decodeText());a.lookup(PDFName.of('C'),PDFArray).asArray().forEach((n,k)=>expect(Number(n.toString())).toBeCloseTo(highlightColors[data.source as Highlight['source']][k]))}
  expect((await h.clear(id)).count).toBe(4)
  const cleared=await PDFDocument.load(await readFile(path));expect(cleared.getPage(0).node.lookup(PDFName.of('Annots'),PDFArray).size()).toBe(1)
 }))
 it('rejects out-of-page highlights without modifying the original file',async()=>withBook(async(h,id,path)=>{
  const original=await readFile(path);await expect(h.manual(id,row('teacher',390))).rejects.toThrow('超出');expect(await readFile(path)).toEqual(original)
 }))
 it('edits original file, saves backup, and refuses stale drafts',async()=>{const root=await mkdtemp(join(tmpdir(),'meijiang-highlight-'));try{const path=join(root,'book.pdf'),bytes=await fixture();await writeFile(path,bytes);const h=new TextbookHighlighter({json:async()=>{throw new Error('unused')}}),book=await h.select(path);await h.manual(book.id,row('teacher'));expect(await readFile(path+'.划线前备份.pdf')).toEqual(Buffer.from(bytes));await writeFile(path,bytes);await expect(h.manual(book.id,row('ppt'))).rejects.toThrow('修改')}finally{await rm(root,{recursive:true,force:true})}})
 it('computes four hours after class across midnight and timezones',()=>{expect(checkAt('')).toBe('');expect(checkAt('2026-10-08T23:00:00+08:00')).toBe('2026-10-08T19:00:00.000Z');expect(checkAt('2026-10-08T12:00:00+09:00')).toBe('2026-10-08T07:00:00.000Z')})
})
