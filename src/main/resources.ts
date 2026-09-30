/** Where bundled resources live: in the repo while developing, unpacked next to the app once packaged. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function bundledResourcesDir(sub: 'fonts' | 'luts' | 'components'): string {
  const unpacked = join(process.resourcesPath ?? '', 'app.asar.unpacked', 'resources', sub)
  return process.resourcesPath && existsSync(unpacked)
    ? unpacked
    : join(__dirname, '../../resources', sub)
}

/** resources/fonts/: the fonts that come with Luca. */
export function bundledFontsDir(): string {
  return bundledResourcesDir('fonts')
}

/** resources/luts/: the .cube LUTs that come with Luca. */
export function bundledLutsDir(): string {
  return bundledResourcesDir('luts')
}
