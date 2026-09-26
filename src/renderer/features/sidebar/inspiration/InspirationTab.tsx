import { ArrowUpRight, Clock } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { toLibrary, type LibraryItem } from '../../../../shared/catalog'
import type { CatalogItem } from '../../../../shared/types'
import { Thumb } from '../../../components/ui/thumb'
import { formatDuration, relativeDate } from '../../../lib/format'
import { catalogChip } from '../../../lib/drag'
import { luca } from '../../../lib/luca'
import { useChat } from '../../../stores/chat'
import { useProject } from '../../../stores/project'
import { useUi } from '../../../stores/ui'
import { ItemPreview } from '../catalog/CatalogTab'
import { dragOf } from '../catalog/library-actions'
import { PaneHead } from '../Sidebar'

type Idea = {
  title: string
  blurb: string
  /** Put in the chat box; people finish the sentence themselves. */
  prompt: string
  /** HyperFrames catalog item that shows the idea and is attached for Luca. */
  item: string
}

const SECTIONS: { title: string; ideas: Idea[] }[] = [
  {
    title: 'Start strong',
    ideas: [
      {
        title: 'A bold opening title',
        blurb: 'Grab attention in the first three seconds.',
        prompt: 'Open the video with a bold title that says ',
        item: 'glass-shard-title'
      },
      {
        title: 'Your name on screen',
        blurb: 'A clean lower third when you first appear.',
        prompt: 'Add a lower third with my name and role when I first appear: ',
        item: 'yt-lower-third'
      },
      {
        title: 'A logo ending',
        blurb: 'Close on your brand and one clear ask.',
        prompt: 'End the video with my logo and this call to action: ',
        item: 'logo-outro'
      }
    ]
  },
  {
    title: 'Captions that pop',
    ideas: [
      {
        title: 'Karaoke captions',
        blurb: 'Every word lights up as you say it.',
        prompt: 'Add karaoke-style captions that highlight each word as I say it',
        item: 'caption-pill-karaoke'
      },
      {
        title: 'Highlight the key words',
        blurb: 'Make the important words impossible to miss.',
        prompt: 'Add captions and highlight the key words in yellow',
        item: 'caption-highlight'
      },
      {
        title: 'Emoji captions',
        blurb: 'Playful, social-style captions.',
        prompt: 'Add social-style captions with emoji that pop on the important words',
        item: 'caption-emoji-pop'
      }
    ]
  },
  {
    title: 'Smooth transitions',
    ideas: [
      {
        title: 'Whip pan',
        blurb: 'A fast, energetic move between scenes.',
        prompt: 'Add a whip-pan transition between my scenes',
        item: 'whip-pan'
      },
      {
        title: 'Light leak',
        blurb: 'A warm, filmic flash at the cut.',
        prompt: 'Add a warm light-leak transition at the cut',
        item: 'light-leak'
      },
      {
        title: 'Cinematic zoom',
        blurb: 'Punch in on the moment that matters.',
        prompt: 'Punch in with a cinematic zoom on the most important moment',
        item: 'cinematic-zoom'
      }
    ]
  },
  {
    title: 'Social and data',
    ideas: [
      {
        title: 'Follow card',
        blurb: 'Invite viewers to follow you at the end.',
        prompt: 'Add a TikTok follow card at the end with my handle: @',
        item: 'tiktok-follow'
      },
      {
        title: 'Notification pop',
        blurb: 'A native-looking alert slides into the corner.',
        prompt: 'Pop a notification into the corner that says ',
        item: 'macos-notification'
      },
      {
        title: 'Animated chart',
        blurb: 'Turn numbers into a quick visual story.',
        prompt: 'Add an animated chart showing ',
        item: 'data-chart'
      }
    ]
  }
]

