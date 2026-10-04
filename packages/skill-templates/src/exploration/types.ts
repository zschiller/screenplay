import type { Img } from "../shared/shots.tsx"

export type Option = {
  id: string
  name: string
  why?: string
  cost?: string
  rec?: boolean
  state?: "" | "picked" | "rejected"
  shots?: Img[]
  html?: string
}

export type Question = {
  key: string
  title?: string
  intro?: string
  options: Option[]
}

export type Round = {
  n: number
  feedback?: string
  every?: string | string[]
  questions: Question[]
}

export type Page = { date: string; slug: string; quote: string; q: string }
export type Today = { facts?: string | string[]; shots?: Img[]; html?: string }

