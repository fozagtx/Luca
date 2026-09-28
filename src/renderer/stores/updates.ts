import { create } from 'zustand'
import { toast } from 'sonner'
import type { UpdateStatus } from '@shared/types'
import { luca } from '../lib/luca'
import { errorMessage } from './project'

type UpdatesStore = {
  /** null until main has answered. */
  status: UpdateStatus | null
  /** The Updates sheet (Luca → Check for Updates…). */
  open: boolean
  setOpen: (open: boolean) => void
  /** Open the sheet and ask GitHub now. */
  check: () => Promise<void>
  /** Quit and open the downloaded Luca (says why not, while an export or Luca's work runs). */
  install: () => Promise<void>
  /** Rejects with a plain message when GitHub refuses the token. */
  saveToken: (token: string) => Promise<void>
  moveToApplications: () => Promise<void>
}

/** Luca updating itself from its GitHub releases. */
export const useUpdates = create<UpdatesStore>((set) => ({
  status: null,
  open: false,
  setOpen: (open) => set({ open }),
  check: async () => {
    set({ open: true })
    try {
      set({ status: await luca.updates.check() })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  },
  install: async () => {
    try {
      await luca.updates.install()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  },
  saveToken: async (token) => {
    try {
      set({ status: await luca.updates.setToken(token) })
    } catch (err) {
      throw new Error(errorMessage(err))
    }
  },
  moveToApplications: async () => {
    try {
      await luca.updates.moveToApplications()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }
}))
