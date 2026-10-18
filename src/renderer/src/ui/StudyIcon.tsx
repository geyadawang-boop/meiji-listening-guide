import {
 Captions,
 Check,
 ClipboardCheck,
 Clock,
 Download,
 Eye,
 NotebookPen,
 Pencil,
 RotateCcw,
 Sparkles,
 Trash2,
 Upload,
 type LucideIcon
} from 'lucide-react'

const glyphs: Record<string, LucideIcon> = {
 subtitles: Captions,
 notes: NotebookPen,
 practice: ClipboardCheck,
 edit: Pencil,
 download: Download,
 upload: Upload,
 sparkle: Sparkles,
 clock: Clock,
 trash: Trash2,
 check: Check,
 reset: RotateCcw,
 eye: Eye
}

export type StudyIconName = keyof typeof glyphs

export function StudyIcon({name}: {name: StudyIconName}) {
 const Glyph = glyphs[name]
 return <Glyph className="study-icon" strokeWidth={1.7} aria-hidden="true" />
}
