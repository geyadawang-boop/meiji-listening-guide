import type {NativeMediaOptions} from '@main/media/core/media-options'
const utf8 = (value: string, limit: number) => {
 let result = ''
 for (const character of value) {
  if (Buffer.byteLength(result + character) > limit) break
  result += character
 }
 return result
}
/** Interpret the supported template fields as data; never pass templates to a subprocess. */
export function mediaFilename(options: NativeMediaOptions, title: string, identity: string, extension: string) {
 if (!/^[a-z0-9]{2,8}$/.test(extension)) throw new Error('媒体文件扩展名无效')
 const fields: Record<string, string> = {title, id: identity, ext: extension}
 let used = 0
 const rendered = options.filename_template.replace(
  /%\((title|id|ext)\)(?:\.(\d{1,3})B|s)/g,
  (_match, key: string, bytes: string | undefined) => {
   used++
   return bytes ? utf8(fields[key], Math.min(200, Number(bytes))) : fields[key]
  }
 )
 if (!used || rendered.includes('%(')) throw new Error('文件名模板包含未支持的字段，仅支持 title、id、ext 和字节长度')
 let name = rendered
  .replace(/[\\/<>:"|?*\x00-\x1f]/g, '_')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/[. ]+$/g, '')
 if (options.restrict_filenames) name = name.replace(/[^A-Za-z0-9._-]/g, '_')
 if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) name = '_' + name
 if (!name || name === '.' || name === '..' || !name.toLowerCase().endsWith('.' + extension))
  throw new Error('媒体文件名无效')
 const suffix = '.' + extension,
  stem = name.slice(0, -suffix.length)
 name = utf8(stem, 220 - Buffer.byteLength(suffix)) + suffix
 if (!name.slice(0, -suffix.length)) throw new Error('媒体文件名不能为空')
 return name
}
