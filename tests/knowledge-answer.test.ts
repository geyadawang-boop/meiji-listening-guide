import {expect,test} from 'vitest'
import {verifyKnowledgeAnswer} from '../src/main/knowledge-answer'
import type {KnowledgeHit} from '../src/shared/knowledge'
const hit={evidence_id:'evi_fixture',content:'龋病是细菌介导的多因素疾病。'} as KnowledgeHit
const answer=(id:string,quote:string)=>({paragraphs:[{text:'此处为资料总结',citations:[{id,quote}]}],limitation:''})
test('accepts quotes found in the selected source despite line wrapping',()=>{
  expect(verifyKnowledgeAnswer(answer(hit.evidence_id,'龋病是细菌\n介导的多因素疾病'),[hit]).paragraphs).toHaveLength(1)
})
test('rejects invented quotes and quotes attached to another source',()=>{
  expect(()=>verifyKnowledgeAnswer(answer(hit.evidence_id,'龋病完全由饮食导致'),[hit])).toThrow('原文核验')
  expect(()=>verifyKnowledgeAnswer(answer('other',hit.content),[hit])).toThrow('原文核验')
})
test('accepts explicit lack of evidence without fabricating an answer',()=>{
  expect(verifyKnowledgeAnswer({paragraphs:[],limitation:'缺乏证据'},[]).paragraphs).toHaveLength(0)
})
