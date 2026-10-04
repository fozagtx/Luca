/** quote: not built yet — a placeholder that names the beat so the pipeline runs end to end. */
import { esc } from '../parts'
import { t, when, type KindModule } from './types'

export const quote: KindModule<'quote'> = {
  render: (g, ctx) => ({
    html: `<div class="ls-todo" style="font: 600 ${Math.round(60 * ctx.k)}px var(--display), sans-serif; color: var(--fg)">${esc(g.kind)}</div>`,
    js: `H.blurIn(H.q('.ls-todo', G), ${t(when(g.at, ctx.start, ctx.start))});`
  })
}
