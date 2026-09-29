import {
  estimateSpoken,
  formatCredits,
  formatSpan,
  languageFor,
  LANGUAGES,
  type Ai33Voice,
  type Ai33VoiceTier,
  type Language,
  type VoiceRef
} from '@shared/ai33'
import { ArrowLeft, ChevronRight, Plus, X } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement
} from 'react'
import { Button } from '../../components/ui/button'
import { GenerateButton } from '../../components/ui/generate-button'
import { Input } from '../../components/ui/input'
import { Tip } from '../../components/ui/tooltip'
import { cn } from '../../lib/cn'
import { luca } from '../../lib/luca'
import { useAi33 } from '../../stores/ai33'
import { MAX_SAY, useStart } from '../../stores/start'
import { Ai33KeyCard } from '../ai33/Ai33KeyCard'
import { AudioPreview } from '../ai33/AudioPreview'
import { VoicePicker } from '../ai33/VoicePicker'
import { voiceLine } from '../ai33/voice-meta'

const TIER_TIPS: Record<Ai33VoiceTier, string> = {
  studio: 'Studio voices sound the most natural.',
  standard: 'Standard voices are simpler and sound more synthetic.',
  yours: 'Voices you made on ai33.'
}
const TIER_NAMES: Record<Ai33VoiceTier, string> = {
  studio: 'Studio',
  standard: 'Standard',
  yours: 'Yours'
}

const LABEL = 'text-[12.5px] font-semibold text-text'
const SELECT =
  'h-8 min-w-0 rounded-[8px] border border-border bg-bg px-2.5 text-[13px] text-text outline-none hover:border-border-strong'

/**
 * The top of the start card when there is no footage: the script, its language and voice, how to
 * say the names in it, and what it will cost. The kind of video, the steps, the notes and the
 * button are the card's own form below it.
 */
export function ScriptFields({ onGo }: { onGo: () => void }): ReactElement {
  const setScriptMode = useStart((s) => s.setScriptMode)
  const hasKey = useAi33((s) => s.hasKey)
  const wasOff = useRef(false)

  // whether there is a key (at once), then what it can spend (asks ai33, so it can take a while)
  useEffect(() => {
    void (async () => {
      if (await useAi33.getState().checkKey()) await useAi33.getState().refresh()
    })()
  }, [])

  // the key card goes away once connected, taking the focus with it: back to the script box (unless
  // the key was added somewhere else, like the Connections sheet, which has the focus now)
  useEffect(() => {
    if (hasKey === false) wasOff.current = true
    else if (hasKey === true && wasOff.current) {
      wasOff.current = false
      const active = document.activeElement
      const lost = !active || active === document.body
      // not while a sheet is open over the card: the key was added in it, and the focus stays there
      if (lost && !document.querySelector('[role="dialog"]'))
        document.getElementById('start-script')?.focus()
    }
  }, [hasKey])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-start gap-2">
        <Button size="sm" variant="ghost" className="-ml-2" onClick={() => setScriptMode(false)}>
          <ArrowLeft size={12} /> Drop a video instead
        </Button>
        <h2 className="text-[15px] font-semibold text-text">
          Paste your script. Luca records it and edits the video.
        </h2>
      </div>

      {hasKey === false ? <Ai33KeyCard context="start" className="fade-in" /> : null}

      <ScriptText onGo={onGo} />
      <Voice />
      <SayItRight />
      <SpendLine />
    </div>
  )
}

