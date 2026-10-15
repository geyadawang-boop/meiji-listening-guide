import {z} from 'zod'
import {BiliMediaCatalog} from './media-bili'
import type {BiliResources} from './bili-resources'
import type {NativeMediaCatalog,NativeMediaSource,NativeMediaStream} from './media-source'
import {boundedPublicText} from './public-http'
import {mediaOptions} from './media-options'
import {NativeYoutubeCatalog,youtubeInput} from './media-youtube'
const positive=z.number().finite().positive()
type Fetcher=(url:string,init?:RequestInit)=>Promise<Response>
const address=(raw:string,domains:string[])=>{const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!domains.some(domain=>url.hostname===domain||url.hostname.endsWith('.'+domain)))throw new Error('站点媒体地址未通过核验');return url.href}
export const platformMediaAddress=(platform:string,url:string)=>address(url,platform==='vimeo'?['vimeocdn.com','akamaized.net']:platform==='dailymotion'?['dailymotion.com','dmcdn.net']:[])
export function platformInput(input:string){
 const raw=input.trim();if(/^BV[A-Za-z0-9]{10}$/.test(raw))return {platform:'bilibili' as const,url:raw,id:'',hash:''}
 const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||url.hash)throw new Error('视频网址无效')
 if(['bilibili.com','www.bilibili.com'].includes(url.hostname))return {platform:'bilibili' as const,url:url.href,id:'',hash:''}
 if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be'].includes(url.hostname))return {platform:'youtube' as const,...youtubeInput(url.href),hash:''}
 if(['vimeo.com','www.vimeo.com','player.vimeo.com'].includes(url.hostname)){
  const match=/^\/(?:video\/)?([1-9]\d{0,14})(?:\/([A-Za-z0-9]{1,64}))?\/?$/.exec(url.pathname),hash=url.searchParams.getAll('h');if(!match||hash.length>1||hash.some(value=>!/^[A-Za-z0-9]{1,64}$/.test(value)))throw new Error('请使用具体的 Vimeo 视频网址')
  const token=match[2]||hash[0]||'';if(match[2]&&hash[0]&&match[2]!==hash[0])throw new Error('视频访问标识有歧义');return {platform:'vimeo' as const,id:match[1],hash:token,url:`https://vimeo.com/${match[1]}${token?'/'+token:''}`}
 }
 if(['www.dailymotion.com','dailymotion.com','dai.ly'].includes(url.hostname)){
  const match=(url.hostname==='dai.ly'?/^\/([A-Za-z0-9]{1,32})\/?$/:/^\/video\/([A-Za-z0-9]{1,32})\/?$/).exec(url.pathname);if(!match)throw new Error('请使用具体的 Dailymotion 视频网址');return {platform:'dailymotion' as const,id:match[1],hash:'',url:'https://www.dailymotion.com/video/'+match[1]}
 }
 throw new Error('此站点的原生解析仍在迁移；支持 B站、YouTube、Vimeo 和 Dailymotion')
}
/** Native catalogs, with exact platform identity checked again before queue creation and execution. */
export class NativePlatformCatalog implements NativeMediaCatalog{
 private bili:BiliMediaCatalog
 constructor(api:Pick<BiliResources,'readMedia'>,private fetcher:Fetcher){this.bili=new BiliMediaCatalog(api)}
 async read(input:string,playlist:boolean,signal:AbortSignal,options:unknown={}){
  const selected=platformInput(input);if(selected.platform==='bilibili')return this.bili.read(selected.url,playlist,signal,options)
  if(selected.platform==='youtube')return new NativeYoutubeCatalog(this.fetcher).read(selected.url,playlist,signal,options)
  const settings=mediaOptions(options);signal.throwIfAborted()
  if(playlist)throw new Error('此平台当前请逐条选择视频，不把单个视频误当作完整播放列表')
  if(settings.subtitles)throw new Error('此平台字幕目录仍在迁移；可下载视频后使用本地转写')
  const endpoint=selected.platform==='vimeo'?`https://player.vimeo.com/video/${selected.id}/config${selected.hash?'?h='+selected.hash:''}`:`https://www.dailymotion.com/player/metadata/video/${selected.id}`
  const response=await this.fetcher(endpoint,{signal:AbortSignal.any([signal,AbortSignal.timeout(30000)]),redirect:'error',credentials:'omit',headers:{'User-Agent':'Mozilla/5.0'}})
  if(!response.ok){await response.body?.cancel();throw new Error('此视频目录无法取得，请检查是否公开及站点访问权限')}
  const raw=JSON.parse(await boundedPublicText(response,4*1024*1024)),streams:NativeMediaStream[]=[]
  let title='',duration=0,description='',thumbnail:string|undefined
  if(selected.platform==='vimeo'){
   const data=z.object({video:z.object({id:z.union([z.number().int().safe().transform(String),z.string()]),title:z.string().min(1).max(2000),duration:positive,thumbs:z.record(z.string(),z.string()).optional()}),request:z.object({files:z.object({progressive:z.array(z.object({id:z.union([z.string(),z.number()]).optional(),url:z.string(),height:z.number().int().nonnegative(),mime:z.string().optional(),quality:z.string().optional(),bitrate:z.number().nonnegative().optional()})).max(100).optional(),hls:z.object({default_cdn:z.string(),cdns:z.record(z.string(),z.object({url:z.string()}))}).optional()})})}).parse(raw)
   if(data.video.id!==selected.id)throw new Error('Vimeo 目录与所选视频身份不一致');title=data.video.title;duration=data.video.duration
   for(const [index,row] of (data.request.files.progressive||[]).entries())streams.push({id:'vimeo-'+row.height+'-'+index,kind:'combined',urls:[address(row.url,['vimeocdn.com','akamaized.net'])],height:row.height,codec:'avc1',bandwidth:(row.bitrate||0)*1000,extension:row.mime?.includes('webm')?'webm':'mp4'})
   if(!streams.length&&data.request.files.hls){const hls=data.request.files.hls,url=hls.cdns[hls.default_cdn]?.url;if(url)streams.push({id:'hls-auto',kind:'combined',urls:[platformMediaAddress('vimeo',url)],height:0,codec:'',bandwidth:0,extension:'mp4',transport:'hls'})}
   const cover=Object.entries(data.video.thumbs||{}).sort((a,b)=>Number(b[0])-Number(a[0]))[0]?.[1];if(cover)thumbnail=address(cover,['vimeocdn.com'])
  }else{
   const data=z.object({id:z.string(),title:z.string().min(1).max(2000),duration:positive,error:z.unknown().optional(),description:z.string().max(1000000).optional(),qualities:z.record(z.string(),z.array(z.object({type:z.string(),url:z.string()})).max(50)),posters:z.record(z.string(),z.string()).optional()}).parse(raw)
   if(data.id!==selected.id||data.error)throw new Error('Dailymotion 未确认所选视频可读取');title=data.title;duration=data.duration;description=data.description||''
   for(const [quality,formats] of Object.entries(data.qualities))for(const [index,row] of formats.entries())if(['video/mp4','video/webm'].includes(row.type))streams.push({id:'dm-'+quality.replace(/[^A-Za-z0-9_-]/g,'')+'-'+index,kind:'combined',urls:[address(row.url,['dailymotion.com','dmcdn.net'])],height:/^\d+$/.test(quality)?Number(quality):0,codec:row.type==='video/webm'?'vp9':'avc1',bandwidth:0,extension:row.type==='video/webm'?'webm':'mp4'})
   if(!streams.length){const hls=Object.values(data.qualities).flat().find(row=>['application/x-mpegURL','application/vnd.apple.mpegurl'].includes(row.type));if(hls)streams.push({id:'hls-auto',kind:'combined',urls:[platformMediaAddress('dailymotion',hls.url)],height:0,codec:'',bandwidth:0,extension:'mp4',transport:'hls'})}
   const cover=Object.values(data.posters||{})[0];if(cover)thumbnail=address(cover,['dmcdn.net','dailymotion.com'])
  }
  if(!streams.length)throw new Error('此视频只提供尚未迁移的流式格式，未创建假下载成果')
  if(settings.format_ids&&!settings.format_ids.split('+').every(id=>streams.some(stream=>stream.id===id)))throw new Error('所选格式已改变，请重新读取格式')
  signal.throwIfAborted()
  const source:NativeMediaSource={platform:selected.platform,sourceId:selected.platform+'-'+selected.id,identity:selected.platform+':'+selected.id,downloadHeaders:{Referer:selected.platform==='vimeo'?'https://vimeo.com/':'https://www.dailymotion.com/','User-Agent':'Mozilla/5.0'},description,thumbnail,streams,catalog:{url:selected.url,title:title.slice(0,240),duration,playlist:false,heights:[...new Set(streams.map(row=>row.height))].sort((a,b)=>a-b),subtitles:[],formats:streams.map(row=>({id:row.id,height:row.height||null,extension:row.extension,video_codec:row.codec,audio_codec:'combined'}))}}
  return source
 }
}
