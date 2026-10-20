import {Autocomplete, ListBox, SearchField, Select, useFilter} from '@heroui/react'

export type SelectFieldOption = {value: string; label: string; description?: string}

/** 统一的下拉选择：默认包装 HeroUI Select；长列表可切换为带过滤输入框的 Autocomplete。 */
export function SelectField({
 options,
 value,
 onChange,
 label,
 placeholder,
 isDisabled,
 disabledKeys,
 searchable = false,
 clearable = false,
 className
}: {
 options: SelectFieldOption[]
 value: string
 onChange: (value: string) => void
 label?: string
 placeholder?: string
 isDisabled?: boolean
 disabledKeys?: string[]
 searchable?: boolean
 clearable?: boolean
 className?: string
}) {
 const {contains} = useFilter({sensitivity: 'base'})
 if (!searchable)
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
    onClear={clearable ? () => onChange('') : undefined}
   >
    <Select.Trigger>
     <Select.Value />
     {clearable ? <Select.ClearButton /> : null}
     <Select.Indicator />
    </Select.Trigger>
    <Select.Popover>
     <ListBox>
      {options.map(option => (
       <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
        <span className="search-select-option">
         <span>{option.label}</span>
         {option.description ? <small>{option.description}</small> : null}
        </span>
        <ListBox.ItemIndicator />
       </ListBox.Item>
      ))}
     </ListBox>
    </Select.Popover>
   </Select>
  )
 return (
  <Autocomplete
   aria-label={label}
   className={className}
   disabledKeys={disabledKeys}
   fullWidth
   isDisabled={isDisabled}
   placeholder={placeholder || label || '请选择'}
   value={value === '' ? null : value}
   onChange={next => onChange(next == null ? '' : String(next))}
   onClear={clearable ? () => onChange('') : undefined}
  >
   <Autocomplete.Trigger>
    <Autocomplete.Value />
    {clearable ? <Autocomplete.ClearButton /> : null}
    <Autocomplete.Indicator />
   </Autocomplete.Trigger>
   <Autocomplete.Popover>
    <Autocomplete.Filter filter={contains}>
     <SearchField aria-label="搜索选项">
      <SearchField.Group>
       <SearchField.SearchIcon />
       <SearchField.Input placeholder="搜索…" />
       <SearchField.ClearButton />
      </SearchField.Group>
     </SearchField>
     <ListBox>
      {options.map(option => (
       <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
        <span className="search-select-option">
         <span>{option.label}</span>
         {option.description ? <small>{option.description}</small> : null}
        </span>
        <ListBox.ItemIndicator />
       </ListBox.Item>
      ))}
     </ListBox>
    </Autocomplete.Filter>
   </Autocomplete.Popover>
  </Autocomplete>
 )
}
