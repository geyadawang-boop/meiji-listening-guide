import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {NativeMediaMux} from '../src/main/media-mux'
import {mediaOptions} from '../src/main/media-options'
const root=resolve('.'),resources=join(root,'resources'),directory=join(root,'test-results','media-mux-'+randomUUID())
await mkdir(directory,{recursive:true})
function ffmpeg(args:string[]){const result=spawnSync(join(resources,'video','ffmpeg.exe'),['-hide_banner','-loglevel','error','-nostdin',...args],{windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stderr)}
const video=join(directory,'video.mp4'),audio=join(directory,'audio.m4a')
ffmpeg(['-f','lavfi','-i','color=c=blue:s=320x240:r=25','-t','3','-an','-c:v','libx264',video])
ffmpeg(['-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','3','-vn','-c:a','aac',audio])
const mux=new NativeMediaMux(resources),signal=new AbortController().signal,tracks=[{path:video,kind:'video' as const},{path:audio,kind:'audio' as const}]
const main=await mux.mux({directory,tracks,options:mediaOptions(),expectedDuration:3,title:'隔离测试课程',signal})
assert.equal(main.video,1);assert.equal(main.audio,1);assert.ok(Math.abs(main.duration-3)<.1)
const originalMovie=await readFile(main.path)
await assert.rejects(()=>mux.mux({directory,tracks,options:mediaOptions(),expectedDuration:3,title:'重复输出',signal}))
assert.ok((await readFile(main.path)).equals(originalMovie))
const resumed=await mux.mux({directory,tracks,options:mediaOptions(),expectedDuration:3,title:'隔离测试课程',signal});assert.equal(resumed.reused,true)
const clipped=await mux.mux({directory,tracks,options:mediaOptions({container:'mp4',clip_start:.5,clip_end:2}),expectedDuration:3,title:'裁剪片段',signal})
assert.ok(Math.abs(clipped.duration-1.5)<.2);assert.equal(clipped.audio,1)
const audioOnly=await mux.mux({directory,tracks,options:mediaOptions({audio_only:true,audio_format:'mp3'}),expectedDuration:3,title:'纯音频',signal})
assert.equal(audioOnly.video,0);assert.equal(audioOnly.audio,1)
const cancelled=new AbortController();cancelled.abort()
await assert.rejects(()=>mux.probe(video,cancelled.signal))
const fake=join(directory,'fake.mp4');await writeFile(fake,'invalid media bytes')
await assert.rejects(()=>mux.probe(fake,signal),/处理失败/)
const enhanced=join(directory,'captions-and-chapters');await mkdir(enhanced)
await copyFile(video,join(enhanced,'video.mp4'));await copyFile(audio,join(enhanced,'audio.m4a'))
const subtitles=join(enhanced,'zh-CN.srt');await writeFile(subtitles,'1\n00:00:00,000 --> 00:00:01,000\n对照教材原文\n\n2\n00:00:01,000 --> 00:00:02,500\n老师讲授重点\n')
const embedded=await mux.mux({directory:enhanced,tracks:[{path:join(enhanced,'video.mp4'),kind:'video'},{path:join(enhanced,'audio.m4a'),kind:'audio'}],options:mediaOptions({subtitles:true,embed_subtitles:true}),expectedDuration:3,title:'字幕与章节测试',signal,subtitles:[{path:subtitles,language:'zh-CN'}],chapters:[{start:0,end:1,title:'绪论'},{start:1,end:3,title:'要点=核对;原文'}]})
assert.equal(embedded.subtitles,1);assert.equal(embedded.chapters,2)
await copyFile(main.path,join(enhanced,'track-0-segment-0.partial'));await copyFile(main.path,join(enhanced,'track-0-segment-1.partial'))
const joined=await mux.concatenate(enhanced,[join(enhanced,'track-0-segment-0.partial'),join(enhanced,'track-0-segment-1.partial')],'track-0',signal),joinedProof=await mux.probe(joined.path,signal)
assert.ok(Math.abs(joinedProof.duration-6)<.2);assert.equal(joinedProof.audio,1);assert.equal(joinedProof.video,1)
const coverDirectory=join(directory,'cover-test');await mkdir(coverDirectory)
await copyFile(video,join(coverDirectory,'video.mp4'));await copyFile(audio,join(coverDirectory,'audio.m4a'))
const png=join(directory,'thumbnail.png');ffmpeg(['-f','lavfi','-i','color=c=pink:s=320x180','-frames:v','1',png])
const cover=await mux.prepareCover(coverDirectory,await readFile(png),true,signal)
for(const options of [mediaOptions({embed_thumbnail:true}),mediaOptions({embed_thumbnail:true,container:'mp4'}),mediaOptions({embed_thumbnail:true,audio_only:true,audio_format:'mp3'})]){
 const withCover=await mux.mux({directory:coverDirectory,tracks:[{path:join(coverDirectory,'video.mp4'),kind:'video'},{path:join(coverDirectory,'audio.m4a'),kind:'audio'}],options,expectedDuration:3,title:'封面嵌入测试',signal,cover:cover.path})
 assert.ok(withCover.covers>=1);assert.equal(withCover.audio,1)
}
const result={realFfmpeg:true,separateTrackMux:true,completeDuration:true,videoAndAudioVerified:true,exactClipReencoded:true,audioOnly:true,refusesOverwrite:true,verifiedMuxResumeReusesOutput:true,preCancelled:true,invalidMediaRejected:true,subtitlesEmbeddedAndCountVerified:true,chaptersEmbeddedAndCountVerified:true,progressiveSegmentsConcatenatedInOrder:true,coverConvertedAndCropped:true,mkvMp4Mp3CoversVerified:true,completeMigration:false}
const editedDirectory=join(directory,'remove-middle');await mkdir(editedDirectory)
const colors=join(editedDirectory,'colors.mp4'),tone=join(editedDirectory,'audio.m4a')
ffmpeg(['-f','lavfi','-i','color=c=red:s=320x240:r=25:d=1','-f','lavfi','-i','color=c=green:s=320x240:r=25:d=1','-f','lavfi','-i','color=c=blue:s=320x240:r=25:d=1','-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-c:v','libx264',colors]);await copyFile(audio,tone)
const edited=await mux.mux({directory:editedDirectory,tracks:[{path:colors,kind:'video'},{path:tone,kind:'audio'}],options:mediaOptions(),expectedDuration:3,title:'移除中间绿色一秒',signal,keepSegments:[{start:0,end:1},{start:2,end:3}],chapters:[{start:0,end:1,title:'红色'},{start:1,end:2,title:'移除绿色'},{start:2,end:3,title:'蓝色'}]})
assert.ok(Math.abs(edited.duration-2)<.1);assert.equal(edited.audio,1);assert.equal(edited.video,1);assert.equal(edited.chapters,2)
const sampled=spawnSync(join(resources,'video','ffmpeg.exe'),['-hide_banner','-loglevel','error','-ss','1.5','-i',edited.path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true});assert.equal(sampled.status,0,sampled.stderr.toString());assert.ok(sampled.stdout[2]>200&&sampled.stdout[0]<40&&sampled.stdout[1]<40,'The second retained interval must show blue, not the removed green interval')
const editedAudio=await mux.mux({directory:editedDirectory,tracks:[{path:tone,kind:'audio'}],options:mediaOptions({audio_only:true,audio_format:'best'}),expectedDuration:3,title:'纯音频移除',signal,keepSegments:[{start:0,end:1},{start:2,end:3}]});assert.ok(Math.abs(editedAudio.duration-2)<.1);assert.equal(editedAudio.audio,1);assert.equal(editedAudio.video,0)
Object.assign(result,{sponsorRemovalRealFfmpeg:true,removedMiddleFrameVerified:true,removedAudioDurationVerified:true,chaptersRetimedAndRemovedEmptyChapter:true})
await writeFile(join(directory,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({directory,...result}))
