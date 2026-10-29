export type EffectInfo = {
  id: string
  title: string
  description: string
  options: string
  aliases: string[]
}

export const EFFECTS: EffectInfo[] = [
  {
    id: 'noise',
    title: 'Noise',
    description: 'Reels pile up behind your head, one every quarter second',
    options: '`images` (folder of screenshots or clips), `size`',
    aliases: ['the-noise']
  },
  {
    id: 'lineup',
    title: 'Lineup',
    description: 'Numbered tiles fan out in an arc above your head',
    options: '`text` (tile names joined with `|`)',
    aliases: ['the-lineup']
  },
  {
    id: 'locked-on',
    title: 'Locked on',
    description: 'Corner brackets snap onto your face, the camera follows you',
    options: '`zoom` (default 1.35), `text` (tag)',
    aliases: []
  },
  {
    id: 'orbit',
    title: 'Orbit',
    description: 'Your reels circle your head: in front at the bottom, behind at the top',
    options: '`images`, `count`, `speed`, `size`',
    aliases: []
  },
  {
    id: 'lean-in',
    title: 'Lean-in',
    description: 'A fast punch-in on one word',
    options: '`zoom` (default 1.45, max 2), `speed`',
    aliases: []
  },
  {
    id: 'backdrop-word',
    title: 'Backdrop word',
    description: 'A giant word drops in behind you',
    options: '`text`, `color` (hex), `font` (`bold` or `serif`)',
    aliases: ['backdrop']
  },
  {
    id: 'spotlight',
    title: 'Spotlight',
    description: 'Kills the lights, keeps you lit',
    options: '`text` (glowing word behind you), `color`, `push`',
    aliases: []
  },
  {
    id: 'the-bill',
    title: 'The bill',
    description: 'Prints your instructions like a receipt into the wall above your head',
    options: '`text` (lines joined with `|`)',
    aliases: ['bill']
  },
  {
    id: 'moody',
    title: 'Moody',
    description: 'A moody colour grade',
    options: '`grade` (`moody`, `bw`, `warm`, `cool`, `pop`)',
    aliases: []
  },
  {
    id: 'swipe',
    title: 'Swipe',
    description: 'A before and after slider sweeps across you',
    options: '`grade` (the "after" look)',
    aliases: []
  },
  {
    id: 'todo',
    title: 'Todo',
    description: 'A checklist card beside your head ticks off as you talk',
    options: '`text` (items with `|`), `ticks` (video seconds with `|`), `title`',
    aliases: ['to-do', 'the-todo', 'the-to-do']
  },
  {
    id: 'comment-box',
    title: 'Comment box',
    description: 'An Instagram comment bar types a word and posts it',
    options: '`text` (default EFFECTS)',
    aliases: ['comment']
  },
  {
    id: 'tap',
    title: 'Tap',
    description: 'A Follow button pops up and flips to Following',
    options: '`at` (video second of the flip), `x`, `y` (0 to 1), `color`',
    aliases: ['the-tap', 'follow']
  },
  {
    id: 'pause-point',
    title: 'Pause point',
    description: 'Freezes the frame and points at you with a hand-drawn arrow',
    options: '`text` (label), `color`, `label_x`',
    aliases: ['pause', 'pause-and-point']
  },
  {
    id: 'uninstall',
    title: 'Uninstall',
    description: 'A glitchy uninstall bar breaks the frame apart',
    options: '`text`',
    aliases: []
  },
  {
    id: 'reel-frame',
    title: 'Reel frame',
    description: 'Your video shrinks into an Instagram reel card',
    options: '`text` (handle)',
    aliases: []
  },
  {
    id: 'shortcut-rain',
    title: 'Shortcut rain',
    description: 'Keyboard keys rain down behind you',
    options: '`text` (keys with `|`), `count`',
    aliases: ['rain']
  },
  {
    id: 'reject-stamp',
    title: 'Reject stamp',
    description: 'A big red stamp slams onto the screen',
    options: '`text`, `color`, `angle`, `y`',
    aliases: ['stamp']
  },
  {
    id: 'countdown-flip',
    title: 'Countdown flip',
    description: 'A 3, 2, 1 flip clock above your head',
    options: '`from`',
    aliases: ['countdown']
  },
  {
    id: 'rabbit-hole',
    title: 'Rabbit hole',
    description: 'The frame tunnels into itself, spinning',
    options: '`ratio`, `speed`, `spin`',
    aliases: []
  },
  {
    id: 'cover-star',
    title: 'Cover star',
    description: 'You become a magazine cover, title behind your head',
    options: '`text` (title), `lines` (with `|`), `issue`, `color`',
    aliases: ['cover']
  },
  {
    id: 'scribble',
    title: 'Scribble',
    description: 'Marker doodles draw themselves around you',
    options: '`text` (label), `color`',
    aliases: []
  },
  {
    id: 'glass-widgets',
    title: 'Glass widgets',
    description:
      'Frosted glass widgets and mini artifacts float around your head, plus an Edited by Claude pill',
    options: '`text` (big number), `name`, `handle`, `look` (`simple` for the 3-widget version)',
    aliases: ['glass', 'widgets']
  },
  {
    id: 'red-collage',
    title: 'Red collage',
    description: 'Black and white you, a giant red word behind, three lines slam in',
    options: '`text` (red word), `lines` (with `|`), `tag`',
    aliases: ['collage']
  },
  {
    id: 'split-headline',
    title: 'Split headline',
    description: 'A headline card slides down and pushes you to the bottom half',
    options: '`text` (lines with `|`), `hl` (highlighted word), `pill`',
    aliases: ['split']
  },
  {
    id: 'pastel-word',
    title: 'Pastel word',
    description: 'Lavender room, giant word behind you, a profile card gets followed',
    options: '`text`, `name`, `handle`',
    aliases: ['pastel']
  },
  {
    id: 'check-pills',
    title: 'Check pills',
    description: 'Grid-paper room, reel boards behind you, a cursor clicks blue pills',
    options: '`text` (pills with `|`), `images`',
    aliases: ['pills']
  },
  {
    id: 'timeline',
    title: 'Timeline',
    description:
      'A dark red film grade with an editing timeline, a REC timecode and a glowing playhead',
    options: '`text` (title), `sub`, `tc`',
    aliases: ['auto-edit']
  },
  {
    id: 'headline-box',
    title: 'Headline box',
    description: 'A punch-in with a two-line headline, the second line in a white box',
    options: '`text` (lines with `|`), `zoom`',
    aliases: ['headline']
  },
  {
    id: 'profile-wall',
    title: 'Profile wall',
    description: 'Your reels grid fills the wall behind your head while a counter ticks up',
    options: '`images`, `count`, `label`',
    aliases: ['wall']
  },
  {
    id: 'tier-list',
    title: 'Tier list',
    description: 'A tier list drops in and Claude flies into S tier',
    options: '`title`, `item`, `others`',
    aliases: ['tiers', 'tier']
  },
  {
    id: 'broll-split',
    title: 'B-roll split',
    description: 'B-roll on top with a price-tag sticker, you below',
    options: '`images`, `text` (tag)',
    aliases: ['broll', 'b-roll']
  },
  {
    id: 'phone-fan',
    title: 'Phone fan',
    description: 'Your reels fan out like a hand of phones under a headline',
    options: '`images`, `text` (lines with `|`)',
    aliases: ['fan']
  },
  {
    id: 'dot-reveal',
    title: 'Dot reveal',
    description: 'Your shot builds out of glowing dots, then snaps to the full picture',
    options: '`color`, `cell`',
    aliases: ['dots']
  },
  {
    id: 'headline-wall',
    title: 'Headline wall',
    description: 'Your own headlines pile up behind your head, then a total pops in front',
    options: '`text` (`headline::meta|...`), `total`, `label`',
    aliases: ['headlines']
  },
  {
    id: 'checklist',
    title: 'Checklist',
    description: 'A Claude task list under your chin: each step spins, then ticks green',
    options: '`text` (`step::meta|...`), `title`',
    aliases: ['tasks']
  },
  {
    id: 'liquid-glass-graph',
    title: 'Liquid glass graph',
    description:
      'A liquid glass card under your chin: a green graph climbs while the number counts up',
    options: '`text` (label), `from`, `to` (e.g. `197K`, `59%`), `color`',
    aliases: ['liquid-glass', 'glass-graph']
  },
  {
    id: 'carousel-spin',
    title: 'Carousel spin',
    description: 'Your reels spin around you in a 3D carousel, then slow to a stop',
    options: '`images`, `count`, `size`, `turns`',
    aliases: ['carousel']
  },
  {
    id: 'match-cut',
    title: 'Match cut',
    description: 'News pages cut on one word, locked in a red box behind your head',
    options: '`text` (the word, default Claude), `color`',
    aliases: ['match']
  },
  {
    id: 'apple-toggles',
    title: 'Apple toggles',
    description:
      'An iPhone settings card under your chin flips its switches on, one line at a time',
    options: '`text` (rows with `|`), `ticks` (seconds with `|`), `color`',
    aliases: ['toggles']
  },
  {
    id: 'led-sign',
    title: 'LED sign',
    description: 'The lights drop and a glowing LED sign types itself out behind you',
    options: '`text` (lines with `|`), `color`, `push`',
    aliases: ['led']
  },
  {
    id: 'slow-push',
    title: 'Slow push',
    description: 'A slow cinematic push-in to your face while the room melts out of focus',
    options: '`zoom` (default 1.6), `blur`',
    aliases: ['push', 'push-in']
  },
  {
    id: 'over-the-shoulder-zoom',
    title: 'Over the shoulder zoom',
    description:
      'The camera pushes into one top corner and a see-through liquid glass graph pops beside your head (line climbs, number counts up), pulls back, then the other corner with a second, related bar graph. Your head stays in front',
    options:
      '`text` (two labels with `|`), `to` (two numbers with `|`, e.g. `197K|672K`), `zoom` (default 2.0)',
    aliases: ['ots', 'shoulder-zoom', 'corner-zoom']
  },
  {
    id: 'messages',
    title: 'Messages',
    description:
      'iMessage notifications pop in one after another, creamy glass with a soft glow, stacking up above the bottom of the frame',
    options: '`text` (messages with `|`), `title` (default Messages), `y`',
    aliases: ['imessage', 'texts', 'notifications']
  },
  {
    id: 'place-in-grid',
    title: 'Place in grid',
    description:
      'You shrink into the centre tile of your 3x3 profile grid on frosted glass, then 8 reels pop in around you, one per frame, with Instagram view counts on every tile',
    options:
      '`images` (folder of your reels or covers), `views` (9 counts with `|`, the 9th is yours)',
    aliases: ['grid', 'profile-grid']
  },
  {
    id: 'documentary',
    title: 'Documentary',
    description:
      'Black and white you over a glowing pink circle behind your head, a kicker line and a three-line headline slam in, a name bar slides in, then a Follow button flips to Following',
    options:
      '`text` (lines with `|`), `kicker`, `name`, `handle`, `ghost` (faint big word), `color`',
    aliases: ['doc']
  },
  {
    id: 'kallaway-split',
    title: 'Kallaway split',
    description:
      'You shrink into a rounded card in the bottom half while a bar chart grows on a cream grid panel up top, with a serif highlight word, counting labels and an average line',
    options:
      '`title` (two lines with `|`, last word goes red serif), `bars` (`value::label|...`, e.g. `197K::Data`), `color`, `bg`',
    aliases: ['kallaway', 'chart-split']
  },
  {
    id: 'glitter-spotlight',
    title: 'Glitter spotlight',
    description:
      'The room goes dark, golden rays burst from behind your head, a big gold word with a shine sweep, twinkling sparkles and a glow around you',
    options: '`text` (the word), `color`, `push`',
    aliases: []
  }
]

export function findEffects(query: string): EffectInfo[] {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return EFFECTS
  const starts = EFFECTS.filter((effect) =>
    [effect.id, effect.title, ...effect.aliases].some((field) =>
      field.toLocaleLowerCase().startsWith(q)
    )
  )
  const matched = new Set(starts.map((effect) => effect.id))
  return [
    ...starts,
    ...EFFECTS.filter(
      (effect) =>
        !matched.has(effect.id) &&
        [effect.id, effect.title, ...effect.aliases, effect.description].some((field) =>
          field.toLocaleLowerCase().includes(q)
        )
    )
  ]
}
