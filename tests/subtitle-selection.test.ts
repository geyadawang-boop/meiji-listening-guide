import {describe,it,expect} from 'vitest'
import {selectedSubtitles} from '../src/main/subtitle-selection'
import type {VideoSeries} from '../src/shared/video-ppt'
const a='https://www.bilibili.com/video/BV1Q5HXzuEJX/',b='https://www.bilibili.com/video/BV1A5HYzBEmG/'
const series=(url:string,title:string):VideoSeries=>({title,episodes:[1,2].map(page=>({page,title:'第'+page+'节',duration:10,url:url+'?p='+page}))})
describe('mixed native subtitle selections',()=>{
  const cache=new Map([[a,series(a,'视频甲')],[b,series(b,'视频乙')]])
  it('keeps only chosen parts across videos, even when their part numbers match',()=>{
    const selected=selectedSubtitles([{url:a,pages:[2]},{url:b,pages:[2]}],cache)
    expect(selected.map(item=>item.url)).toEqual([a+'?p=2',b+'?p=2']);expect(selected.map(item=>item.title)).toEqual(['视频甲 · 第2节','视频乙 · 第2节'])
  })
  it('refuses unloaded, nonexistent or repeated selections',()=>{
    expect(()=>selectedSubtitles([{url:a,pages:[3]}],cache)).toThrow('无效')
    expect(()=>selectedSubtitles([{url:a,pages:[1]},{url:a,pages:[1]}],cache)).toThrow('重复')
    expect(()=>selectedSubtitles([{url:a,pages:[1]}],new Map())).toThrow('目录已失效')
  })
})
