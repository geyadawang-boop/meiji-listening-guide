const readline=require('node:readline');let thread=0
readline.createInterface({input:process.stdin}).on('line',line=>{let m;try{m=JSON.parse(line)}catch{return}const send=x=>process.stdout.write(JSON.stringify(x)+'\n'),p=m.params||{}
 if(m.method==='initialize')send({id:m.id,result:{}})
 else if(m.method==='account/read')send({id:m.id,result:{account:{type:'chatgpt',email:'test@example.test'},requiresOpenaiAuth:true}})
 else if(m.method==='model/list')send({id:m.id,result:{data:[{id:'gpt-6-luna',model:'gpt-6-luna',displayName:'Test',isDefault:true,supportedReasoningEfforts:[{reasoningEffort:'low'}],defaultReasoningEffort:'low'}]}})
 else if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'video-'+(++thread)}}})
 else if(m.method==='turn/start'){
  send({id:m.id,result:{turn:{id:'turn-'+thread}}});const texts=p.input[0].text;let out
  if(texts.includes('请识别这些完整视频画面'))out=JSON.stringify({left:.05,right:.8,top:.1,bottom:.9})
  else {const items=JSON.parse(texts.slice(texts.indexOf('[{')));out=JSON.stringify(items.map((x,i)=>({page:x.page,keep:![2,4].includes(i),reason:[2,4].includes(i)?'重复页，保留更早的干净页':'干净课件',duplicateOf:i===2?2:i===4?1:null,crop:i===3?{left:.1,right:.7,top:.2,bottom:.8}:{left:.05,right:.8,top:.1,bottom:.9}})))}
  setTimeout(()=>{send({method:'item/completed',params:{threadId:p.threadId,turnId:'turn-'+thread,item:{type:'agentMessage',text:out}}});send({method:'turn/completed',params:{threadId:p.threadId,turn:{id:'turn-'+thread,status:'completed'}}})},50)
 }
 else if(m.id!==undefined)send({id:m.id,result:{}})
})
