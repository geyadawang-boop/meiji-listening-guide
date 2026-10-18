import {ToggleButton, ToggleButtonGroup} from '@heroui/react'

export type ThemeChoice = 'light' | 'dark' | 'system'

const options: {id: ThemeChoice; label: string; hint: string}[] = [
 {id: 'light', label: '浅色', hint: '明亮清晰'},
 {id: 'dark', label: '深色', hint: '夜间护眼'},
 {id: 'system', label: '跟随系统', hint: '自动切换'}
]

/** 主题选择：带示例预览的卡片，浅色 / 深色 / 跟随系统。 */
export function ThemePicker({value, onChange}: {value: ThemeChoice; onChange: (value: ThemeChoice) => void}) {
 return (
  <ToggleButtonGroup
   aria-label="界面主题"
   className="theme-picker"
   selectionMode="single"
   disallowEmptySelection
   selectedKeys={new Set([value])}
   onSelectionChange={keys => {
    const next = [...keys][0]
    if (next === 'light' || next === 'dark' || next === 'system') onChange(next)
   }}
  >
   {options.map(item => (
    <ToggleButton key={item.id} id={item.id} className={'theme-card theme-card--' + item.id}>
     <span className="theme-card__preview" aria-hidden="true">
      <span className="theme-card__line" />
      <span className="theme-card__line theme-card__line--short" />
     </span>
     <span className="theme-card__meta">
      <span className="theme-card__label">{item.label}</span>
      <span className="theme-card__hint">{item.hint}</span>
     </span>
    </ToggleButton>
   ))}
  </ToggleButtonGroup>
 )
}
