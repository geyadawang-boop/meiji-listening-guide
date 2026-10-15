import { test,expect } from 'vitest'
import { inflateSync } from 'node:zlib'
import { imagePdf } from '../src/main/image-pdf'

test('transparent premultiplied pixels become correct colors on white',async()=>{
  const pdf=await imagePdf([()=>({getSize:()=>({width:3,height:1}),toBitmap:()=>Buffer.from([0,0,64,128,0,0,0,0,30,20,10,255])})])
  const text=pdf.toString('latin1'),start=text.indexOf('stream\n',text.indexOf('/Subtype /Image'))+7,end=text.indexOf('\nendstream',start)
  expect([...inflateSync(pdf.subarray(start,end))]).toEqual([191,127,127,255,255,255,10,20,30])
})

test('cancelled PDF export never decodes images',async()=>{
  const controller=new AbortController();controller.abort()
  await expect(imagePdf([()=>{throw new Error('must not decode')}],controller.signal)).rejects.toThrow(/abort/i)
})
