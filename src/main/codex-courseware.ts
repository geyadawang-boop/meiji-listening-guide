import { readFile } from 'node:fs/promises'
import { extname, posix } from 'node:path'
import JSZip from 'jszip'
import { parseDocument } from './documents'
export type CoursewarePage={number:number;text:string;images:string[]}
const xmlText=(s:string)=>s.replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&')
export async function codexCourseware(path:string):Promise<CoursewarePage[]> {
  if(extname(path).toLowerCase()!=='.pptx'){
    if(extname(path).toLowerCase()==='.ppt')throw new Error('Codex 课件读取支持 PPTX，请将旧 PPT 另存为 PPTX 后导入')
    const parsed=await parseDocument(path)
    if(parsed.needsOcr)throw new Error('此 PDF 没有可读取的文字，请导入原始 PPTX 课件')
    return [{number:1,text:parsed.text,images:[]}]
  }
  const zip=await JSZip.loadAsync(await readFile(path)),slides=Object.keys(zip.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>Number(a.match(/slide(\d+)/)![1])-Number(b.match(/slide(\d+)/)![1]))
  if(!slides.length)throw new Error('PPTX 不包含课件页面')
  const pages:CoursewarePage[]=[]
  for(const [index,name] of slides.entries()){
    const xml=await zip.file(name)!.async('string'),text=Array.from(xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g),m=>xmlText(m[1])).join('\n'),images:string[]=[]
    const rel=zip.file(posix.join(posix.dirname(name),'_rels',posix.basename(name)+'.rels'))
    if(rel){const rels=await rel.async('string');for(const embed of new Set(Array.from(xml.matchAll(/r:embed="([^"]+)"/g),m=>m[1]))){
      const tag=Array.from(rels.matchAll(/<Relationship\b[^>]*\/?>/g),m=>m[0]).find(t=>new RegExp(`\\bId="${embed}"`).test(t)),target=tag&&/\bTarget="([^"]+)"/.exec(tag)?.[1]
      if(!target||/\bTargetMode="External"/.test(tag!))continue
      const image=zip.file(posix.normalize(posix.join(posix.dirname(name),target))),ext=extname(target).toLowerCase(),mime=({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'} as Record<string,string>)[ext]
      if(image&&mime)images.push(`data:${mime};base64,${await image.async('base64')}`)
    }}
    pages.push({number:index+1,text,images})
  }
  return pages
}
