import {describe,it,expect} from 'vitest'
import CipherDatabase from 'better-sqlite3-multiple-ciphers'
import {mkdtemp,readFile,rm,mkdir,rename} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomBytes,createHash} from 'node:crypto'
import {weixinRead,weixinText,NativeWeixinReader,type BoundWeixinMemory} from '../src/main/im-weixin-database'
import {verifyWeixinKey,readWeixinIdentity,scanWeixinKeys,type WeixinMemory} from '../src/main/im-weixin-crypto'
describe('native Weixin encrypted reads',()=>{
 it.each([32,48])('opens actual SQLCipher4 encrypted pages with %s byte key, no plaintext copy',async length=>{
  const root=await mkdtemp(join(tmpdir(),'meijiang-cipher-')),path=join(root,'contact.db'),key=randomBytes(length)
  try{
   const db=new CipherDatabase(path);db.pragma("cipher='sqlcipher'");db.pragma('legacy=4');if(length===48)db.pragma('plaintext_header_size=16');db.key(Buffer.from('raw:'+key.toString('hex')));db.exec("CREATE TABLE contact(username TEXT PRIMARY KEY,nick_name TEXT,remark TEXT);INSERT INTO contact VALUES('wxid_fixture','隔离中文','')");db.close()
   const bytes=await readFile(path),hash=createHash('sha256').update(bytes).digest('hex');expect(bytes.includes(Buffer.from('隔离中文'))).toBe(false);expect(verifyWeixinKey(key,bytes.subarray(0,4096))).toBe(true)
   expect(weixinRead(path,key,db=>db.prepare('SELECT nick_name FROM contact WHERE native_guard()').get(),()=>{})).toEqual({nick_name:'隔离中文'})
   expect(()=>weixinRead(path,randomBytes(length),db=>db.prepare('SELECT * FROM contact').all(),()=>{})).toThrow('事务未完成')
   expect(()=>weixinRead(path,key,db=>db.prepare("INSERT INTO contact VALUES('bad','','')").run(),()=>{})).toThrow('事务未完成')
   expect(createHash('sha256').update(await readFile(path)).digest('hex')).toBe(hash)
   let calls=0;expect(()=>weixinRead(path,key,db=>db.prepare('SELECT * FROM contact WHERE native_guard()').all(),()=>{if(++calls>1)throw new Error('fixture cancellation')})).toThrow('事务未完成')
  }finally{key.fill(0);await rm(root,{recursive:true,force:true})}
 })
 it('filters unsupported, invalid and compressed oversized content explicitly',()=>{
  expect(weixinText(Buffer.from([255]),1)).toContain('编码');expect(weixinText('secret media',3)).not.toContain('secret');expect(weixinText('学习内容',1)).toBe('学习内容')
 })
 it('does not accept an unverified random key or partial page',()=>{expect(verifyWeixinKey(randomBytes(32),randomBytes(4096))).toBe(false);expect(verifyWeixinKey(randomBytes(48),randomBytes(4095))).toBe(false)})
 it('extracts only bounded identity pointers from a fixture module',()=>{
  const image=Buffer.alloc(1024);image.write('global_config',496);image.writeUInt32LE(13,512);image.writeUInt32LE(15,520);image.writeBigUInt64LE(200000n,200)
  const next=Buffer.alloc(8);next.writeBigUInt64LE(300000n);const name=Buffer.alloc(32);name.write('wxid_fixture');name.writeBigUInt64LE(12n,16)
  const memory:WeixinMemory={module:{base:100000,size:1024},guard(){},find:()=>[],read:(address,length)=>address===100000?image:address===100200?image.subarray(200,208):address===200104?next:address===300072?name:undefined}
  expect(readWeixinIdentity(memory)).toBe('wxid_fixture');image.writeUInt32LE(0,512);expect(readWeixinIdentity(memory)).toBe('')
 })
 it('binds an actual encrypted contact/shard fixture and preserves 64-bit selected-peer cursors',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'meijiang-bound-weixin-')),root=join(directory,'wxid_fixture_a1b2'),base=join(root,'db_storage'),contact=join(base,'contact/contact.db'),shard=join(base,'message/message_0.db'),rawKey=randomBytes(32),peer='wxid_chosen',table='Msg_'+createHash('md5').update(peer).digest('hex')
  await mkdir(join(base,'contact'),{recursive:true});await mkdir(join(base,'message'),{recursive:true})
  let reader:NativeWeixinReader|undefined,closed=false,alive=true
  const create=(file:string,sql:string)=>{const db=new CipherDatabase(file);db.pragma("cipher='sqlcipher'");db.pragma('legacy=4');db.key(Buffer.from('raw:'+rawKey.toString('hex')));db.exec(sql);db.close()}
  try{
   create(contact,"CREATE TABLE contact(username TEXT PRIMARY KEY,nick_name TEXT,remark TEXT);INSERT INTO contact VALUES('wxid_fixture','本人',''),('wxid_chosen','所选好友','备注'),('wxid_other','其他好友','')")
   create(shard,`CREATE TABLE Name2Id(user_name TEXT);INSERT INTO Name2Id VALUES('wxid_chosen');CREATE TABLE "${table}"(message_content TEXT,local_type INTEGER,real_sender_id INTEGER,server_id INTEGER,sort_seq INTEGER,local_id INTEGER,compress_content BLOB,create_time INTEGER);INSERT INTO "${table}" VALUES('指定会话',1,1,1,9223372036854775800,9007199254740993,NULL,1);CREATE TABLE OtherPrivate(message_content TEXT);INSERT INTO OtherPrivate VALUES('OTHER_PRIVATE_TEXT');`)
   const image=Buffer.alloc(1024);image.write('global_config',496);image.writeUInt32LE(13,512);image.writeUInt32LE(15,520);image.writeBigUInt64LE(200000n,200)
   const next=Buffer.alloc(8);next.writeBigUInt64LE(300000n);const identity=Buffer.alloc(32);identity.write('wxid_fixture');identity.writeBigUInt64LE(12n,16)
   const node=Buffer.alloc(80);node.writeBigUInt64LE(500000n,16);node.writeBigUInt64LE(BigInt(Buffer.byteLength('com.Tencent.WCDB.Config.Cipher')),24);node.writeBigUInt64LE(600000n,40)
   const mask=Buffer.from('d2c7442458020000004889442450488b450048844c2448488944254048584c24','hex'),literal=Buffer.from("x'"+rawKey.toString('hex')+"'"),encrypted=Buffer.from(literal.map((value,index)=>value^mask[index%mask.length])),obj=Buffer.alloc(40);obj.writeBigUInt64LE(700000n,8);obj.writeBigUInt64LE(BigInt(encrypted.length),16)
   const memory:BoundWeixinMemory={module:{base:100000,size:1024},guard(){if(!alive||closed)throw new Error('fixture process changed')},budget(){this.guard()},accountRoot:()=>root,loadModule(){},close(){closed=true},find:needle=>needle.toString()==='com.Tencent.WCDB.Config.Cipher'?[500000]:[400016],read:(at,length)=>at===100000?image:at===100200?image.subarray(200,208):at===200104?next:at===300072?identity:at===400000?node:at===600136?obj:at===700000?Buffer.from(encrypted):undefined}
   reader=new NativeWeixinReader(memory);expect(reader.account).toBe('wxid_fixture');expect(reader.directory().peers.find(row=>row.peer===peer)?.name).toBe('备注')
   const first=reader.receive(peer,{reader_id:reader.readerId,cursors:{}});expect(first.messages.map(row=>row.text)).toEqual(['指定会话']);expect(first.session.cursors[peer]['message_0.db']).toEqual(['9223372036854775800','9007199254740993']);expect(JSON.stringify(first)).not.toContain('OTHER_PRIVATE_TEXT')
   const second=reader.receive(peer,first.session);expect(second.session.cursors).toEqual(first.session.cursors)
   expect(()=>reader!.receive('missing',{reader_id:reader!.readerId,cursors:{}})).toThrow('不在当前')
   alive=false;expect(()=>reader!.directory()).toThrow('changed');alive=true
   await rename(shard,shard+'.old');create(shard,'CREATE TABLE changed(value TEXT)');expect(()=>reader!.receive(peer,first.session)).toThrow('已替换')
  }finally{reader?.close();rawKey.fill(0);await rm(directory,{recursive:true,force:true})}
 })
})