function tryIdea(idea: Idea, item: LibraryItem | undefined): void {
  const chat = useChat.getState()
  if (item) chat.addChip(catalogChip(dragOf(item)))
  chat.setDraft(idea.prompt)
  if (!useUi.getState().chatOpen) useUi.getState().toggleChat()
  requestAnimationFrame(() => {
    const el = document.getElementById('chat-composer') as HTMLTextAreaElement | null
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  })
}

export function InspirationTab(): ReactElement {
  const project = useProject((s) => s.project)
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null)

  useEffect(() => {
    let live = true
    void luca.catalog
      .list()
      .catch((): CatalogItem[] => [])
      .then((c) => live && setCatalog(c))
    return () => {
      live = false
    }
  }, [])

  const byName = useMemo(() => {
    const m = new Map<string, LibraryItem>()
    for (const i of toLibrary(catalog ?? [], [])) m.set(i.name, i)
    return m
  }, [catalog])

  return (
    <div className="flex h-full flex-col">
      <PaneHead title="Inspiration" />
      <div className="scroll min-h-0 flex-1 px-2.5 pt-2.5 pb-3">
        {!project ? <RecentProjects /> : null}
        <p className="px-0.5 pb-3 text-[12px] leading-[1.5] text-text-2">
          {project
            ? 'Pick an idea and Luca will build it into your video. You can change the words before sending.'
            : 'Open a project, then pick an idea and Luca will build it into your video.'}
        </p>
        <div className="flex flex-col gap-5">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <div className="mb-2 px-0.5 text-[12px] font-semibold text-text">{s.title}</div>
              <div className="flex flex-col gap-2.5">
                {s.ideas.map((idea) => (
                  <IdeaCard
                    key={idea.item}
                    idea={idea}
                    item={byName.get(idea.item)}
                    loading={catalog === null}
                    disabled={!project}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

function IdeaCard({
  idea,
  item,
  loading,
  disabled
}: {
  idea: Idea
  item: LibraryItem | undefined
  loading: boolean
  disabled: boolean
}): ReactElement {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => tryIdea(idea, item)}
      className="card card-hover group flex w-full gap-2.5 p-1.5 text-left disabled:pointer-events-none disabled:opacity-60"
    >
      <div className="w-[104px] shrink-0">
        {item ? (
          <ItemPreview item={item} hover={hover} className="rounded-[6px]" />
        ) : (
          <div
            className={
              loading
                ? 'skeleton aspect-video rounded-[6px]'
                : 'aspect-video rounded-[6px] bg-bg-muted'
            }
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col py-0.5 pr-1">
        <div className="flex items-start gap-1">
          <span className="flex-1 text-[12px] leading-[1.3] font-medium text-text">
            {idea.title}
          </span>
          <ArrowUpRight
            size={13}
            className="mt-px shrink-0 text-text-3 transition-[color,transform] duration-150 group-hover:translate-x-px group-hover:-translate-y-px group-hover:text-accent"
          />
        </div>
        <span className="mt-0.5 line-clamp-2 text-[11px] leading-[1.4] text-text-3">
          {idea.blurb}
        </span>
      </div>
    </button>
  )
}

function RecentProjects(): ReactElement | null {
  const recent = useProject((s) => s.recent)
  const open = useProject((s) => s.open)
  if (recent.length === 0) return null
  return (
    <section className="mb-4">
      <div className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[12px] font-semibold text-text">
        <Clock size={12} strokeWidth={2} className="text-text-3" /> Recent projects
      </div>
      <ul className="-mx-1">
        {recent.slice(0, 5).map((r) => (
          <li key={r.dir}>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 rounded-[7px] px-1 py-1.5 text-left transition-colors hover:bg-hover active:bg-press"
              onClick={() => void open(r.dir)}
            >
              <Thumb
                src={r.thumb}
                lazy={false}
                className="h-8 w-14 shrink-0 rounded-[5px] ring-1 ring-border"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-text">{r.name}</div>
                <div className="truncate text-[11px] text-text-3">
                  {relativeDate(r.lastOpenedAt)}
                  {r.duration ? ` · ${formatDuration(r.duration)}` : ''}
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
