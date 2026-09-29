import {
  LANGUAGES,
  languageFor,
  type Ai33Voice,
  type Ai33VoiceTier,
  type VoiceRef
} from '@shared/ai33'
import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement, type RefObject } from 'react'
import { Button } from '../../components/ui/button'
import { Segmented, type SegmentedItem } from '../../components/ui/segmented'
import { cn } from '../../lib/cn'
import { luca } from '../../lib/luca'
import { useAi33 } from '../../stores/ai33'
import { VoiceList, VoiceSkeleton, type VoiceGroup } from './VoiceList'
import { TIERS } from './voice-meta'

type GenderFilter = 'any' | 'female' | 'male'
type Filters = { query: string; language: string; gender: GenderFilter }
/** One tier's voices so far; null when that tier couldn't be loaded. */
type TierVoices = { voices: Ai33Voice[]; hasMore: boolean; page: number; note?: string }
type Tiers = Record<Ai33VoiceTier, TierVoices | null>
type Loaded = { key: string; tiers: Tiers | null }

const GENDERS: SegmentedItem<GenderFilter>[] = [
  { id: 'any', label: 'Any' },
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' }
]

const PAGE_SIZE = 20
const SEARCH_DELAY_MS = 250

const NO_KEY = 'Connect ai33 first to hear voices.'
const LOAD_FAILED = 'Couldn’t load voices. Check your internet connection and try again.'
const NONE_FOUND = 'No voices match that. Try fewer words.'
// also the sentence main puts in a Studio page's note when the service is overloaded
const STUDIO_BUSY =
  'Studio voices are busy right now. Standard voices still work, or try again in a few minutes.'

const fieldClass =
  'h-7 rounded-[7px] border border-transparent bg-bg-muted text-[12px] text-text transition-[background-color,border-color] duration-150 ease-out hover:bg-hover focus:border-border focus:bg-bg'

async function loadTier(tier: Ai33VoiceTier, f: Filters, page: number): Promise<TierVoices | null> {
  const language = LANGUAGES.find((l) => l.id === f.language)?.name
  try {
    const res = await luca.ai33.voices({
      tier,
      page,
      limit: PAGE_SIZE,
      ...(f.query ? { query: f.query } : {}),
      ...(language ? { language } : {}),
      ...(f.gender !== 'any' ? { gender: f.gender } : {})
    })
    return { voices: res.voices, hasMore: res.hasMore, page, note: res.note }
  } catch {
    return null
  }
}

/** Every tier at once, so one that is down doesn't hide the others; null when none loaded. */
async function loadTiers(f: Filters): Promise<Tiers | null> {
  const [studio, standard, yours] = await Promise.all(TIERS.map((t) => loadTier(t.id, f, 1)))
  return studio || standard || yours ? { studio, standard, yours } : null
}

export type VoicePanelProps = {
  value: VoiceRef | null
  /** The voice to use. */
  onPick(v: Ai33Voice): void
  /** The script's language: voices for it are listed, and Standard voices in others are greyed. */
  language?: string
  /** The search box, so the popover can put the caret there. */
  searchRef?: RefObject<HTMLInputElement | null>
}

/**
 * What is inside the voice picker: search, language and gender, then the voices by kind, each
 * with a play button. Loads when it appears (main keeps voices for ten minutes).
 */
