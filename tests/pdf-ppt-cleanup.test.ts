import {test,expect,vi} from 'vitest'
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {imagePdf} from '../src/main/image-pdf'
import {deleteConvertedPpt,fileHash,verifyGeneratedPdf} from '../src/main/pdf-ppt-cleanup'

const picture=()=>({getSize:()=>({width:1,height:1}),toBitmap:()=>Buffer.from([0,0,255,255])})
async function setup(){
 await mkdir(resolve('tmp'),{recursive:true})
 const dir=await mkdtemp(join(resolve('tmp'),'cleanup-test-')),source=join(dir,'source.pptx'),pdf=join(dir,'result.pdf'),original=Buffer.from('fixture ppt'),buffer=await imagePdf([picture])
 await writeFile(source,original);await writeFile(pdf,buffer)
 return {dir,source,pdf,original,buffer}
}
test('deletes only the converted source after verifying the saved PDF and updating references',async()=>{
 const f=await setup(),unrelated=join(f.dir,'other.pptx'),replace=vi.fn()
 try{
  await writeFile(unrelated,'other')
  await deleteConvertedPpt(f.source,fileHash(f.original),f.pdf,f.buffer,1,replace)
  expect(replace).toHaveBeenCalledOnce();await expect(access(f.source)).rejects.toThrow()
  expect(await readFile(f.pdf)).toEqual(f.buffer);expect((await readFile(unrelated)).toString()).toBe('other')
 }finally{await rm(f.dir,{recursive:true,force:true})}
})
test('retains the source if the PDF write was incomplete, page count is wrong, or source changed',async()=>{
 const f=await setup(),replace=vi.fn()
 try{
  await writeFile(f.pdf,f.buffer.subarray(0,100))
  await expect(deleteConvertedPpt(f.source,fileHash(f.original),f.pdf,f.buffer,1,replace)).rejects.toThrow('保存检查失败')
  await writeFile(f.pdf,f.buffer)
  await expect(deleteConvertedPpt(f.source,fileHash(f.original),f.pdf,f.buffer,2,replace)).rejects.toThrow('页数检查失败')
  await writeFile(f.source,'changed')
  await expect(deleteConvertedPpt(f.source,fileHash(f.original),f.pdf,f.buffer,1,replace)).rejects.toThrow('发生变化')
  expect((await readFile(f.source)).toString()).toBe('changed');expect(replace).not.toHaveBeenCalled()
 }finally{await rm(f.dir,{recursive:true,force:true})}
})
test('validates PDF object offsets and preserves source when association update fails',async()=>{
 const f=await setup()
 try{
  verifyGeneratedPdf(f.buffer,1)
  const broken=Buffer.from(f.buffer.toString('latin1').replace('startxref\n','startxref\n9'),'latin1')
  expect(()=>verifyGeneratedPdf(broken,1)).toThrow('索引检查失败')
  await expect(deleteConvertedPpt(f.source,fileHash(f.original),f.pdf,f.buffer,1,()=>{throw new Error('database failed')})).rejects.toThrow('database failed')
  expect(await readFile(f.source)).toEqual(f.original)
 }finally{await rm(f.dir,{recursive:true,force:true})}
})