/** The script, with how long it takes to read out. */
function ScriptText({ onGo }: { onGo: () => void }): ReactElement {
  const text = useStart((s) => s.script.text)
  const setScript = useStart((s) => s.setScript)
  const ref = useRef<HTMLTextAreaElement>(null)
  const spoken = estimateSpoken(text)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 132), 320)}px`
  }, [text])

  // Enter is a new line in a script; ⌘↩ starts
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onGo()
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="start-script" className={LABEL}>
        Your script
      </label>
      <textarea
        ref={ref}
        id="start-script"
        value={text}
        onChange={(e) => setScript({ text: e.target.value })}
        onKeyDown={onKey}
        placeholder="Most people think compound interest is boring. Here’s why it isn’t…"
        rows={6}
        autoFocus
        aria-describedby="start-script-length"
        className="block w-full resize-none rounded-[10px] border border-border bg-bg px-3 py-2.5 text-[13px] leading-[20px] text-text transition-colors placeholder:text-text-3 focus:border-border-strong"
      />
      {spoken.words ? (
        <div id="start-script-length" className="text-[11px] text-text-3 tabular-nums">
          {spoken.words.toLocaleString('en-US')} {spoken.words === 1 ? 'word' : 'words'} · about{' '}
          {formatSpan(spoken.seconds)}
        </div>
      ) : (
        <span id="start-script-length" hidden />
      )}
    </div>
  )
}

type Card = { id: string; name: string; meta: string; tier: Ai33VoiceTier | null }

const voiceCard = (v: Ai33Voice): Card => ({
  id: v.id,
  name: v.name,
  // what ai33 says about the voice already ends with its gender
  meta: voiceLine(v),
  tier: v.tier
})

/** A few voices to hear, the language they speak, and every other voice behind "More voices…". */
function Voice(): ReactElement {
  const script = useStart((s) => s.script)
  const setScript = useStart((s) => s.setScript)
  const hasKey = useAi33((s) => s.hasKey)
  const [loaded, setLoaded] = useState<{
    key: string
    voices: Ai33Voice[]
    failed: boolean
  } | null>(null)
  const [tries, setTries] = useState(0)
  const language = languageFor(script.language) ?? LANGUAGES[0]
  const voice = script.voice
  const key = `${language.id}:${tries}`
  const suggested = loaded?.key === key ? loaded : null
  const connected = hasKey === true

  // three to start from, in the language: the one used last time for it first
  useEffect(() => {
    if (!connected) return
    let stale = false
    void suggest(language)
      .then(({ voices, last }) => {
        if (stale) return
        setLoaded({ key, voices, failed: false })
        // nothing chosen yet: the voice used last time for this language, else the first
        const first = last ?? voices[0]
        if (first && !useStart.getState().script.voice)
          setScript({ voice: { id: first.id, name: first.name, language: first.language } })
      })
      .catch(() => {
        if (!stale) setLoaded({ key, voices: [], failed: true })
      })
    return () => {
      stale = true
    }
  }, [connected, language, key, setScript])

  const listed = suggested?.voices ?? []
  const chosen: Card[] =
    voice && !listed.some((v) => v.id === voice.id)
      ? [{ id: voice.id, name: voice.name, meta: '', tier: null }]
      : []
  const cards = [...chosen, ...listed.map(voiceCard)].slice(0, 3)

  const pick = (v: VoiceRef): void => setScript({ voice: v })

  const row = (
    <div
      className={cn(
        'flex flex-col gap-2',
        // not while it says why: that text is the point, and "More voices…" greys itself out
        hasKey === null && 'pointer-events-none opacity-45'
      )}
    >
      {hasKey === false ? (
        // shimmering placeholders here would wait for voices that can't come without a key
        <div className="text-[12px] text-text-2">Connect ai33 to choose a voice.</div>
      ) : suggested?.failed ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-text-2">
          Couldn’t load voices. Check your internet connection and try again.
          <Button size="sm" variant="ghost" onClick={() => setTries((t) => t + 1)}>
            Try again
          </Button>
        </div>
      ) : !suggested || !cards.length ? (
        suggested ? (
          <div className="text-[12px] text-text-3">
            No voices to suggest for {language.name}. Luca picks one, or look through the others.
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-[58px] rounded-[12px]" />
            ))}
          </div>
        )
      ) : (
        <div
          role="radiogroup"
          aria-labelledby="start-voice-label"
          className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2"
        >
          {cards.map((c) => {
            const on = voice?.id === c.id
            const radio = (
              <button
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => pick({ id: c.id, name: c.name, language: language.name })}
                className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-[12px] p-2.5 pr-11 text-left"
              >
                <span className="truncate text-[12.5px] font-medium text-text">{c.name}</span>
                <span className="truncate text-[10.5px] text-text-3">
                  {[c.tier ? TIER_NAMES[c.tier] : '', c.meta].filter(Boolean).join(' · ') || ' '}
                </span>
              </button>
            )
            return (
              <div
                key={c.id}
                className={cn(
                  'relative flex items-center rounded-[12px] border transition-[background-color,border-color,box-shadow] duration-150',
                  on
                    ? 'border-accent bg-secondary shadow-[0_0_0_1px_var(--accent)]'
                    : 'border-border bg-bg hover:border-border-strong'
                )}
              >
                {c.tier ? (
                  <Tip label={TIER_TIPS[c.tier]} side="top">
                    {radio}
                  </Tip>
                ) : (
                  radio
                )}
                <span className="absolute top-1/2 right-2 -translate-y-1/2">
                  <AudioPreview voiceId={c.id} label={`Hear ${c.name}`} />
                </span>
              </div>
            )
          })}
        </div>
      )}
      {/* brings its own "More voices…" button, greyed out until ai33 is connected */}
      <div className="flex flex-wrap items-center gap-2">
        <VoicePicker value={voice} onChange={pick} language={language.name} />
      </div>
    </div>
  )

  return (
    <div className="grid gap-x-4 gap-y-5 sm:grid-cols-[minmax(0,180px)_1fr]">
      <div className="flex flex-col gap-2">
        <label htmlFor="start-language" className={LABEL}>
          Language
        </label>
        <select
          id="start-language"
          value={language.id}
          // a voice speaks one language: the new one starts from its own suggestions
          onChange={(e) => setScript({ language: e.target.value, voice: null })}
          className={SELECT}
        >
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <div className={LABEL} id="start-voice-label">
          Voice
        </div>
        {connected || hasKey === false ? (
          row
        ) : (
          <Tip label="Connect ai33 first" side="top">
            <div>{row}</div>
          </Tip>
        )}
      </div>
    </div>
  )
}

/** Studio voices for the language, else Standard, and the voice used last for it. */
async function suggest(lang: Language): Promise<{ voices: Ai33Voice[]; last: VoiceRef | null }> {
  const [settings, studio] = await Promise.all([
    luca.settings.get().catch(() => null),
    luca.ai33.voices({ tier: 'studio', language: lang.name, limit: 3 })
  ])
  const voices = studio.voices.length
    ? studio.voices
    : (await luca.ai33.voices({ tier: 'standard', language: lang.name, limit: 3 })).voices
  const saved = settings?.ai33?.lastVoice
  const last = saved?.[lang.id] ?? saved?.[lang.name] ?? saved?.[lang.bcp47] ?? null
  return { voices: voices.slice(0, 3), last }
}

/** Names and short forms the voice would get wrong: how each should sound. */
function SayItRight(): ReactElement {
  const say = useStart((s) => s.script.say)
  const setScript = useStart((s) => s.setScript)
  const [open, setOpen] = useState(false)
  const filled = say.filter((r) => r.word.trim() && r.as.trim()).length
  const change = (i: number, patch: { word?: string; as?: string }): void =>
    setScript({ say: say.map((r, j) => (j === i ? { ...r, ...patch } : r)) })

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="start-say"
        onClick={() => {
          // the first row is there to type in
          if (!open && !say.length) setScript({ say: [{ word: '', as: '' }] })
          setOpen((o) => !o)
        }}
        className="inline-flex items-center gap-0.5 self-start text-[12px] font-medium text-text-2 transition-colors hover:text-text"
      >
        <ChevronRight
          size={12}
          className={cn('transition-transform duration-150', open && 'rotate-90')}
        />
        Say it right{!open && filled ? ` · ${filled}` : ''}
      </button>
      {open ? (
        <div id="start-say" className="fade-in flex flex-col gap-2">
          <p className="text-[11px] text-text-3">
            Names and short forms Luca gets wrong. Only the voice changes, not the captions.
          </p>
          {say.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={r.word}
                onChange={(e) => change(i, { word: e.target.value })}
                placeholder="Word"
                aria-label={`Word ${i + 1}`}
                maxLength={60}
              />
              <Input
                value={r.as}
                onChange={(e) => change(i, { as: e.target.value })}
                placeholder="Sounds like"
                aria-label={`Sounds like ${i + 1}`}
                maxLength={80}
              />
              <button
                type="button"
                aria-label={`Remove word ${i + 1}`}
                onClick={() => setScript({ say: say.filter((_, j) => j !== i) })}
                className="flex size-6 shrink-0 items-center justify-center rounded-[6px] text-text-3 transition-colors hover:bg-hover hover:text-text"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            disabled={say.length >= MAX_SAY}
            onClick={() => setScript({ say: [...say, { word: '', as: '' }] })}
          >
            <Plus size={12} /> Add a word
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** What recording the script will use: a learned price when there is one, else what Luca does to learn it. */
function SpendLine(): ReactElement | null {
  const chars = useStart((s) => s.script.text.trim().length)
  const voiceId = useStart((s) => s.script.voice?.id)
  const hasKey = useAi33((s) => s.hasKey)
  const credits = useAi33((s) => s.credits)
  const [about, setAbout] = useState<number | null>(null)

  // asked once they stop typing; the last answer stays up meanwhile
  useEffect(() => {
    if (hasKey !== true || !chars) return
    let stale = false
    const t = setTimeout(() => {
      void luca.ai33
        .estimate({ kind: 'speech', chars, voiceId })
        .then((e) => {
          if (!stale) setAbout(e.credits)
        })
        .catch(() => undefined)
    }, 500)
    return () => {
      stale = true
      clearTimeout(t)
    }
  }, [hasKey, chars, voiceId])

  if (hasKey !== true) return null
  const known = chars > 0 ? about : null
  const have = credits !== null ? formatCredits(credits) : null
  // recording would stop part way: say so now, as the Music note does
  const short = known !== null && credits !== null && known > credits
  return (
    <p className={cn('text-[11.5px]', short ? 'text-text-2' : 'text-text-3')}>
      {short
        ? `About ${formatCredits(known)} credits, more than the ${have} you have. Add credits or shorten the script.`
        : known !== null
          ? `About ${formatCredits(known)} credits${have ? ` · you have ${have}` : ''}`
          : `Uses ai33 credits.${have ? ` You have ${have}.` : ''} Luca records the first part first to check the price.`}
    </p>
  )
}

/** Under the step chips while Music is on: it uses credits, and the card won't ask again. */
export function MusicNote(): ReactElement | null {
  const hasKey = useAi33((s) => s.hasKey)
  const credits = useAi33((s) => s.credits)
  const [about, setAbout] = useState<number | null>(null)

  useEffect(() => {
    if (hasKey !== true) return
    let stale = false
    void luca.ai33
      .estimate({ kind: 'music' })
      .then((e) => {
        if (!stale) setAbout(e.credits)
      })
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [hasKey])

  if (hasKey !== true) return null
  const have = credits !== null ? ` You have ${formatCredits(credits)}.` : ''
  return (
    <p className="fade-in mt-1 text-[11px] text-text-3">
      {about !== null && credits !== null && credits < about
        ? `Music needs about ${formatCredits(about)} credits and you have ${formatCredits(credits)}, so Luca will skip it.`
        : `${about !== null ? `Music uses about ${formatCredits(about)} ai33 credits.` : 'Music uses ai33 credits.'}${have}`}
    </p>
  )
}

/**
 * Record and edit: ready once ai33 is connected and there is a script to record. Why it isn't is
 * said next to it in words (a tooltip on a disabled button is out of reach of a keyboard or a
 * screen reader); when it is, ⌘↩ is hinted, since Enter is only a new line in the script.
 */
export function ScriptGoButton({ busy, onGo }: { busy: boolean; onGo: () => void }): ReactElement {
  const hasKey = useAi33((s) => s.hasKey)
  const empty = useStart((s) => !s.script.text.trim())
  const reason =
    hasKey === false ? 'Connect ai33 first' : hasKey && empty ? 'Paste your script first' : null
  const disabled = busy || hasKey !== true || empty
  return (
    <span className="ml-auto inline-flex items-center gap-2">
      {reason ? (
        <span id="start-go-reason" className="text-[11.5px] text-text-3">
          {reason}
        </span>
      ) : !disabled ? (
        <kbd aria-hidden className="font-mono text-[11px] text-text-3">
          ⌘↩
        </kbd>
      ) : null}
      <GenerateButton
        label="Record and edit"
        generatingLabel="Recording"
        generating={busy}
        disabled={disabled}
        aria-describedby={reason ? 'start-go-reason' : undefined}
        aria-keyshortcuts="Meta+Enter Control+Enter"
        onClick={onGo}
      />
    </span>
  )
}

/**
 * A question main asks before the project exists (the price of the rest of a long script), in the
 * busy card. Once there is a chat, the same question is a card in it.
 */
export function StartAsk(): ReactElement | null {
  const pending = useAi33((s) => s.pendingAsk)
  const answer = useAi33((s) => s.answerAsk)
  const id = pending?.id
  const connect = pending?.ask.kind === 'connect'

  // ⌘↩ says go ahead, as on the card in the chat; never for a key, which needs one
  useEffect(() => {
    if (!id || connect) return
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.isComposing) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      void useAi33.getState().answerAsk('allow')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [id, connect])

  if (!pending) return null
  const { ask } = pending
  return (
    <div className="fade-in card flex flex-col gap-2 p-3">
      <div role="alert" className="flex flex-col gap-0.5">
        <div className="text-[12.5px] font-semibold text-text">{ask.title}</div>
        <div className="text-[12px] leading-[1.45] text-text-2">{ask.detail}</div>
        {ask.warn ? <div className="text-[11.5px] text-text-3">{ask.warn}</div> : null}
      </div>
      {connect ? (
        <Ai33KeyCard
          context="chat"
          onDone={() => void answer('allow')}
          onDismiss={() => void answer('deny')}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="primary" onClick={() => void answer('allow')}>
            {ask.labels?.allow ?? 'Go ahead'}{' '}
            <kbd className="ml-0.5 font-mono text-[10px] opacity-70">⌘↩</kbd>
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void answer('deny')}>
            {ask.labels?.deny ?? 'Stop'}
          </Button>
          {ask.voice ? (
            <span className="ml-auto inline-flex items-center gap-1 text-[11.5px] text-text-2">
              <AudioPreview voiceId={ask.voice.id} label={`Hear ${ask.voice.name}`} />
              Hear {ask.voice.name}
            </span>
          ) : null}
        </div>
      )}
    </div>
  )
}
