import { expect, test, vi } from 'vitest'
import { readBiliSubtitles } from '../src/main/bili-subtitles'

function fixture(trackUrl = 'https://aisubtitle.hdslb.com/subtitle.json') {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/x/player/pagelist')) return new Response(JSON.stringify({ code: 0, data: [{ cid: 11, page: 1, part: '第一节', duration: 120 }, { cid: 22, page: 2, part: '第二节', duration: 180 }] }))
    if (url.includes('/x/player/v2')) return new Response(JSON.stringify({ code: 0, data: { subtitle: { subtitles: [{ lan: 'ai-zh', lan_doc: '自动中文字幕', subtitle_url: trackUrl }] } } }))
    return new Response(JSON.stringify({ body: [{ from: 0.5, to: 2.5, content: '第一句' }, { from: 2, to: 4, content: '第二句' }] }))
  })
  return fetcher
}

test('reads the selected part, trims overlapping cues, and marks automatic subtitles', async () => {
  const fetcher = fixture()
  const result = await readBiliSubtitles('https://www.bilibili.com/video/BVabc/?p=2', fetcher, new AbortController().signal)
  expect(fetcher.mock.calls[1][0]).toContain('cid=22')
  expect(result.title).toBe('第二节')
  expect(result.count).toBe(2)
  expect(result.warning).toContain('自动字幕')
  expect(result.srt).toContain('00:00:00,500 --> 00:00:02,000')
})

test('rejects a subtitle URL outside Bilibili hosts', async () => {
  await expect(readBiliSubtitles('https://www.bilibili.com/video/BVabc/', fixture('https://example.com/subtitle.json'), new AbortController().signal)).rejects.toThrow('字幕地址不受信任')
})

test('rejects subtitle timing that belongs to another video', async () => {
  const fetcher = fixture()
  fetcher.mockImplementation(async (url: string) => {
    if (url.includes('/x/player/pagelist')) return new Response(JSON.stringify({ code: 0, data: [{ cid: 11, page: 1, part: '第一节', duration: 10 }] }))
    if (url.includes('/x/player/v2')) return new Response(JSON.stringify({ code: 0, data: { subtitle: { subtitles: [{ lan: 'zh-CN', subtitle_url: 'https://aisubtitle.hdslb.com/a.json' }] } } }))
    return new Response(JSON.stringify({ body: [{ from: 100, to: 200, content: '别的视频' }] }))
  })
  await expect(readBiliSubtitles('https://www.bilibili.com/video/BVabc/', fetcher, new AbortController().signal)).rejects.toThrow('可能属于其他视频')
})
