import { expect,test,vi } from 'vitest'
import { summarizeVideo } from '../src/main/video-summary'

const sample='1\n00:00:01,000 --> 00:00:03,000\n首先讲牙齿的解剖形态。\n\n2\n00:00:04,000 --> 00:00:06,000\n颌面部结构需要结合图片理解。\n'

test('keeps only points with a quote verified against the cited cue',async()=>{
  const ask=vi.fn(async()=>[
    {cue:0,quote:'牙齿的解剖形态',point:'介绍牙齿解剖形态'},
    {cue:1,quote:'考试必考',point:'无依据的考点'}
  ])
  const result=await summarizeVideo(sample,'keypoints',ask,()=>{},new AbortController().signal)
  expect(result.count).toBe(1)
  expect(result.markdown).toContain('00:00:01')
  expect(result.markdown).not.toContain('无依据的考点')
})

test('refuses to save an ungrounded model response',async()=>{
  await expect(summarizeVideo(sample,'brief',async()=>[{cue:0,quote:'完全不存在',point:'臆造内容'}],()=>{},new AbortController().signal)).rejects.toThrow('未保存摘要')
})

test('mindmap keeps grounded topic groups and time anchors',async()=>{
  const result=await summarizeVideo(sample,'mindmap',async()=>[{cue:0,quote:'牙齿的解剖形态',point:'解剖形态',topic:'牙齿结构'}],()=>{},new AbortController().signal)
  expect(result.points[0]).toMatchObject({topic:'牙齿结构',timestamp:'00:00:01'})
  expect(result.markdown).toContain('思维导图')
})

test('processes later subtitle chunks and retains their original time anchors',async()=>{
  const long='讲授'.repeat(8000)
  const srt=`1\n00:00:01,000 --> 00:00:03,000\n${long}\n\n2\n00:20:04,000 --> 00:20:06,000\n第二部分讲解修复材料。\n`
  const ask=vi.fn(async(_prompt:string,input:unknown)=>(input as {cues:{cue:number;text:string}[]}).cues.map(cue=>({cue:cue.cue,quote:cue.text.slice(0,4),point:'该段课程内容'})))
  const result=await summarizeVideo(srt,'brief',ask,()=>{},new AbortController().signal)
  expect(ask).toHaveBeenCalledTimes(2)
  expect(result.count).toBe(2)
  expect(result.markdown).toContain('00:20:04')
})
