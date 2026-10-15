import { describe,it,expect } from 'vitest'
import { mkdtemp,readFile,readdir,rm,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Zhiyun,zhiyunLessons,zhiyunMediaUrl } from '../src/main/zhiyun'
const lesson={sub_id:'10',title:'第1节',content:JSON.stringify({save_playback:{contents:'https://resource.cmc.zju.edu.cn/test.mp4'}})}
const catalogue={success:true,result:{code:200,data:[lesson]}}
describe('智云课堂资源',()=>{
  it('不把损坏的播放信息和缺失的课次列表当作没有资料',async()=>{
    expect(()=>zhiyunLessons([{sub_id:'10',content:'{bad'}])).toThrow('播放信息损坏')
    expect(()=>zhiyunLessons([{sub_id:'10',content:'null'}])).toThrow('格式异常')
    expect(zhiyunLessons([{sub_id:'10',content:{}}])[0].videoAvailable).toBe(false)
    const missing=new Zhiyun(async()=>Response.json({success:true,result:{code:200}}),()=>{})
    await expect(missing.lessons('1')).rejects.toThrow('列表格式异常')
    const empty=new Zhiyun(async()=>Response.json({success:true,result:{code:200,data:[]}}),()=>{})
    expect(await empty.lessons('1')).toEqual([])
  })
  it('仅登录页提示登录，其他非法响应明确提示格式异常',async()=>{
    const broken=new Zhiyun(async()=>new Response('{bad',{headers:{'content-type':'application/json'}}),()=>{})
    await expect(broken.lessons('1')).rejects.toThrow('响应格式异常')
    const html=new Zhiyun(async()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}}),()=>{})
    await expect(html.lessons('1')).rejects.toThrow('登录页')
  })
  it('瞬时连接中断有界重试，认证失败不重试',async()=>{let calls=0;const api=new Zhiyun(async()=>{if(++calls<3)throw new Error('net::ERR_CONNECTION_CLOSED');return Response.json(catalogue)},()=>{});expect(await api.lessons('1')).toHaveLength(1);expect(calls).toBe(3);let denied=0;const noLogin=new Zhiyun(async()=>{denied++;return new Response('',{status:401})},()=>{});await expect(noLogin.lessons('1')).rejects.toThrow('登录');expect(denied).toBe(1)})
  it('读取课次并剔除无效编号，不返回内容中的认证数据',()=>{const rows=zhiyunLessons([lesson,{sub_id:'invalid',content:'bad'}]);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({id:'10',videoAvailable:true});expect(rows[0]).not.toHaveProperty('content')})
  it('禁止其他网站、本机和伪造学校域名的下载地址',()=>{for(const url of ['file:///test','http://127.0.0.1/a','https://cmc.zju.edu.cn.evil.test/a','https://user:pass@resource.cmc.zju.edu.cn/a'])expect(()=>zhiyunMediaUrl(url)).toThrow()})
  it('搜索携带官网登录用户参数，去重并正确分页',async()=>{const urls:string[]=[];const api=new Zhiyun(async url=>{urls.push(url);return Response.json(url.includes('infosimple')?{code:200,params:{id:123,account:'fixture-student',tenant_id:112}}:{code:0,total:{total:21,list:[{course_id:1,title:'课程'},{course_id:1,title:'课程'}]}})},()=>{});expect(await api.search('课程',1)).toMatchObject({courses:[{id:'1',title:'课程'}],hasMore:true});const query=new URL(urls[1]).searchParams;expect(query.get('user_id')).toBe('123');expect(query.get('user_name')).toBe('fixture-student');expect(query.get('title')).toBe('课程')})
  it('兼容 data.list，不把认证失败或异常格式伪装成没有课程',async()=>{const make=(result:unknown)=>new Zhiyun(async url=>Response.json(url.includes('infosimple')?{params:{id:123,account:'fixture-student'}}:result),()=>{});expect(await make({code:0,data:{total:1,list:[{course_id:60636,title:'示例课程'}]}}).search('示例课程',1)).toMatchObject({courses:[{id:'60636'}],hasMore:false});await expect(make({code:5002}).search('课程',1)).rejects.toThrow('登录');await expect(make({code:0,result:[]}).search('课程',1)).rejects.toThrow('格式异常');const noLogin=new Zhiyun(async()=>Response.json({code:200,params:{}}),()=>{});await expect(noLogin.search('课程',1)).rejects.toThrow('登录')})
  it('PPT 使用官网 type=1，原文使用 type=2 导出资源',async()=>{const urls:string[]=[];const api=new Zhiyun(async url=>{urls.push(url);return Response.json(url.includes('catalogue')?catalogue:{code:0,data:{path_name:url.includes('type=2')?'https://yjapi.cmc.zju.edu.cn/test.docx':'https://yjapi.cmc.zju.edu.cn/test.pptx',file_name:url.includes('type=2')?'原文.docx':'课件.pptx'}})},()=>{});expect((await api.resource('1','10','ppt',new AbortController().signal)).filename).toBe('课件.pptx');expect(urls.at(-1)).toContain('type=1');expect((await api.resource('1','10','transcript',new AbortController().signal)).filename).toBe('原文.docx');expect(urls.at(-1)).toContain('type=2');await expect(api.resource('1','20','ppt',new AbortController().signal)).rejects.toThrow('课次')})
  it('下载失败保留原文件并清理未完成文件，拒绝伪装为文件的登录页',async()=>{const root=await mkdtemp(join(tmpdir(),'zhiyun-test-'));try{const path=join(root,'test.mp4');await writeFile(path,'original');const bad=new Zhiyun(async()=>new Response('incomplete',{headers:{'content-length':'100'}}),()=>{});await expect(bad.download('https://resource.cmc.zju.edu.cn/test.mp4',path,new AbortController().signal)).rejects.toThrow('完整');expect(await readFile(path,'utf8')).toBe('original');expect(await readdir(root)).toEqual(['test.mp4']);const html=new Zhiyun(async()=>new Response('login',{headers:{'content-type':'text/html'}}),()=>{});await expect(html.download('https://resource.cmc.zju.edu.cn/test.mp4',path,new AbortController().signal)).rejects.toThrow('登录');const good=new Zhiyun(async()=>new Response('video',{headers:{'content-length':'5'}}),()=>{});await good.download('https://resource.cmc.zju.edu.cn/test.mp4',path,new AbortController().signal);expect(await readFile(path,'utf8')).toBe('video')}finally{await rm(root,{recursive:true,force:true})}})
})
