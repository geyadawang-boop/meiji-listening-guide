import { readFile, copyFile, mkdir } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import jschardet from 'jschardet'
import iconv from 'iconv-lite'
import type { CourseFile } from '../shared/types'
export function chunks(text:string,size=14000):string[] {
  const paragraphs=text.split(/\n(?=#{1,6}\s|第[一二三四五六七八九十\d]+[章节])|\n\s*\n/), result:string[]=[];let current=''
  for(const para of paragraphs) {
    if(current.length+para.length>size && current){result.push(current);current=''}
    if(para.length>size){if(current){result.push(current);current=''};for(let i=0;i<para.length;i+=size)result.push(para.slice(i,i+size))}else current+=(current?'\n\n':'')+para
  }
  if(current)result.push(current);return result
}
export async function parseDocument(path:string):Promise<{text:string;needsOcr:boolean}> {
  const ext=extname(path).toLowerCase(),data=await readFile(path)
  if(ext==='.pdf') {
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task=pdfjs.getDocument({data:new Uint8Array(data),useSystemFonts:true})
    const pdf=await task.promise;let text=''
    try {for(let i=1;i<=pdf.numPages;i++){const page=await pdf.getPage(i),content=await page.getTextContent();text+=`\n[第 ${i} 页]\n`+content.items.map(item=>'str' in item?item.str+('hasEOL' in item && item.hasEOL?'\n':' '):'').join('')}}finally{await task.destroy()}
    const real=text.replace(/\[第 \d+ 页\]/g,'').replace(/\s/g,'')
    return {text,needsOcr:real.length<Math.max(20,pdf.numPages*10)}
  }
  if(ext==='.docx'){
    try{return {text:(await mammoth.extractRawText({buffer:data})).value,needsOcr:false}}
    catch{const zip=await JSZip.loadAsync(data),document=zip.file('word/document.xml');if(!document)throw new Error('Word 原文文件损坏')
      const xml=await document.async('string'),text=xml.replace(/<w:br\s*\/?\s*>/g,'\n').replace(/<\/w:p>/g,'\n\n').replace(/<[^>]+>/g,'').replace(/&#x([\da-f]+);/gi,(_m,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&#(\d+);/g,(_m,n)=>String.fromCodePoint(Number(n))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&')
      return {text,needsOcr:false}
    }
  }
  if(!['.txt','.md'].includes(ext))throw new Error('资料只支持 PDF、DOCX、TXT 和 Markdown；PPT 请先另存为 PDF')
  let encoding=jschardet.detect(data).encoding || 'UTF-8'
  if(/gb|big5|windows-1252|iso-8859/i.test(encoding) && !new TextDecoder('utf-8',{fatal:false}).decode(data).includes('�'))encoding='UTF-8'
  else if(/windows-1252|iso-8859/i.test(encoding))encoding='GB18030'
  return {text:iconv.decode(data,iconv.encodingExists(encoding)?encoding:'GB18030'),needsOcr:false}
}
export async function copyInto(root:string,courseId:string,source:string,subdir='materials',directory?:string):Promise<string> {
  const dir=directory||join(root,'courses',courseId,subdir);await mkdir(dir,{recursive:true})
  const ext=extname(source),name=basename(source,ext)
  const dest=join(dir,(directory?name+'-':'')+randomUUID()+ext.toLowerCase());await copyFile(source,dest);return dest
}
export async function importDocument(root:string,courseId:string,kind:CourseFile['kind'],source:string,directory?:string):Promise<CourseFile> {
  const parsed=await parseDocument(source),path=await copyInto(root,courseId,source,'materials',directory)
  return {id:randomUUID(),course_id:courseId,kind,filename:basename(source),path,text:parsed.text,chunks:chunks(parsed.text),needs_ocr:parsed.needsOcr?1:0}
}

export async function parseCourseware(path:string) {
  if(/\.(pptx?|pdf)$/i.test(path))return {text:'',needsOcr:false}
  return parseDocument(path)
}
