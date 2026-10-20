import type {DragEventHandler, ReactNode} from 'react'
import {ArrowLeft} from 'lucide-react'
import {Button, ScrollShadow} from '@heroui/react'

/** 左侧菜单项：整页窗口导航统一入口，保证宽度、间距与激活态一致。 */
export function WindowMenuButton({
 active = false,
 icon,
 title,
 note,
 disabled,
 onSelect,
 children
}: {
 active?: boolean
 icon?: ReactNode
 title?: string
 note?: ReactNode
 disabled?: boolean
 onSelect: () => void
 children: ReactNode
}) {
 return (
  <Button
   variant="ghost"
   size="sm"
   fullWidth
   isDisabled={disabled}
   onPress={onSelect}
   aria-current={active ? 'page' : undefined}
   className={'window-menu-item' + (active ? ' window-menu-item--active' : '')}
  >
   {icon}
   <span className="window-menu-item__label" title={title}>
    <span className="window-menu-item__name">{children}</span>
    {note ? <small className="window-menu-item__note">{note}</small> : null}
   </span>
  </Button>
 )
}

/** 整页窗口骨架：统一 280px 左菜单（窄屏 240px）、内容区内边距与页头间距。 */
export function WindowPanel({
 visible,
 label,
 title,
 description,
 menu,
 heading,
 subheading,
 actions,
 close,
 backLabel = '返回课程对话',
 className,
 onDragOver,
 onDrop,
 children
}: {
 visible: boolean
 label: string
 title: string
 description: ReactNode
 menu?: ReactNode
 heading?: ReactNode
 subheading?: ReactNode
 actions?: ReactNode
 close: () => void
 backLabel?: string
 className?: string
 onDragOver?: DragEventHandler<HTMLElement>
 onDrop?: DragEventHandler<HTMLElement>
 children: ReactNode
}) {
 return (
  <section
   className={'learning-window' + (className ? ` ${className}` : '')}
   aria-label={label}
   hidden={!visible}
   style={!visible ? {display: 'none'} : undefined}
   onDragOver={onDragOver}
   onDrop={onDrop}
  >
   <aside className="learning-menu" aria-label={label + '导航'}>
    <h2>{title}</h2>
    <p>{description}</p>
    <ScrollShadow className="learning-menu__items" orientation="vertical">
     {menu}
    </ScrollShadow>
    <Button variant="ghost" size="sm" fullWidth className="window-panel__back" onPress={close}>
     <ArrowLeft size={16} aria-hidden="true" />
     {backLabel}
    </Button>
   </aside>
   <main className="learning-content">
    <ScrollShadow className="learning-content__body" orientation="vertical">
     <header>
      <div>
       <h2>{heading ?? title}</h2>
       {subheading ? <p>{subheading}</p> : null}
      </div>
      {actions ? <div className="window-panel__actions">{actions}</div> : null}
     </header>
     {children}
    </ScrollShadow>
   </main>
  </section>
 )
}
