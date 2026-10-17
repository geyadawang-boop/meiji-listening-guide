import {z} from 'zod'
export const appearanceSchema = z.object({
 background: z.enum(['none', 'lavender', 'rose', 'mint', 'image']),
 image: z
  .string()
  .max(6000000)
  .refine(v => !v || /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(v), '背景图片格式不正确'),
 opacity: z.number().min(0).max(1),
 blur: z.number().min(0).max(24),
 scrim: z.number().min(0).max(1),
 accent: z.enum(['default', 'lavender', 'rose', 'mint', 'blue']),
 fontSize: z.number().min(12).max(24),
 lineHeight: z.number().min(1.3).max(2.2),
 avatarSize: z.number().min(28).max(72),
 avatarShape: z.enum(['round', 'rounded']),
 showNames: z.boolean(),
 assistantBubble: z.boolean(),
 bubbleRadius: z.number().min(0).max(28),
 messageGap: z.number().min(8).max(48),
 contentWidth: z.number().min(560).max(1040)
})
export type Appearance = z.infer<typeof appearanceSchema>
export const defaultAppearance: Appearance = {
 background: 'none',
 image: '',
 opacity: 0.7,
 blur: 2,
 scrim: 0.5,
 accent: 'default',
 fontSize: 16,
 lineHeight: 1.65,
 avatarSize: 40,
 avatarShape: 'round',
 showNames: true,
 assistantBubble: false,
 bubbleRadius: 18,
 messageGap: 28,
 contentWidth: 832
}
export const appearanceStateSchema = z.object({
 global: appearanceSchema,
 courses: z.record(z.string().uuid(), appearanceSchema)
})
export type AppearanceState = z.infer<typeof appearanceStateSchema>
export const defaultAppearanceState: AppearanceState = {global: defaultAppearance, courses: {}}
export function resolveAppearance(state: AppearanceState, courseId: string) {
 return state.courses[courseId] || state.global
}
