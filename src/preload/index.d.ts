import type { LucaApi } from '../shared/api'

declare global {
  interface Window {
    luca: LucaApi
  }
}

export {}
