import {NativeDownloads} from '@main/media/download/media-downloads'
import {NativeVisualFrames} from '@main/learning/video/visual-frames'
import {mediaOptionChoices} from '@main/media/core/media-options'
import type {BiliResources} from '@main/media/bilibili/bili-resources'
/** Native facade keeps the existing IPC surface while downloads use a dedicated TypeScript process. */
export class MediaBackend {
 private visual: NativeVisualFrames
 private downloads: NativeDownloads
 private closed = false
 constructor(resources: string, root: string, api: Pick<BiliResources, 'readMedia'>) {
  this.visual = new NativeVisualFrames(resources, root)
  this.downloads = new NativeDownloads(resources, root, api)
 }
 get started() {
  return this.downloads.started || this.visual.started
 }
 request<T>(action: string, args: unknown = {}): Promise<T> {
  if (this.closed) return Promise.reject(new Error('媒体后台已关闭'))
  if (action === 'options') return Promise.resolve(mediaOptionChoices()) as Promise<T>
  if (action === 'visual-frames') return this.visual.capture(args) as Promise<T>
  if (action === 'visual-cancel') return Promise.resolve(this.visual.cancel((args as {id: string}).id)) as Promise<T>
  if (action === 'visual-cleanup') return this.visual.cleanup((args as {id: string}).id) as Promise<T>
  return this.downloads.request<T>(action, args)
 }
 async dispose() {
  if (this.closed) return
  this.closed = true
  this.visual.dispose()
  await this.downloads.dispose()
 }
}
