import {
  Menu,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents
} from 'electron'

const SEPARATOR: MenuItemConstructorOptions = { type: 'separator' }

/** "Look Up “a long sentence…”", as macOS shortens it. */
function quoted(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return `“${t.length > 24 ? `${t.slice(0, 24).trimEnd()}…` : t}”`
}

/** Whether the point holds text people can select (most of the window is set not to be). */
async function selectableAt(wc: WebContents, x: number, y: number): Promise<boolean> {
  const check = `(() => {
    const el = document.elementFromPoint(${Math.round(x)}, ${Math.round(y)})
    return !!el && el.tagName !== 'IFRAME' && getComputedStyle(el).userSelect !== 'none' &&
      !!el.textContent && el.textContent.trim().length > 0
  })()`
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250))
  try {
    return await Promise.race([wc.mainFrame.executeJavaScript(check) as Promise<boolean>, timeout])
  } catch {
    return false
  }
}

async function itemsFor(
  wc: WebContents,
  p: ContextMenuParams
): Promise<MenuItemConstructorOptions[]> {
  const f = p.editFlags
  const text = p.selectionText.trim()
  const groups: MenuItemConstructorOptions[][] = []

  // spelling first, the way macOS lists it
  if (p.isEditable && p.misspelledWord) {
    const fixes = p.dictionarySuggestions.slice(0, 5)
    groups.push([
      ...(fixes.length
        ? fixes.map((s) => ({ label: s, click: () => wc.replaceMisspelling(s) }))
        : [{ label: 'No Guesses Found', enabled: false }]),
      {
        label: 'Learn Spelling',
        click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord)
      }
    ])
  }
  if (text && process.platform === 'darwin')
    groups.push([
      { label: `Look Up ${quoted(text)}`, click: () => wc.showDefinitionForSelection() }
    ])

  if (p.isEditable) {
    groups.push([
      { role: 'cut', enabled: f.canCut },
      { role: 'copy', enabled: f.canCopy },
      { role: 'paste', enabled: f.canPaste }
    ])
    groups.push([{ role: 'selectAll', enabled: f.canSelectAll }])
  } else {
    const copy: MenuItemConstructorOptions[] = []
    if (text) copy.push({ role: 'copy' })
    // the picture itself (not its address: a local URL is no use anywhere else)
    if (p.mediaType === 'image' && p.hasImageContents)
      copy.push({ label: 'Copy Image', click: () => wc.copyImageAt(p.x, p.y) })
    groups.push(copy)
    if (text || (p.mediaType === 'none' && (await selectableAt(wc, p.x, p.y))))
      groups.push([{ role: 'selectAll' }])
  }

  const nonEmpty = groups.filter((g) => g.length > 0)
  return nonEmpty.flatMap((g, i) => (i ? [SEPARATOR, ...g] : g))
}

/**
 * The right-click menu for text and pictures, which Electron leaves out: Copy for a selection,
 * Cut/Copy/Paste in text fields, Copy Image on pictures, Look Up on macOS. Places with a menu of
 * their own (timeline clips, looks) call preventDefault, so Electron never asks for this one.
 */
export function attachContextMenu(win: BrowserWindow): void {
  const wc = win.webContents
  wc.on('context-menu', (_e, params) => {
    void itemsFor(wc, params).then((items) => {
      // nothing to offer (a button, an empty panel): no menu rather than an empty one
      if (!items.length || win.isDestroyed()) return
      Menu.buildFromTemplate(items).popup({ window: win })
    })
  })
}
