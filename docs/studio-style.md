# The Studio look, taken apart

How the "five free AI repos" talking-head short was made, frame by frame, and how Luca rebuilds
it for any talking video at any size. The reference is a 57.5 s, 60 fps comparison promo: two
9:16 phones on a gradient, **BEFORE** on the left (a typical listicle edit) and **AFTER** on the
right (the edit people want). Luca's **Studio** style is the AFTER; its `serif` look is the
BEFORE.

## 1. The shell (the comparison promo itself)

| Element | What it is                                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Canvas  | 16:9, a soft mesh gradient: blue (#2F6BE0) top left, violet (#6A3BD8) top right, magenta (#B0368E) bottom left, orange (#E0703A) bottom right. Static. |
| Labels  | "BEFORE" / "AFTER" over each phone, Archivo Expanded Black, white, all caps, ~4% of the frame height.                                                  |
| Phones  | Two 9:16 panels, ~86% of the frame height, corners ~6% of their width, 1 px light rim, soft drop shadow.                                               |
| Sync    | Both edits play the same voice track in lockstep, so every difference is the edit, never the words.                                                    |

## 2. The source and the cut

- One take: a man in a black tee against a dark grey wall, framed head and shoulders, shot vertical.
- Voice only. No music bed, no sound effects. The audio is cut tight: every breath and pause over
  ~0.3 s is gone, so the voice runs as one continuous line. The only gaps (0.25–0.34 s) sit at the
  item changes: 16.3 s, 22.5 s, 29.5 s, 36.8 s, 46.0 s.
- Structure (a numbered listicle): hook (0–3.4) → promise (3.4–6.4) → items 1–5, each **name card
  → what it does → why it beats the paid tool** → caveat (46–50) → call to action (50–57.5).
- Pace: ~30 picture changes in 57 s, one every **1.9 s** on average, never more than 4 s on one
  picture. Every change lands on a word.

## 3. AFTER: the design system

### Palette

| Token         | Value                           | Use                                                                       |
| ------------- | ------------------------------- | ------------------------------------------------------------------------- |
| paper         | #E9E4D8 (warm cream)            | Default background                                                        |
| ink           | #23211E → #342E27 (warm black)  | Second background, for name cards and "serious" beats                     |
| text on paper | #121110                         | Titles, prices, pill text                                                 |
| text on ink   | #F4F1EA                         | Titles on ink                                                             |
| dim           | #8A857B (paper) / #9A968E (ink) | Small second lines ("GitHub stars", "on top of ollama")                   |
| accent        | lime #C8F23A                    | The one highlight: the cloned waveform, the "after" tag, the winning pill |
| alarm         | red #E5322F                     | The price you stop paying, the X over a paid tool                         |
| tile          | #5A5856 → #2C2B29 glass         | App icon tiles                                                            |
| pill          | #F7F5F0 with a soft shadow      | List rows and requirement pills                                           |

Both backgrounds carry the same **crumpled-paper texture**: large soft diagonal folds and fine
grain, strong on ink (overlay), faint on paper (soft light) and faintest over the face.

### Type

| Role                 | Face                                               | Example                     |
| -------------------- | -------------------------------------------------- | --------------------------- |
| Hook, line 1         | Archivo Expanded Black, caps                       | **STOP**                    |
| Hook, line 2         | Archivo Expanded Light, lowercase                  | paying                      |
| App names            | Archivo Expanded Medium, lowercase, tight tracking | ollama, open webui, upscayl |
| Statements           | Archivo Expanded Bold                              | no API key                  |
| Prices               | Archivo Expanded Black                             | $0, ~~$60~~                 |
| Stats                | Archivo Expanded Medium + small dim line           | 180k / GitHub stars         |
| Pills, tags          | Archivo Expanded Bold, small                       | a decent GPU, f5-tts        |
| Captions             | Archivo Medium, lowercase, small                   | free repos                  |
| Emphasis in captions | Instrument Serif Italic                            | _chatgpt_, _api key_        |
| Kicker               | mono caps, wide tracking, tiny                     | • COMMENT BELOW             |

Everything is lowercase except the hook's first word and acronyms (API, GPU). Titles sit around
9–10% of the frame width per glyph pair; captions are ~2% of the frame height, a whisper next to
the titles.

### Layouts (the speaker has three positions)

1. **Full**: the face fills the frame, slightly punched in (1.0–1.15×, a different size on each
   return so cuts never jump to the same framing). Captions small, on the chin line (~74% down).
2. **Inset** (the signature): the background with the graphic in the top 58%, and the speaker in a
   dark rounded card along the bottom (card top at 73% of the height, 6.5% side margins, top
   corners ~4% of the width). The person is **cut out**, so their head rises above the card's top
   edge onto the paper. Captions sit just above the card (~62%).
3. **None**: the graphic alone on paper or ink; the voice keeps going. Captions at ~74%.

In landscape the inset card moves to the right third and the graphic takes the left; square frames
stack like vertical with a shorter card.

### Motion grammar

- Background changes and the face's returns are **hard cuts on a word**. Nothing cross-fades. When the speaker's card comes and goes it moves: it **drops out** (0.15 s) when a card takes the whole frame and **rises in** from below the frame (0.35 s, expo out) when it comes back, while the outgoing graphic whips out (left as the speaker leaves, up as the card rises) in 0.16 s.
- Elements arrive, they never just appear: text **rises out of a mask** (0.5 s, expo out); icons
  **focus in** from a blur (0.45 s); pills **slide in from the right** with a motion blur, 0.12 s
  apart; tiles **pop** from 0.6× with a soft overshoot; numbers **land** with a slight scale-down.
- A held graphic keeps breathing: a slow push of ~2% over the shot.
- **Strikes** draw left to right in 0.3 s; an **X** is two red strokes, 0.12 s apart.
- **Focus-on-mention**: a row of blurred, greyed tiles where each one snaps sharp the moment its
  name is said (ChatGPT 1.5 s, Midjourney 2.0 s, ElevenLabs 2.6 s).
- One graphic can survive a background change: "ollama" moves from ink to paper at 10.2 s without
  re-entering, and its model tiles fly in around it.

### Captions

Small lowercase words, 1–3 at a time, soft fade with a slight blur, dark on paper and light on ink
or the face, always placed where the layout leaves room (above the card, or on the chin line).
The key noun of a beat switches to an italic serif.

## 4. AFTER: shot list

| Time      | Layout · bg          | On screen                                                                                            | Studio kind        |
| --------- | -------------------- | ---------------------------------------------------------------------------------------------------- | ------------------ |
| 0.0–3.4   | inset · paper        | **STOP** / paying; three blurred tiles focus in on ChatGPT (1.5), Midjourney (2.0), ElevenLabs (2.6) | `title` + `icons`  |
| 3.4–6.4   | none · paper         | Five white GitHub pills slide in one by one, names blurred (a teaser)                                | `list`             |
| 6.4–10.2  | none · ink           | **ollama** rises; llama tile pops; a hairline drops to **180k** / GitHub stars (8.4)                 | `app`              |
| 10.2–14.2 | none · paper         | Same card on paper; model tiles (gemma, deepseek, meta…) fly in around the llama                     | `app` + satellites |
| 14.2–16.3 | inset → none · paper | **no API key**; at 16.0 the speaker drops away and a line strikes it through                         | `title` (strike)   |
| 16.3–18.3 | none · ink           | **open webui** rises, OI tile, "a chat app / on top of ollama"                                       | `app`              |
| 18.3–19.9 | full                 | Face, punched in                                                                                     | —                  |
| 19.9–22.4 | inset · paper        | A dark chat window: the prompt types "Write me a business plan", the reply dots pulse                | `window` (chat)    |
| 22.4–24.3 | none · ink           | **invokeai**, its tile, "local image generation / with a full editing canvas"                        | `app`              |
| 24.3–26.3 | inset · paper        | The Midjourney tile; a red X strikes it on "every month"                                             | `icons` (cross)    |
| 26.3–27.5 | full                 | Face                                                                                                 | —                  |
| 27.5–29.4 | none · paper         | Two app screenshots; a white label steps "tools → masks → layers" while a box moves over the UI      | `window` (images)  |
| 29.8–32.0 | none · ink           | **f5-tts**, F5 tile, "voice cloning / from a short clip"                                             | `app`              |
| 32.0–33.0 | full                 | Face                                                                                                 | —                  |
| 33.0–35.0 | inset · paper        | A white waveform card, then a lime "cloned" waveform under it                                        | `wave`             |
| 35.0–36.8 | none · paper         | elevenlabs ~~$60~~ in red, struck; the f5-tts tag; **$0**                                            | `price`            |
| 37.1–40.4 | none · ink           | **upscayl**, tile, **50k** / GitHub stars                                                            | `app`              |
| 40.4–42.8 | none · paper         | A graffiti image: "before" (blurry) → "after" (sharp, lime tag)                                      | `compare`          |
| 42.8–44.4 | full                 | Face                                                                                                 | —                  |
| 44.4–46.0 | none · paper         | Topaz and Magnific tiles, both crossed in red; upscayl tag; **$0**                                   | `price` (crossed)  |
| 46.3–47.0 | full                 | Face                                                                                                 | —                  |
| 47.0–49.4 | inset · ink          | "some of these want" / **a decent GPU** / or / **an M-series Mac**                                   | `pills`            |
| 49.4–50.4 | none · ink           | **monthly bill** gets struck, **$0** lands, "after that"                                             | `number`           |
| 50.4–51.0 | full                 | Face                                                                                                 | —                  |
| 51.0–53.4 | inset · ink          | One lime pill "+1" (the bonus sixth repo)                                                            | `list` (highlight) |
| 53.4–54.4 | none · ink           | All six pills fly in, now readable: ollama, open webui, invokeai, f5-tts, upscayl + the lime one     | `list`             |
| 54.4–56.0 | inset · ink          | • COMMENT BELOW, a dark input types **LOCAL**, "and the link lands in your dms"                      | `cta`              |
| 56.0–57.5 | full                 | Face to the end                                                                                      | —                  |

## 5. BEFORE: the other look (Luca's `serif` look)

- Backgrounds: flat light grey (#F4F3F0) cards and pure black screens; no texture.
- Type: a heavy italic serif (Playfair Display Black Italic) for the hook ("Stop paying for AI"),
  the names in a red-to-salmon italic serif ("#1 / _Ollama_"), "★ 161.8k stars" small, and the
  numbers ("180,000").
- Captions: big bold italic serif caps ("STARS ON", "GITHUB, IT") on black screens; bold white
  sans on the face.
- Graphics: a rank card per item (#N, name, stars, a full-colour app icon), a terminal that types
  `ollama run qwen3`, raw screenshots on black.
- Layout: the face in a rounded card under the hook, otherwise full frame; hard cuts.

## 6. How Luca rebuilds it

The **Studio** style turns the plan into one generated composition, the way captions are built:
Luca's agent hears the words (transcribe), cuts them tight (clean edit), cuts the speaker out of
the background once (speaker cutout, for the pop-out), writes a **scene plan** (when the
background and speaker position change and which graphic each beat shows, timed to the words) and
calls `studio_apply`. Luca generates `compositions/luca-studio.html` from it at the project's size,
with the fonts and the paper texture copied into the project, and keeps it in step with the
a-roll. Captions in the Studio caption style follow the plan: dark on paper, light on ink and the
face, above the card when there is one, with the plan's emphasis words in the italic serif.

The vocabulary, one kind per beat type above: `title`, `icons`, `app`, `list`, `window`, `wave`,
`price`, `compare`, `pills`, `number`, `cta`, `image`, `quote`, `rank`, `terminal`.
