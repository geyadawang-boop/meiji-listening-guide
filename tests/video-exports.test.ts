import {expect,test,vi} from 'vitest'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import JSZip from 'jszip'
vi.mock('electron',()=>({BrowserWindow:class{}}))
import {subtitleText,exportVideoNotes} from '../src/main/video-exports'
import {notesSvg} from '../src/shared/video-notes'
const sample='1\n00:00:01,125 --> 00:00:02,750\n完整字幕内容\n'
test('VTT preserves cue timing and content',()=>{
  expect(subtitleText(sample,'vtt')).toContain('00:00:01.125 --> 00:00:02.750')
  expect(subtitleText(sample,'vtt')).toContain('完整字幕内容')
})
test('mindmap SVG escapes source text and preserves topic labels',()=>{
  const svg=notesSvg('课程', [{cue:0,quote:'原话',point:'<script>alert(1)</script>',topic:'材料 & 方法',timestamp:'00:00:01'}])
  expect(svg).not.toContain('<script>')
  expect(svg).toContain('材料 &amp; 方法')
})
test('Word export retains notes and source quotes',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mei-notes-'))
  try{
    const source=join(directory,'课堂笔记.md')
    await writeFile(source,'# 课程笔记\n\n- 牙齿结构（原话：完整字幕内容）','utf8')
    const output=await exportVideoNotes(source,directory,'docx')
    const zip=await JSZip.loadAsync(await readFile(output))
    expect(await zip.file('word/document.xml')!.async('string')).toContain('完整字幕内容')
  }finally{await rm(directory,{recursive:true,force:true})}
})
