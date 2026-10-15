import {describe,it,expect} from 'vitest'
import {mediaFilename} from '../src/main/media-filenames'
import {mediaOptions} from '../src/main/media-options'
describe('native output filenames',()=>{
 it('interprets default fields and caps Unicode UTF8 bytes without splitting characters',()=>{
  const value=mediaFilename(mediaOptions(),'课程内容'.repeat(100),'BV1Q5HXzuEJX','mkv')
  expect(value).toContain('[BV1Q5HXzuEJX].mkv');expect(value).not.toContain('�');expect(Buffer.byteLength(value.split(' [')[0])).toBeLessThanOrEqual(100)
 })
 it('normalizes title path characters and reserved Windows device names',()=>{
  expect(mediaFilename(mediaOptions({filename_template:'%(title)s.%(ext)s'}),'CON','source','mp4')).toBe('_CON.mp4')
  expect(mediaFilename(mediaOptions(),'../../bad:name?','id','mp4')).not.toMatch(/[\\/:?]/)
 })
 it('supports simplified filenames and refuses unsupported template fields',()=>{
  expect(mediaFilename(mediaOptions({restrict_filenames:true}),'中文课件','source','mkv')).toMatch(/^[A-Za-z0-9._-]+$/)
  expect(()=>mediaFilename(mediaOptions({filename_template:'%(unknown)s.%(ext)s'}),'title','id','mkv')).toThrow('未支持')
 })
})
