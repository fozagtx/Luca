import type { ProviderKind, ProviderStatus } from '@shared/types'
import { create } from 'zustand'
import { luca } from '../lib/luca'
import { useChat } from './chat'

type ProviderStore = {
  /** null until loaded. */
  status: ProviderStatus | null
  load: () => Promise<void>
  /** Rejects with the provider's reason (bad endpoint, refused key, no models). */
  models: (baseUrl: string, key?: string) => Promise<string[]>
  save: (args: { baseUrl: string; key?: string; model: string }) => Promise<void>
  use: (kind: ProviderKind) => Promise<void>
  signOutClaude: () => Promise<void>
}

export const useProvider = create<ProviderStore>((set) => ({
  status: null,
  load: async () => set({ status: await luca.provider.status() }),
  models: (baseUrl, key) => luca.provider.models({ baseUrl, key }),
  save: async (args) => {
    set({ status: await luca.provider.save(args) })
    await useChat.getState().load()
  },
  use: async (kind) => {
    set({ status: await luca.provider.use(kind) })
    await useChat.getState().load()
  },
  signOutClaude: async () => {
    await luca.provider.signOutClaude()
    await useChat.getState().load()
  }
}))