export function VoicePanel({ value, onPick, language, searchRef }: VoicePanelProps): ReactElement {
  const hasKey = useAi33((s) => s.hasKey)
  const health = useAi33((s) => s.health)
  const checkKey = useAi33((s) => s.checkKey)
  const refresh = useAi33((s) => s.refresh)
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [lang, setLang] = useState(() => languageFor(language)?.id ?? '')
  const [gender, setGender] = useState<GenderFilter>('any')
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [more, setMore] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const filters: Filters = { query, language: lang, gender }
  const key = `${query}\u0000${lang}\u0000${gender}`

  useEffect(() => {
    if (hasKey === null) void checkKey()
    // the balance and how busy the voice services are, for the note above the list
    else if (hasKey) void refresh()
  }, [hasKey, checkKey, refresh])

  // the search box waits for a pause in typing
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), SEARCH_DELAY_MS)
    return () => clearTimeout(t)
  }, [text])

  // the answer for the filters on screen (an older one stays up, dimmed, until it arrives)
  const current = loaded?.key === key ? loaded : null
  const settled = current !== null
  useEffect(() => {
    if (hasKey !== true || settled) return
    let live = true
    void loadTiers({ query, language: lang, gender }).then((tiers) => {
      if (live) setLoaded({ key, tiers })
    })
    return () => {
      live = false
    }
  }, [hasKey, settled, key, attempt, query, lang, gender])

  const showMore = async (): Promise<void> => {
    if (!current?.tiers || more) return
    setMore(true)
    const { key: forKey, tiers: before } = current
    const next = await Promise.all(
      TIERS.map(async (t): Promise<TierVoices | null> => {
        const had = before[t.id]
        if (!had?.hasMore) return had
        const page = await loadTier(t.id, filters, had.page + 1)
        if (!page) return had
        const seen = new Set(had.voices.map((v) => v.id))
        return { ...page, voices: [...had.voices, ...page.voices.filter((v) => !seen.has(v.id))] }
      })
    )
    const [studio, standard, yours] = next
    // filters changed while this was loading: the answer belongs to a list that is gone
    setLoaded((now) =>
      now?.key === forKey ? { key: forKey, tiers: { studio, standard, yours } } : now
    )
    setMore(false)
  }

  const retry = (): void => {
    setLoaded(null)
    setAttempt((a) => a + 1)
  }

  const tiers = loaded?.tiers ?? null
  const failed = current !== null && current.tiers === null
  const groups: VoiceGroup[] = tiers
    ? TIERS.flatMap((t) => {
        const voices = tiers[t.id]?.voices ?? []
        return voices.length ? [{ key: t.id, tier: t.id, voices }] : []
      })
    : []
  // Studio is down, or main or the account says it is overloaded: a note, never an error
  const busy =
    tiers !== null &&
    (tiers.studio === null ||
      tiers.studio.note === STUDIO_BUSY ||
      health.elevenlabs === 'overloaded' ||
      health.minimax === 'overloaded')
  const notes = [
    ...new Set(
      TIERS.map((t) => tiers?.[t.id]?.note).filter((n): n is string => !!n && n !== STUDIO_BUSY)
    )
  ]
  const hasMore = TIERS.some((t) => tiers?.[t.id]?.hasMore)
  // results of the last filters stay on screen, dimmed, while the new ones load
  const stale = tiers !== null && !settled

  if (hasKey === false)
    return <p className="px-3 pb-3 text-[12px] leading-[1.45] text-text-2">{NO_KEY}</p>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 px-3 pb-2">
        <div className="relative">
          <Search
            size={13}
            strokeWidth={1.75}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-3"
          />
          <input
            ref={searchRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setQuery(text.trim())
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                list.current?.querySelector<HTMLElement>('[role="option"][tabindex="0"]')?.focus()
              } else if (e.key === 'Escape' && text) {
                e.stopPropagation()
                setText('')
              }
            }}
            placeholder="A warm woman, a deep voice…"
            aria-label="Search voices"
            className={cn(fieldClass, 'w-full pr-7 pl-8 placeholder:text-text-3')}
          />
          {text ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setText('')
                setQuery('')
                searchRef?.current?.focus()
              }}
              className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-text-3 hover:bg-hover hover:text-text"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            aria-label="Language"
            className={cn(fieldClass, 'min-w-0 flex-1 px-2')}
          >
            <option value="">Any language</option>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <Segmented
            items={GENDERS}
            value={gender}
            onChange={setGender}
            ariaLabel="Voice type"
            className="shrink-0"
          />
        </div>
      </div>

      {busy || notes.length ? (
        <div className="flex flex-col gap-1 px-3 pb-2" role="note">
          {busy ? (
            <p className="rounded-[7px] bg-bg-muted px-2 py-1.5 text-[11px] leading-[1.4] text-text-2">
              {STUDIO_BUSY}
            </p>
          ) : null}
          {notes.map((n) => (
            <p key={n} className="text-[11px] leading-[1.4] text-text-3">
              {n}
            </p>
          ))}
        </div>
      ) : null}

      <div
        ref={list}
        className={cn(
          'scroll min-h-0 flex-1 px-1.5 pb-1.5 transition-opacity',
          stale && 'opacity-60'
        )}
        aria-busy={hasKey === null || !settled || undefined}
      >
        {failed ? (
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center" role="alert">
            <p className="text-[12px] leading-[1.45] text-text-2">{LOAD_FAILED}</p>
            <Button size="sm" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : !tiers ? (
          <VoiceSkeleton />
        ) : groups.length === 0 ? (
          <p className="px-6 py-8 text-center text-[12px] text-text-3" role="status">
            {NONE_FOUND}
          </p>
        ) : (
          <>
            <VoiceList
              groups={groups}
              ariaLabel="Voices"
              headings
              useLabel="Use"
              chosenLabel="In use"
              selectedId={value?.id}
              language={language}
              onUse={onPick}
              onLeaveTop={() => searchRef?.current?.focus()}
            />
            {hasMore ? (
              <div className="flex justify-center pt-2 pb-1">
                <Button size="sm" loading={more} onClick={() => void showMore()}>
                  Show more voices
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {groups.length > 0 ? (
        <div className="border-t border-border px-3 py-1.5 text-[10.5px] text-text-3">
          ↑ ↓ to move · Space to hear · Enter to use
        </div>
      ) : null}
    </div>
  )
}
