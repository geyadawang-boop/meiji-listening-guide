import {describe,it,expect,vi} from 'vitest'
import {BiliResources} from '../src/main/bili-resources'
import {createHash} from 'node:crypto'
const json=(data:unknown,code=0)=>new Response(JSON.stringify({code,data}),{headers:{'Content-Type':'application/json'}})
describe('native Bili resources',()=>{
  it('searches directly with signing, correct paging and plain-text titles',async()=>{
    const requests:URL[]=[]
    const client=new BiliResources(async url=>{
      const parsed=new URL(url);requests.push(parsed)
      if(parsed.pathname.endsWith('/nav'))return json({isLogin:false,wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/0123456789abcdef0123456789abcdef.png',sub_url:'https://i0.hdslb.com/bfs/wbi/fedcba9876543210fedcba9876543210.png'}},-101)
      return json({result:[{bvid:'BV1Q5HXzuEJX',title:'<em>口腔</em> &amp; 修复',author:'老师',duration:'120:00'},{bvid:'invalid',title:'跳过'}],numPages:4})
    })
    const result=await client.browse('search',"口腔 !'()*~",2)
    expect(result.videos).toEqual([{bvid:'BV1Q5HXzuEJX',title:'口腔 & 修复',author:'老师',duration:'120:00',url:'https://www.bilibili.com/video/BV1Q5HXzuEJX/'}])
    expect(result.hasMore).toBe(true)
    const search=requests[1].searchParams
    expect(search.get('keyword')).toBe('口腔 ~');expect(search.get('page')).toBe('2');expect(search.get('search_type')).toBe('video')
    const expectedKey='1022a87ffdaf532cb45ee953dce8c96d'
    const canonical=`keyword=%E5%8F%A3%E8%85%94+~&page=2&search_type=video&wts=${search.get('wts')}`
    expect(search.get('w_rid')).toBe(createHash('md5').update(canonical+expectedKey).digest('hex'))
    await client.browse('search','下一页',3);expect(requests.filter(url=>url.pathname.endsWith('/nav'))).toHaveLength(1)
  })
  it('reads popular videos without Python or a login request and does not fabricate malformed results',async()=>{
    const requests:string[]=[]
    const client=new BiliResources(async url=>{requests.push(url);return json({list:[{bvid:'BV1Q5HXzuEJX',title:'课程',owner:{name:'老师'},duration:120}]})})
    expect((await client.browse('popular','',1)).videos[0].author).toBe('老师');expect(requests).toHaveLength(1);expect(new URL(requests[0]).pathname).toBe('/x/web-interface/popular')
    await expect(new BiliResources(async()=>json({})).browse('popular','',1)).rejects.toThrow('列表格式')
    await expect(new BiliResources(async()=>json({},-412)).browse('popular','',1)).rejects.toThrow('-412')
  })
  it('reads only current-owner folders and preserves unavailable video rows',async()=>{
    const urls:string[]=[]
    const client=new BiliResources(async url=>{urls.push(url);const path=new URL(url).pathname
      if(path.endsWith('/nav'))return json({isLogin:true,mid:42,uname:'示例'})
      if(path.endsWith('/list-all'))return json({list:[{id:3,title:'课程',media_count:2}]})
      return json({medias:[{id:1,type:2,bvid:'BV1Q5HXzuEJX',title:'课程视频',duration:300},{id:2,type:2,bvid:'',title:'已失效视频',duration:0}],has_more:true})})
    const result=await client.videos(3,2)
    expect(result.hasMore).toBe(true);expect(result.videos[0].url).toBe('https://www.bilibili.com/video/BV1Q5HXzuEJX/')
    expect(result.videos[1].available).toBe(false)
    expect(new URL(urls.find(url=>url.includes('list-all'))!).searchParams.get('up_mid')).toBe('42')
    await expect(client.videos(9,1)).rejects.toThrow('不属于当前账号')
  })
  it('reports login and upstream rejection without fabricating empty folders',async()=>{
    expect(await new BiliResources(async()=>json({isLogin:false},-101)).status()).toEqual({loggedIn:false,name:'',mid:undefined})
    await expect(new BiliResources(async()=>json({isLogin:false})).folders()).rejects.toThrow('扫码登录')
    await expect(new BiliResources(async()=>json({},-412)).folders()).rejects.toThrow('-412')
  })
  it('accepts official QR flow, expires and clears successful requests',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(json({qrcode_key:'fixture',url:'https://account.bilibili.com/h5/account-h5/auth/scan-web'})).mockResolvedValueOnce(json({code:86101})).mockResolvedValueOnce(json({code:0}))
    const client=new BiliResources(fetcher)
    await client.begin();expect(await client.poll()).toEqual({status:'waiting'});expect(await client.poll()).toEqual({status:'success'});expect(await client.poll()).toEqual({status:'expired'})
    expect(fetcher.mock.calls[1][1].credentials).toBe('include')
  })
  it('rejects foreign QR URLs',async()=>{
    await expect(new BiliResources(async()=>json({qrcode_key:'fixture',url:'https://example.com/login'})).begin()).rejects.toThrow('官方地址')
  })
})
