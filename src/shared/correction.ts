export type CorrectionMode = 'quality' | 'balanced' | 'text'

export const correctionModes: {value: CorrectionMode; label: string; description: string}[] = [
 {
  value: 'quality',
  label: '视觉优先',
  description: '结合相关课件文字与最多 3 张图片；无文字匹配时按进度选图，适合公式与图表。'
 },
 {value: 'balanced', label: '均衡', description: '缩小上下文，只附 1 张有文字匹配的图片；无匹配的图表可能遗漏。'},
 {value: 'text', label: '快速文字', description: '只使用原文和相关课件文字，不发送图片；不适合依赖图表、扫描页的校订。'}
]
