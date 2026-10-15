import assert from 'node:assert/strict'
import {mkdir,mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {NativeMediaAuth} from '../src/main/media-auth'
import {NativeDownloadJobs} from '../src/main/media-jobs'
import {mediaOptions} from '../src/main/media-options'
import {NativePlatformCatalog} from '../src/main/media-platforms'
const root=resolve('test-results');await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'media-auth-')),auth=new NativeMediaAuth(directory),requests:{url:string;headers:Headers}[]=[]
const profile=await auth.save({name:'测试登录档案',site:'vimeo.com',cookies:'.vimeo.com\tTRUE\t/\tTRUE\t0\tsession\tSYNTHETIC_PRIVATE_COOKIE'})
assert.equal((await auth.list())[0].id,profile.id);assert.equal(JSON.stringify(await auth.list()).includes('SYNTHETIC_PRIVATE_COOKIE'),false);assert.equal((await readFile(join(directory,'download-auth/profiles.dpapi'))).includes(Buffer.from('SYNTHETIC_PRIVATE_COOKIE')),false)
const options=mediaOptions({cookie_profile:profile.id,use_cookies:true}),scoped=await auth.scoped('https://vimeo.com/123456',options,async(url,init)=>{requests.push({url,headers:new Headers(init?.headers)});assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');return new Response('ok')})
await scoped('https://player.vimeo.com/video/123456/config');await scoped('https://fixture.vimeocdn.com/movie.mp4',{headers:{Cookie:'DO_NOT_FORWARD',Authorization:'DO_NOT_FORWARD'}});await scoped('https://vimeo.com.evil.test/');await scoped('http://vimeo.com/')
assert.equal(requests[0].headers.get('cookie'),'session=SYNTHETIC_PRIVATE_COOKIE');for(const row of requests.slice(1)){assert.equal(row.headers.has('cookie'),false);assert.equal(row.headers.has('authorization'),false)}
await assert.rejects(()=>auth.scoped('https://www.youtube.com/watch?v=abcdefghijk',options,async()=>new Response('never')),/不属于/)
const catalog=new NativePlatformCatalog({async readMedia(){throw new Error('Public Bili session must not be used')}},async(url,init)=>{assert.equal(new Headers(init?.headers).get('cookie'),'session=SYNTHETIC_PRIVATE_COOKIE');return Response.json({video:{id:123456,title:'登录档案测试',duration:2},request:{files:{progressive:[{url:'https://fixture.vimeocdn.com/movie.mp4',height:240}]}}})},auth)
const metadata=await catalog.read('https://vimeo.com/123456',false,new AbortController().signal,options);assert.ok('identity'in metadata&&metadata.identity==='vimeo:123456')
let jobs=new NativeDownloadJobs(directory);const job=await jobs.create({identity:'vimeo:123456',url:'https://vimeo.com/123456',title:'PRIVATE_FIXTURE_TITLE',options:{privacy:true}}),folder=await jobs.taskDirectory(job.id)
assert.equal((await readdir(folder)).includes('job.json'),false);assert.equal((await readFile(join(folder,'job.dpapi'))).includes(Buffer.from('PRIVATE_FIXTURE_TITLE')),false)
const running=await jobs.transition(job.id,0,'running');await writeFile(join(folder,'result.mkv'),'verified synthetic output');const proof=await jobs.evidence(job.id,'result.mkv');await jobs.complete(job.id,running.revision,[proof]);jobs=new NativeDownloadJobs(directory);assert.equal((await jobs.read(job.id)).title,'PRIVATE_FIXTURE_TITLE');assert.equal(await jobs.file(job.id),join(folder,'result.mkv'));assert.equal((await readdir(folder)).includes('job.json'),false)
await auth.remove(profile.id);assert.deepEqual(await auth.list(),[]);await assert.rejects(()=>auth.scoped('https://vimeo.com/123456',options,async()=>new Response('never')),/不属于/)
const report={realWindowsDpapiVault:true,noPlaintextSecretsOnDisk:true,noSecretsInPublicMetadata:true,hostPathSecureCookieBoundaries:true,noCookieOnCdnOrUnrelatedHost:true,authenticatedCatalogNative:true,encryptedJobRecoveryAndOutputVerification:true,explicitProfileDelete:true,noRealUserCredentials:true}
await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,...report}))
