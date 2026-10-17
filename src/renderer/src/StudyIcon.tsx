import type {ReactNode} from 'react'
export function StudyIcon({
 name
}: {
 name:
  | 'subtitles'
  | 'notes'
  | 'practice'
  | 'edit'
  | 'download'
  | 'upload'
  | 'sparkle'
  | 'clock'
  | 'trash'
  | 'check'
  | 'reset'
  | 'eye'
}) {
 const paths: Record<string, ReactNode> = {
  subtitles: (
   <>
    <rect x="3" y="4" width="18" height="16" rx="4" />
    <path d="M7 9h10M7 13h5m3 0h2M7 16h10" />
   </>
  ),
  notes: (
   <>
    <path d="M7 3h10a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM8 8h8m-8 4h8m-8 4h5" />
   </>
  ),
  practice: (
   <>
    <rect x="4" y="4" width="16" height="17" rx="4" />
    <path d="M9 3h6v3H9zM8 11l1 1 2-2m2 1h3m-8 5 1 1 2-2m2 1h3" />
   </>
  ),
  edit: (
   <>
    <path d="m15 4 5 5-11 11-6 1 1-6zM13 6l5 5" />
   </>
  ),
  download: (
   <>
    <path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4" />
   </>
  ),
  upload: (
   <>
    <path d="M12 15V3m-4 4 4-4 4 4M4 16v4h16v-4" />
   </>
  ),
  sparkle: (
   <>
    <path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7z" />
    <path d="M20 2v4m-2-2h4" />
   </>
  ),
  clock: (
   <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
   </>
  ),
  trash: (
   <>
    <path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />
   </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  reset: (
   <>
    <path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" />
   </>
  ),
  eye: (
   <>
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
   </>
  )
 }
 return (
  <svg
   className="study-icon"
   aria-hidden="true"
   viewBox="0 0 24 24"
   fill="none"
   stroke="currentColor"
   strokeWidth="1.7"
   strokeLinecap="round"
   strokeLinejoin="round"
  >
   {paths[name]}
  </svg>
 )
}
