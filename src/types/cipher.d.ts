// The package ships declarations but omits them from its exports map.
// Its synchronous SQLite surface follows better-sqlite3; only key/rekey are added here.
declare module 'better-sqlite3-multiple-ciphers' {
 import Database from 'better-sqlite3'
 class CipherDatabase extends Database {
  key(value: Buffer): number
  rekey(value: Buffer): number
 }
 namespace CipherDatabase {
  type Database = InstanceType<typeof CipherDatabase>
 }
 export = CipherDatabase
}
