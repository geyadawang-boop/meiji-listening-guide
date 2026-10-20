import type {Highlight} from '@shared/study'

export type Book = {id: string; path: string; pages: number}
export type Draft = {id: string; rows: Highlight[]}
