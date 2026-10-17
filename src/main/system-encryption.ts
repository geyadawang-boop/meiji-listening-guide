import {safeStorage} from 'electron'
import {windowsProtect} from './windows-native'

const limit = 16 * 1024 * 1024

/** Never accept Electron's Linux hardcoded-password fallback. */
export function assertSecureStorage() {
 if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密存储不可用，未读取或保存凭据')
 if (
  process.platform === 'linux' &&
  !['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend())
 )
  throw new Error('系统未提供安全密钥库，未读取或保存凭据')
}

/** Windows keeps legacy DPAPI bytes. Other platforms use an explicitly tagged OS vault envelope. */
export function systemProtect(raw: Buffer, decrypt = false, domain: 'media' | 'im' = 'media'): Buffer {
 if (!raw.length || raw.length > limit) throw new Error('系统加密输入大小无效')
 if (process.platform === 'win32') return windowsProtect(raw, decrypt)
 if (process.platform !== 'darwin' && process.platform !== 'linux') throw new Error('此平台未提供系统加密存储')
 assertSecureStorage()
 const header = Buffer.from(`meiji-${domain}-vault:v1:${process.platform}\0`),
  binding = domain === 'im' ? `im:${process.platform}:` : ''
 if (decrypt) {
  if (raw.length <= header.length || !raw.subarray(0, header.length).equals(header))
   throw new Error('凭据格式或所属平台不匹配，请在当前系统重新导入')
  const payload = safeStorage.decryptString(raw.subarray(header.length))
  if (!payload.startsWith(binding)) throw new Error('系统加密内容所属范围不匹配')
  const encoded = payload.slice(binding.length),
   result = Buffer.from(encoded, 'base64')
  if (!result.length || result.length > limit || result.toString('base64') !== encoded)
   throw new Error('系统加密内容无效')
  return result
 }
 const result = Buffer.concat([header, safeStorage.encryptString(binding + raw.toString('base64'))])
 if (result.length > limit) throw new Error('系统加密输出过大')
 return result
}
