import type { Profile } from '../shared/types'

export const deepseekModels = ['deepseek-flash', 'deepseek-v4-pro'] as const
export type DeepSeekConnection = Profile & {key:string}
export function validateDeepSeek(profile:DeepSeekConnection):DeepSeekConnection {
  if(!deepseekModels.includes(profile.model as typeof deepseekModels[number]))throw new Error('请选择 DeepSeek Flash 或 DeepSeek V4 Pro')
  if(!profile.key.trim())throw new Error('请先填写并保存 DeepSeek API Key')
  const url=new URL(profile.baseUrl)
  if(url.protocol!=='https:'||url.hostname!=='api.deepseek.com'||url.username||url.password||url.search||url.hash||!['/','/v1','/v1/'].includes(url.pathname))throw new Error('DeepSeek 官方接口地址应为 https://api.deepseek.com')
  const effort=profile.parameters?.[profile.model]?.reasoningEffort||'low'
  if(!['low','high','max'].includes(effort))throw new Error('DeepSeek 推理强度应为低、高或最高')
  return {...profile,baseUrl:url.origin,key:profile.key.trim()}
}

// Metadata follows DeepSeek's official Codex integration guide. The app supplies
// its own task instructions; no coding-agent persona or executable setup script.
export function deepseekCatalog(){return {models:deepseekModels.map((slug,index)=>({
  slug,display_name:index?'DeepSeek V4 Pro':'DeepSeek Flash',description:index?'文字模型':'支持文字与图片',
  prefer_websockets:false,support_verbosity:true,default_verbosity:'low',apply_patch_tool_type:'freeform',web_search_tool_type:'text',
  input_modalities:index?['text']:['text','image'],supports_image_detail_original:!index,
  truncation_policy:{mode:'tokens',limit:10000},supports_parallel_tool_calls:true,tool_mode:null,multi_agent_version:'v2',
  use_responses_lite:false,include_skills_usage_instructions:false,auto_review_model_override:null,
  context_window:1048576,max_context_window:1048576,effective_context_window_percent:95,auto_compact_token_limit:null,
  comp_hash:'3000',reasoning_summary_format:'experimental',default_reasoning_summary:'none',default_reasoning_level:'low',
  supported_reasoning_levels:['low','high','max'].map(effort=>({effort,description:effort})),shell_type:'shell_command',
  visibility:'list',minimal_client_version:'0.144.0',supported_in_api:true,availability_nux:null,upgrade:null,priority:index+1,
  model_messages:{instructions_template:'你是听课助手，请按本次任务要求回答。',instructions_variables:{personality_default:'',personality_friendly:'',personality_pragmatic:''},approvals:null},
  experimental_supported_tools:[],supports_search_tool:false,default_service_tier:null,supports_reasoning_summaries:true,
  base_instructions:'你是听课助手，请按本次任务要求回答。'
}))}}
