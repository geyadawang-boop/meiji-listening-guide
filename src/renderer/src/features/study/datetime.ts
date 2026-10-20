import {CalendarDateTime, parseDateTime} from '@internationalized/date'

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string) {
 const cached = formatters.get(timeZone)
 if (cached) return cached
 const next = new Intl.DateTimeFormat('en-US', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
 })
 formatters.set(timeZone, next)
 return next
}

const pad = (value: number) => String(value).padStart(2, '0')

export function validTimeZone(timeZone: string) {
 try {
  formatter(timeZone)
  return true
 } catch {
  return false
 }
}

function parts(date: Date, timeZone: string) {
 const values: Record<string, string> = {}
 for (const part of formatter(timeZone).formatToParts(date)) {
  if (part.type !== 'literal') values[part.type] = part.value
 }
 return values
}

function offsetMinutes(date: Date, timeZone: string) {
 const value = parts(date, timeZone)
 return Math.round(
  (Date.UTC(
   Number(value.year),
   Number(value.month) - 1,
   Number(value.day),
   Number(value.hour),
   Number(value.minute),
   Number(value.second)
  ) -
   date.getTime()) /
   60000
 )
}

function offsetText(minutes: number) {
 const sign = minutes >= 0 ? '+' : '-'
 const absolute = Math.abs(minutes)
 return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
}

/** 把带时区偏移的 ISO 时间转换成课表时区里的可编辑日期时间。 */
export function dateTimeInZone(iso: string, timeZone: string): CalendarDateTime | null {
 const millis = Date.parse(iso)
 if (!Number.isFinite(millis) || !validTimeZone(timeZone)) return null
 try {
  const value = parts(new Date(millis), timeZone)
  return parseDateTime(`${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`)
 } catch {
  return null
 }
}

/** 把课表时区里的日期时间写回带明确偏移的 ISO 字符串。 */
export function isoFromDateTime(value: CalendarDateTime, timeZone: string) {
 const wallClock = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second || 0)
 let millis = wallClock - offsetMinutes(new Date(wallClock), timeZone) * 60000
 const adjusted = offsetMinutes(new Date(millis), timeZone)
 millis = wallClock - adjusted * 60000
 return `${value.year}-${pad(value.month)}-${pad(value.day)}T${pad(value.hour)}:${pad(value.minute)}:00${offsetText(
  offsetMinutes(new Date(millis), timeZone)
 )}`
}

export function formatDateTime(iso: string, timeZone: string) {
 const millis = Date.parse(iso)
 if (!Number.isFinite(millis)) return ''
 try {
  return new Date(millis).toLocaleString('zh-CN', {
   timeZone: validTimeZone(timeZone) ? timeZone : undefined,
   month: 'numeric',
   day: 'numeric',
   hour: '2-digit',
   minute: '2-digit'
  })
 } catch {
  return ''
 }
}

export function formatTime(iso: string, timeZone: string) {
 const millis = Date.parse(iso)
 if (!Number.isFinite(millis)) return ''
 try {
  return new Date(millis).toLocaleTimeString('zh-CN', {
   timeZone: validTimeZone(timeZone) ? timeZone : undefined,
   hour: '2-digit',
   minute: '2-digit'
  })
 } catch {
  return ''
 }
}

export function formatDay(iso: string, timeZone: string) {
 const millis = Date.parse(iso)
 if (!Number.isFinite(millis)) return '时间待定'
 try {
  const date = new Date(millis),
   zone = validTimeZone(timeZone) ? timeZone : undefined,
   day = date.toLocaleDateString('zh-CN', {timeZone: zone, month: 'long', day: 'numeric'}),
   weekday = date.toLocaleDateString('zh-CN', {timeZone: zone, weekday: 'short'})
  return `${day} · ${weekday}`
 } catch {
  return '时间待定'
 }
}
