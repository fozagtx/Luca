import type { Clip, Project } from './types'

/**
 * What a clip's sound is, for the Sound tab and the agent's sound_mix tool. Classified by its
 * media path: B-roll lives in media/broll/, music is any other audio under media/, and the
 * file the project started from is the footage's own sound (or the voiceover, when the project
 * is a voiceover).
 */
export type SoundKey = 'footage' | 'voiceover' | 'music' | 'broll' | 'other'

const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v)$/i
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i
// the clean-edit master stands in for the source once the cut is applied
const CLEAN_FILE = /^media\/clean-[0-9a-f]+\.mp4$/

const NAMES: Record<SoundKey, string> = {
  footage: 'Footage sound',
  voiceover: 'Voiceover',
  music: 'Music',
  broll: 'B-roll',
  other: 'Sound'
}

/** A clip's sound group and the name people know it by. */
export function soundOf(clip: Clip, project: Project | null): { key: SoundKey; name: string } {
  const src = clip.src ?? ''
  const base = src.slice(src.lastIndexOf('/') + 1)
  if (/^media\/broll\//.test(src)) return { key: 'broll', name: NAMES.broll }
  if ((project?.source && base === project.source) || CLEAN_FILE.test(src)) {
    return VIDEO_EXT.test(project?.source ?? '')
      ? { key: 'footage', name: NAMES.footage }
      : { key: 'voiceover', name: NAMES.voiceover }
  }
  if (/^media\/music\//.test(src) || (src.startsWith('media/') && AUDIO_EXT.test(src))) {
    return { key: 'music', name: NAMES.music }
  }
  return { key: 'other', name: clip.label || NAMES.other }
}

/** Every sound on the timeline: audio clips, and unmuted video clips that carry a level. */
export function soundClips(timeline: { tracks: { clips: Clip[] }[] }): Clip[] {
  return timeline.tracks
    .flatMap((t) => t.clips)
    .filter((c) => c.kind === 'audio' || (c.kind === 'video' && c.volume !== undefined && !c.muted))
}
