import type {ReactNode} from 'react'

export function StudyField({
 label,
 hint,
 error,
 children,
 className = ''
}: {
 label: ReactNode
 hint?: ReactNode
 error?: ReactNode
 children: ReactNode
 className?: string
}) {
 return (
  <div className={'study-field ' + className}>
   <span className="study-field__label">{label}</span>
   {children}
   {error ? <small className="study-field__error">{error}</small> : hint ? <small>{hint}</small> : null}
  </div>
 )
}
