import {Button} from '@heroui/react'
import {Cog} from 'lucide-react'
import {createContext, useContext, type ReactNode} from 'react'

export type SettingsSection =
 | 'appearance'
 | 'identity'
 | 'qwen'
 | 'methods'
 | 'prompts'
 | 'search'
 | 'communications'
 | 'mcp'
 | 'zhiyun'
 | 'bilibili'
 | 'runtime'

type SettingsNavigation = {
 open: (section: SettingsSection) => void
}

const SettingsNavigationContext = createContext<SettingsNavigation | null>(null)

export function SettingsNavigationProvider({
 value,
 children
}: {
 value: SettingsNavigation
 children: ReactNode
}) {
 return <SettingsNavigationContext.Provider value={value}>{children}</SettingsNavigationContext.Provider>
}

export function useSettingsNavigation() {
 const value = useContext(SettingsNavigationContext)
 if (!value) throw new Error('设置导航未初始化')
 return value
}

export function SettingsLink({
 section,
 children,
 onSelect
}: {
 section: SettingsSection
 children: ReactNode
 onSelect?: () => void
}) {
 const {open} = useSettingsNavigation()
 return (
  <Button
   variant="ghost"
   size="sm"
   type="button"
   onPress={() => {
    onSelect?.()
    open(section)
   }}
  >
   <Cog size={14} aria-hidden="true" />
   {children}
  </Button>
 )
}
