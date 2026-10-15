import {describe,it,expect} from 'vitest'
import {NativeWeixinWebSession,weixinRedirect} from '../src/main/im-weixin-web'
import {weixinBootstrap} from '../src/main/im-weixin-html'
const signal=()=>new AbortController().signal
const key=(value=1)=>({Count:1,List:[{Key:1,Val:value}]})
const shell=(script='(function(){window.MMCgi={isLogin:true};})();')=>`<!doctype html><html><head><title>微信网页版</title></head><body ng-controller="appController"><div ng-controller="loginController"></div><script src="https://res.wx.qq.com/t/wx_fed/webwx/res/static/js/index_ab123.js"></script><script>${script}</script></body></html>`
function fixture(html=false){
 const state={account:'1234567',self:'@self',syncs:0,sends:0,confirmation:html?shell():'<error><ret>0</ret><wxuin>1234567</wxuin><wxsid>synthetic-sid</wxsid><skey>synthetic-skey</skey><pass_ticket>synthetic-ticket</pass_ticket></error>',cookies:['wxuin=1234567; Secure; Path=/; HttpOnly','wxsid=synthetic-sid; Secure; Path=/; HttpOnly'],receivedCursor:[] as number[],unknownSend:false,contactLoop:false,calls:[] as string[]}
 const fetcher:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));state.calls.push(url.href);expect(init?.redirect).toBe('error');expect(init?.credentials).toBe('omit');const body=init?.body?JSON.parse(String(init.body)):{}
  if(url.pathname==='/jslogin')return new Response('window.QRLogin.code = 200; window.QRLogin.uuid = "fixture";')
  if(url.pathname.endsWith('/login'))return new Response('window.code=200;window.redirect_uri="https://wx.qq.com/cgi-bin/mmwebwx-bin/webwxnewloginpage?ticket=a%2Bb&dup=1&dup=2";')
  if(url.pathname.endsWith('webwxnewloginpage')){const headers=new Headers();for(const cookie of state.cookies)headers.append('set-cookie',cookie);return new Response(state.confirmation,{headers})}
  expect(new Headers(init?.headers).get('cookie')).toContain('wxsid=synthetic-sid')
  if(url.pathname.endsWith('webwxinit'))return Response.json({BaseResponse:{Ret:0},User:{UserName:state.self,Uin:state.account},SKey:'verified-skey',SyncKey:key(99)})
  if(url.pathname.endsWith('webwxgetcontact'))return Response.json({BaseResponse:{Ret:0},MemberList:[{UserName:'@chosen',NickName:'所选联系人'}],Seq:state.contactLoop?1:0})
  if(url.pathname.endsWith('webwxsync')){state.syncs++;state.receivedCursor.push(body.SyncKey.List[0].Val);return Response.json({BaseResponse:{Ret:0},SyncKey:key(100),AddMsgList:[{MsgId:'chosen',FromUserName:'@chosen',ToUserName:'@self',MsgType:1,Content:'所选消息',CreateTime:1},{MsgId:'other',FromUserName:'@other',ToUserName:'@self',MsgType:1,Content:'other-private-text',CreateTime:1},{MsgId:'alien',FromUserName:'@chosen',ToUserName:'@alien',MsgType:1,Content:'unrelated',CreateTime:1}]})}
  if(url.pathname.endsWith('webwxsendmsg')){state.sends++;return Response.json({BaseResponse:{Ret:0},...state.unknownSend?{}:{MsgID:'sent-1'}})}
  throw new Error('Unexpected fixture request')
 }
 return {state,fetcher}
}
describe('native Weixin Web',()=>{
 it('preserves signed query bytes and rejects foreign redirects',()=>{
  expect(weixinRedirect('https://wx.qq.com/cgi-bin/mmwebwx-bin/webwxnewloginpage?a=x%2by&a=2&%66un=old&version=v1').search).toBe('?a=x%2by&a=2&fun=new&version=v2')
  for(const url of ['http://wx.qq.com/cgi-bin/mmwebwx-bin/webwxnewloginpage','https://wx.qq.com.evil.test/cgi-bin/mmwebwx-bin/webwxnewloginpage','https://wx.qq.com/cgi-bin/mmwebwx-bin/webwxnewloginpage#x','https://user@wx.qq.com/cgi-bin/mmwebwx-bin/webwxnewloginpage'])expect(()=>weixinRedirect(url)).toThrow()
 })
 it('requires a complete nonexecuted official authenticated marker',()=>{
  expect(weixinBootstrap(shell())).toBe(true);expect(weixinBootstrap(shell('(function(){window.MMCgi={isLogin:!!"yes"};window.MMDEV=location.host.indexOf("dev")>-1;})();'))).toBe(true)
  for(const html of [shell('window.MMCgi={isLogin:true};'),shell('(function(){window.MMCgi={isLogin:false};})();'),shell().replace('res.wx.qq.com','evil.test'),shell().replace('<script>(function','<template><script>(function').replace('</script></body>','</script></template></body>'),shell().replace('</body>','<ret>1101</ret></body>'),shell().replace('</body>','<script>(function(){window.MMCgi={isLogin:true};})();</script></body>'),shell().replace('<!doctype html>','<!DOCTYPE html SYSTEM "x">')])expect(weixinBootstrap(html)).toBe(false)
 })
 it.each([false,true])('verifies XML/HTML account before export, preserves cursor and selected scope (%s)',async html=>{
  const {state,fetcher}=fixture(html),adapter=new NativeWeixinWebSession(undefined,fetcher)
  expect((await adapter.start(signal())).qr).toBe('https://login.weixin.qq.com/l/fixture');expect((await adapter.poll(signal())).state).toBe('verifying')
  const verified=await adapter.verify(signal());expect(verified.account).toBe('1234567');expect(verified.session.SyncKey).toEqual(key(99))
  expect((await adapter.directory(signal())).peers[0].peer).toBe('@chosen')
  const pending=await adapter.receive('@chosen','1234567',signal());expect(pending.messages.map(row=>row.mid)).toEqual(['chosen']);expect(pending.session.SyncKey).toEqual(key(100))
  await adapter.verify(signal());await adapter.receive('@chosen','1234567',signal());expect(state.receivedCursor).toEqual([99,99])
  const restored=new NativeWeixinWebSession(pending.session,fetcher);await restored.verify(signal(),'1234567');await restored.receive('@chosen','1234567',signal());expect(state.receivedCursor.at(-1)).toBe(100)
  state.account='999';await expect(restored.verify(signal(),'1234567')).rejects.toThrow('不一致');state.account='1234567';state.self='@changed';await expect(restored.verify(signal())).rejects.toThrow('身份已改变')
 })
 it('rejects ambiguous and inapplicable HTML bootstrap cookies',async()=>{
  for(const extra of ['wxuin=1234567; Domain=qq.com; Secure; Path=/','wxsid=wrong; Secure; Path=/cgi-bin/mmwebwx-bin/webwxinit']){
   const {state,fetcher}=fixture(true);state.cookies.push(extra);const adapter=new NativeWeixinWebSession(undefined,fetcher);await adapter.start(signal());await expect(adapter.poll(signal())).rejects.toThrow('歧义')
  }
  const {state,fetcher}=fixture(true);state.cookies=state.cookies.map(cookie=>cookie.replace('Path=/','Path=/not-applicable'));const adapter=new NativeWeixinWebSession(undefined,fetcher);await adapter.start(signal());await expect(adapter.poll(signal())).rejects.toThrow('缺失')
 })
 it('rejects malformed XML, entity declarations and imprecise account identifiers',async()=>{
  for(const xml of ['<error><ret>0</ret><ret>0</ret></error>','<!DOCTYPE error [<!ENTITY x SYSTEM "file:///x">]><error/>','<error><ret>0</error>','<error><ret>0</ret><wxuin>18446744073709551615</wxuin><wxsid>sid</wxsid><skey>key</skey><pass_ticket>ticket</pass_ticket></error>']){
   const {state,fetcher}=fixture();state.confirmation=xml;const adapter=new NativeWeixinWebSession(undefined,fetcher);await adapter.start(signal());await expect(adapter.poll(signal())).rejects.toThrow()
  }
 })
 it('does not invent a send receipt and refuses stuck contact pagination',async()=>{
  const {state,fetcher}=fixture(),adapter=new NativeWeixinWebSession(undefined,fetcher);await adapter.start(signal());await adapter.poll(signal());await adapter.verify(signal())
  state.unknownSend=true;expect(await adapter.send('@chosen','fixture-only','operation-1',signal())).toBe(null);state.contactLoop=true;await expect(adapter.directory(signal())).rejects.toThrow('未前进')
 })
})
