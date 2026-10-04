/**
 * The Studio style guide Luca follows on Studio projects: written to .luca/STUDIO.md when a
 * project starts and into its edit guide. It teaches the plan, not the drawing: Luca builds the
 * picture from the plan (src/main/studio/), so the guide is about beats, timing and taste.
 */
export const STUDIO_GUIDE = `# Studio style

This video is a talking-head edit in the Studio look: cream and warm-black crumpled-paper backgrounds, a wide grotesk, glass app tiles, white pills, one lime accent and red for the price you stop paying, tiny lowercase captions. The speaker is full frame, in a dark card along the bottom (their head rising out of it once the cut-out is made) or gone while a card fills the frame. The picture changes every 1.5–3 s, always on a word.

You never draw it by hand. The whole picture is one scene plan you pass to studio_apply; Luca builds it at this video's size (side by side in landscape), keeps it in step with the footage and moves the captions to fit. Never write or edit compositions/luca-studio.html.

## Order of work
1. transcribe, then clean_edit: the cut is tight (Luca takes out ums and pauses; you name the retakes and false starts).
2. speaker_cutout right after the clean edit when the pop-out frame is on (a few minutes; say so in one line).
3. Read the words and plan the beats (below). For every app, product or brand a beat shows, get its logo with logo_add (letters on the tile when none is found).
4. studio_apply with the whole plan, then fix everything it lists under "fix".
5. captions_apply with style "studio" ("serif-caps" in the serif look). Luca places and colors them.
6. snapshot 3–4 beats (the hook, a card, a price, the call to action) and fix cut-off text, crowding or a wrong logo.

## Beats
- One beat is one idea, 1.5–3 s, starting and ending on word boundaries from the word times. Never hold one picture longer than 4 s. Between beats the face fills the frame (no beat needed): give the personal and emotional lines to the face, 1–2 s at a time.
- Cover about 70–90% of the video with beats.
- Hook, the first 2–3.5 s: a title of two lines (one black caps word over one light lowercase word, e.g. "STOP" / "paying") stacked over icons of the things named, each icon's at on the word that names it, so it snaps into focus as it is said. Speaker inset, paper.
- The promise ("these five free tools"): a list with blur: true, a teaser of what is coming. Paper, speaker none.
- Each point: (1) an app card on ink when its name is said: the name rises, its tile, and a stat (stars, users, a price) or two short lines of what it is; (2) what it does on paper: window (screenshots, or a chat drawn for you), wave (anything audio), compare (before and after), image (B-roll or the user's pictures); speaker inset when they talk about it, none otherwise; (3) why it beats the paid one: price (the paid tool's price struck through, then the new one) or icons with a cross on the paid tools; (4) the face for the reaction.
- Caveats: pills ("some of these want" / "a decent GPU" / or / "an M-series Mac"), speaker inset on ink.
- A number that matters: number ("monthly bill" struck, "$0").
- Recap: a list of everything, readable now, the bonus one highlighted ("+1").
- Call to action: cta (the keyword they should comment typed into the box), speaker inset on ink. End on the face.
- Ink for names and serious beats, paper for explanations; a background switch is a hard cut on the beat. A card can stay while the background flips: changes [{ at, bg }] inside one beat. Speaker changes mid-beat work the same way.
- Every moment's at goes on the word that names it: the brand for its icon, the number for its stat, "every month" for a cross, "free" for the new price, the keyword for the typing.
- emphasis: 4–10 key words (brands, the hook word, the keyword) the captions show in an italic serif.
- face: the cut-out tells Luca where the face is; without one, when the speaker isn't centered at about a third from the top, set face { x, y } (0–1, where the face is in the footage) from a snapshot.
- Short words on screen: names lowercase as the brand writes them, titles of 1–3 words a line, stats of up to 6 characters, list rows of up to 16.

## The kinds
- title: lines [{ text, weight black|bold|medium|light, serif, color accent|alarm|dim }], strikeAt.
- icons: items [{ logo or mono, label, at }], focus (default on), cross [{ index, at }], light.
- app: name, mark { logo or mono, tint }, stat { value, label, at } or lines [2] with linesAt, satellites [{ logo or mono, label, at }] that fly in around the tile.
- list: items [{ text, at }], mark github|check|number|dot|none, blur, highlight { index, badge, at }.
- window: images [{ image, at }] with labels [{ text, at }] and boxes [{ x, y, w, h, at }] over the first image, or chat { title, greeting, prompt, typeAt, reply, replyAt }.
- wave: cards [{ label, accent, at }] (accent is the result: the cloned voice, the cleaned audio).
- price: label and from (the paid tool and its price) or crossed (paid tools as tiles, each crossed at its own at), strikeAt, tag (the free one), to, toAt.
- compare: image, before, after, afterAt (it turns sharp and the tag flips to the accent).
- pills: intro, items [{ text, at }], joiner.
- number: label, strikeAt, value, valueAt, sub.
- cta: kicker (default COMMENT BELOW), word, typeAt, sub.
- image: image, caption. quote: text, by.
- rank: rank, name, stat, mark, value, valueAt; terminal: command, typeAt, output, outputAt (both made for the serif look).
- A beat's graphic can be a list of up to 3 kinds stacked top to bottom (the hook's title over its icons).

## Looks
- paper (default): the look above.
- serif: the classic listicle: flat light cards and black screens, a heavy italic serif with red names, rank cards and a terminal, big serif caption caps ("serif-caps"). Use it when the user asks for that, or a reference looks like it.

The accent (default lime #C8F23A) can change to the user's brand color; keep red for prices you stop paying.`
