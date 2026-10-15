import {describe,it,expect} from 'vitest'
import {parseMediaCookies,mediaCookieScope} from '../src/main/media-auth'
describe('native explicit cookie import',()=>{
 it('keeps secure, domain, path, HttpOnly and expiry boundaries',()=>{
  const parsed=parseMediaCookies('# Netscape HTTP Cookie File\n#HttpOnly_.youtube.com\tTRUE\t/watch\tTRUE\t0\tsession\tSYNTHETIC_COOKIE\nelsewhere.test\tFALSE\t/\tTRUE\t0\tnot_ours\tNEVER_SEND\nyoutube.com\tFALSE\t/\tTRUE\t1\texpired\tOLD','youtube.com')
  expect(parsed.count).toBe(1);expect(parsed.jar.getCookieStringSync('https://www.youtube.com/watch?v=example')).toBe('session=SYNTHETIC_COOKIE');expect(parsed.jar.getCookieStringSync('https://www.youtube.com/other')).toBe('');expect(parsed.jar.getCookieStringSync('http://www.youtube.com/watch')).toBe('');expect(parsed.jar.getCookieStringSync('https://youtube.com.evil.test/watch')).toBe('');expect(parsed.text).not.toContain('NEVER_SEND');expect(parsed.text).not.toContain('expired')
 })
 it('preserves host-only scope and rejects control characters and public suffixes',()=>{
  const parsed=parseMediaCookies('youtube.com\tFALSE\t/\tTRUE\t0\tsession\tFIXTURE','youtube.com');expect(parsed.jar.getCookieStringSync('https://youtube.com/')).toBe('session=FIXTURE');expect(parsed.jar.getCookieStringSync('https://sub.youtube.com/')).toBe('')
  for(const site of ['https://youtube.com','co.uk','localhost','youtube.com:443','youtube.com/path'])expect(()=>mediaCookieScope(site)).toThrow()
  for(const value of ['youtube.com\tFALSE\t/\tTRUE\t0\tsession\tbad;injection','not\ta\tcookie','youtube.com\tFALSE\t/\tTRUE\t0\tbad name\tvalue'])expect(()=>parseMediaCookies(value,'youtube.com')).toThrow()
 })
})
