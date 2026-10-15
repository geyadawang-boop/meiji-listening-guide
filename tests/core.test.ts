import { describe,it,expect,vi } from 'vitest'
import { parseSrt,toSrt,mergeSegments,verifyNotes,keywordCandidates } from '../src/shared/srt'
import { readSse, Api } from '../src/main/api'
import type { SettingsStore } from '../src/main/settings'
import type { LectureNotes } from '../src/shared/types'
describe('字幕完整性',()=> {
  const input='1\n00:00:01,200 --> 00:00:03,500\n【老师】这个很重要。\n\n2\n00:00:04,000 --> 00:00:06,100\n这个不考。\n'
  it('读取 Gemini 代码块并无损导出',()=>expect(toSrt(parseSrt('说明\n```srt\n'+input+'```'))).toBe(input))
  it.each(['1\n00:00:00,000 --> 00:00:00,000\n空时间','2\n00:00:00,000 --> 00:00:02,000\n错误序号','1\n00:61:00,000 --> 00:62:00,000\n错误分钟','1\n00:00:03,000 --> 00:00:05,000\nA\n\n2\n00:00:04,000 --> 00:00:06,000\nB'])('拒绝非法字幕：%s',s=>expect(()=>parseSrt(s)).toThrow())
  it('90 分钟三段偏移正确且统一编号',()=> {
    const s=parseSrt(input), merged=mergeSegments([{offset:0,segments:s},{offset:45*60000,segments:s},{offset:80*60000,segments:s}])
    expect(merged[2].start).toBe(2701200);expect(merged[4].start).toBe(4801200);expect(parseSrt(toSrt(merged))).toHaveLength(6)
  })
})
describe('教师原话证据',()=> {
  const segments=[{start:1000,end:5000,text:'【老师】牙釉质结构是重点，这个必考。'},{start:60000,end:65000,text:'【老师】这部分了解即可，这个不考。'},{start:120000,end:125000,text:'【老师】我们继续介绍牙髓。'}]
  const notes:LectureNotes={keyPoints:[{level:'必考',topic:'牙釉质结构',detail:'结构',quote:'牙釉质结构是重点，这个必考。',timestamp:'00:00:01'},{level:'重要',topic:'牙髓',detail:'结构',quote:'我们继续介绍牙髓。',timestamp:'00:02:00'},{level:'重要',topic:'错误',detail:'错误',quote:'这部分了解即可，这个不考。',timestamp:'00:01:00'}],notTested:[{topic:'了解',quote:'这部分了解即可，这个不考。',timestamp:'00:01:00'}],uncertain:[]}
  it('保留重点和不考，拒绝无触发表态和反向否定',()=> {const n=verifyNotes(notes,segments);expect(n.keyPoints.map(p=>p.verified)).toEqual([true,false,false]);expect(n.notTested[0].verified).toBe(true)})
  it('拒绝编造原话和错误时间戳',()=> {const n=structuredClone(notes);n.keyPoints[0].quote='牙釉质必须记住三种结构';expect(verifyNotes(n,segments).keyPoints[0].verified).toBe(false);n.keyPoints[0]= {...notes.keyPoints[0],timestamp:'00:09:00'};expect(verifyNotes(n,segments).keyPoints[0].verified).toBe(false)})
  it('仅粗筛本课知识点的题目',()=>expect(keywordCandidates([{stem:'釉质结构?',knowledgePoints:['牙釉质结构']},{stem:'牙周手术?',knowledgePoints:['牙周炎']}],['牙釉质结构'])).toEqual([0]))
})
describe('API 流式协议',()=> {
  it('400 只返回参数分类，不泄露服务原文',async()=>{
    const request=vi.fn(async()=>new Response(JSON.stringify({error:{param:'reasoning.effort',message:'unsupported reasoning effort secret-key-exposed'}}),{status:400}))
    const api=new Api({profile:()=>({baseUrl:'https://example.test/v1',model:'test',key:'fixture'})} as unknown as SettingsStore,request)
    await expect(api.chat([{role:'user',content:'测试'}])).rejects.toThrow('服务端拒绝了推理强度参数')
    try{await api.chat([{role:'user',content:'测试'}])}catch(error){expect(String(error)).not.toContain('secret-key-exposed')}
  })
  it('PPTX 原文件使用同一服务的 Responses，普通对话保留原协议',async()=>{
    const request=vi.fn(async(url:string,init?:RequestInit)=>{
      const body=JSON.parse(init!.body as string)
      if(url.endsWith('/responses')){expect(body.input[1].content[0]).toEqual({type:'input_file',filename:'课件.pptx',file_data:'data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,fixture'});return new Response(JSON.stringify({output:[{type:'message',content:[{type:'output_text',text:'[]'}]}]}))}
      expect(url).toBe('https://example.test/v1/chat/completions');return new Response(JSON.stringify({choices:[{message:{content:'你好'}}]}))
    })
    const api=new Api({profile:()=>({baseUrl:'https://example.test/v1',model:'test',key:'fixture',apiFormat:'chat_completions'})} as unknown as SettingsStore,request)
    await api.json('校订',{rows:[]},v=>v,undefined,{filename:'课件.pptx',file_data:'data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,fixture'})
    expect(await api.chat([{role:'user',content:'你好'}])).toBe('你好');expect(request).toHaveBeenCalledTimes(2)
  })
  it('网络错误立即停止，不当作 JSON 格式问题重复上传',async()=>{
    const request=vi.fn(async()=>{throw new Error('net::ERR_CONNECTION_CLOSED')})
    const api=new Api({profile:()=>({baseUrl:'https://example.test/v1',model:'test',key:'fixture'})} as unknown as SettingsStore,request)
    await expect(api.json('校订',{rows:[]},v=>v)).rejects.toThrow('ERR_CONNECTION_CLOSED');expect(request).toHaveBeenCalledTimes(1)
  })
  it('读取 Responses 增量并拒绝未完成的响应',async()=>{
    const stream=(data:string)=>new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode(data));c.close()}})
    expect(await readSse(stream('data: {"type":"response.output_text.delta","delta":"你好"}\n\ndata: {"type":"response.completed"}\n\n'),()=>{})).toBe('你好')
    await expect(readSse(stream('data: {"type":"response.output_text.delta","delta":"部分"}\n\ndata: {"type":"response.incomplete"}\n\n'),()=>{})).rejects.toThrow('未完成')
  })
  it('Responses 同时发送 PDF 与原文，并映射推理和输出参数',async()=>{
    const request=vi.fn(async(_url:string,init?:RequestInit)=>{
      const body=JSON.parse(init!.body as string)
      expect(body.input[1].content).toEqual([{type:'input_file',filename:'课件.pdf',file_data:'data:application/pdf;base64,fixture'},{type:'input_text',text:'{"rows":[{"id":0,"text":"原文"}]}'}])
      expect(body.reasoning).toEqual({effort:'high'});expect(body.max_output_tokens).toBe(1000);expect(body.store).toBe(false);expect(body.messages).toBeUndefined()
      return new Response(JSON.stringify({status:'completed',output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:'[{"id":0,"text":"校订"}]'}]}]}))
    })
    const api=new Api({profile:()=>({baseUrl:'https://example.test/v1',model:'test',key:'fixture',apiFormat:'responses',parameters:{test:{reasoningEffort:'high',maxTokens:1000}}})} as unknown as SettingsStore,request)
    expect(await api.json('校订',{rows:[{id:0,text:'原文'}]},v=>v,undefined,{filename:'课件.pdf',file_data:'data:application/pdf;base64,fixture'})).toEqual([{id:0,text:'校订'}])
    expect(request.mock.calls[0][0]).toBe('https://example.test/v1/responses')
  })
  it('处理跨分片中文、CRLF、最终事件和 DONE',async()=> {
    const encoded=new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"课堂"}}]}\n\ndata: [DONE]\n\n')
    const stream=new ReadableStream<Uint8Array>({start(c){for(let i=0;i<encoded.length;i+=7)c.enqueue(encoded.slice(i,i+7));c.close()}}),chunks:string[]=[]
    expect(await readSse(stream,v=>chunks.push(v))).toBe('你好课堂');expect(chunks).toEqual(['你好','课堂'])
  })
  it('HTTP 错误不泄露服务返回或密钥',async()=> {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('secret-key-exposed',{status:401})))
    const api=new Api({profile:()=>({baseUrl:'https://example.test/v1',model:'test',key:'secret-key'})} as unknown as SettingsStore)
    await expect(api.chat([{role:'user',content:'测试'}])).rejects.toThrow('HTTP 401');vi.unstubAllGlobals()
  })
})
