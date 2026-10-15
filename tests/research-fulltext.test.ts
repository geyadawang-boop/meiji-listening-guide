import {describe,it,expect} from 'vitest'
import {NativeResearchFulltext,publicPageText} from '../src/main/research-fulltext'
import iconv from 'iconv-lite'
type Exchange=NonNullable<ConstructorParameters<typeof NativeResearchFulltext>[0]>
describe('native explicitly selected fulltext boundaries',()=>{
 it('extracts visible article text without scripts, navigation or hidden templates',()=>{
  const result=publicPageText('<title>正文 &amp; 原文</title><body><nav>菜单</nav><article><h1>章节</h1><script>ignored()</script><template>hidden</template><p>实际原文</p></article></body>')
  expect(result.title).toBe('正文 & 原文');expect(result.text).toContain('实际原文');expect(result.text).not.toMatch(/ignored|hidden|菜单/)
 })
 it('does not request pages without explicit channel selection',async()=>{
  let calls=0;const service=new NativeResearchFulltext(async()=>{calls++;throw new Error('should not fetch')})
  await expect(service.read(['web'],[{url:'https://example.com/article'}],new AbortController().signal)).rejects.toThrow(/正文渠道/);expect(calls).toBe(0)
  await expect(service.read(['arxiv','arxiv_fulltext'],[{url:'https://arxiv.org/abs/1706.03762v7'}],new AbortController().signal)).rejects.toThrow(/物理页/);expect(calls).toBe(0)
  expect(await service.read(['web'],[],new AbortController().signal)).toEqual([])
 })
 it('preserves declared Chinese encoding, receipt and bounded reading scope',async()=>{
  let closed=0;const exchange:Exchange=async()=>({response:new Response(new Uint8Array(iconv.encode('<title>课堂资料</title><article><p>核对牙釉质原文</p></article>','gb18030')),{headers:{'content-type':'text/html; charset=gb18030'}}),close:async()=>{closed++}})
  const service=new NativeResearchFulltext(exchange),rows=await service.read(['web','web_pages'],[{url:'https://example.com/article'}],new AbortController().signal)
  expect(rows[0]).toMatchObject({title:'课堂资料',text:'核对牙釉质原文',scope:'web_excerpt',truncated:false});service.verify(rows);expect(closed).toBe(1)
  expect(()=>service.verify([{...rows[0],text:'changed'}])).toThrow(/回执/)
 })
 it('refuses login/captcha pages, private URLs, nontext bytes and oversized bodies',async()=>{
  expect(()=>publicPageText('<title>Just a moment</title><body>Verify you are human</body>')).toThrow(/验证/)
  const make=(response:Response)=>new NativeResearchFulltext(async()=>({response,close:async()=>{}}))
  await expect(make(new Response('secret')).read(['web','web_pages'],[{url:'https://127.0.0.1/'}],new AbortController().signal)).rejects.toThrow(/公开/)
  await expect(make(new Response('bad',{headers:{'content-type':'image/png'}})).read(['web','web_pages'],[{url:'https://example.com/'}],new AbortController().signal)).rejects.toThrow(/文字网页/)
  await expect(make(new Response('large',{headers:{'content-type':'text/html','content-length':'3000000'}})).read(['web','web_pages'],[{url:'https://example.com/'}],new AbortController().signal)).rejects.toThrow(/大小上限/)
 })
})
