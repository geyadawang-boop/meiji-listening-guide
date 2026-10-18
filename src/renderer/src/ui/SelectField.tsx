import {ListBox, Select} from '@heroui/react'

export type SelectFieldOption = {value: string; label: string}

// 统一的下拉选择：包装 HeroUI Select，替代原生 <select>。
export function SelectField({
 options,
 value,
 onChange,
 label,
 placeholder,
 isDisabled,
 disabledKeys,
 className
}: {
 options: SelectFieldOption[]
 value: string
 onChange: (value: string) => void
 label?: string
 placeholder?: string
 isDisabled?: boolean
 disabledKeys?: string[]
 className?: string
}) {
 return (
  <Select
   aria-label={label}
   className={className}
   disabledKeys={disabledKeys}
   fullWidth
   isDisabled={isDisabled}
   placeholder={placeholder || label || '请选择'}
   value={value === '' ? null : value}
   onChange={next => onChange(next == null ? '' : String(next))}
  >
   <Select.Trigger>
    <Select.Value />
    <Select.Indicator />
   </Select.Trigger>
   <Select.Popover>
    <ListBox>
     {options.map(option => (
      <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
       {option.label}
       <ListBox.ItemIndicator />
      </ListBox.Item>
     ))}
    </ListBox>
   </Select.Popover>
  </Select>
 )
}
