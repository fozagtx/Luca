/** Every Studio kind, by name. Each lives in its own file and draws one beat's graphic. */
import type { StudioKind } from '../schema'
import { app } from './app'
import { compare } from './compare'
import { cta } from './cta'
import { icons } from './icons'
import { image } from './image'
import { list } from './list'
import { number } from './number'
import { pills } from './pills'
import { price } from './price'
import { quote } from './quote'
import { rank } from './rank'
import { terminal } from './terminal'
import { title } from './title'
import type { KindModule } from './types'
import { wave } from './wave'
import { win } from './window'

export const KINDS: { [K in StudioKind]: KindModule<K> } = {
  title,
  icons,
  app,
  list,
  window: win,
  wave,
  price,
  compare,
  pills,
  number,
  cta,
  image,
  quote,
  rank,
  terminal
}
