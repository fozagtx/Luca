import { AudioLines, FolderOpen } from 'lucide-react'
import type { ReactElement } from 'react'
import { Tip } from '../../../components/ui/tooltip'
import { luca } from '../../../lib/luca'
import { useChat } from '../../../stores/chat'
import { useProject } from '../../../stores/project'
import { useUi } from '../../../stores/ui'
import { EmptyPane } from '../EmptyPane'
import { useProjectMedia } from './use-project-media'
import { PaneHead } from '../Sidebar'

const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i
const AUDIO = /\.(mp3|wav|m4a|aac|flac|ogg)$/i

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** Mention a file in the message box, so you can ask Luca to use it. */
function mention(path: string): void {
  const chat = useChat.getState()
  const at = `@${nameOf(path)}`
  chat.setDraft(chat.draft.trim() ? `${chat.draft.trimEnd()} ${at} ` : `${at} `)
  const ui = useUi.getState()
  if (!ui.chatOpen) ui.setChat(true)
  requestAnimationFrame(() => {
    const el = document.getElementById('chat-composer') as HTMLTextAreaElement | null
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  })
}

export function MediaTab(): ReactElement {
  const project = useProject((s) => s.project)
  const media = useProjectMedia()
  return (
    <div className="flex h-full flex-col">
      <PaneHead title="Media">
        {project ? (
          <Tip label="Show in Finder">
            <button
              type="button"
              aria-label="Show in Finder"
              onClick={() => void luca.project.revealInFinder('media')}
              className="icon-btn"
            >
              <FolderOpen size={14} strokeWidth={1.6} />
            </button>
          </Tip>
        ) : null}
      </PaneHead>
      {!project ? (
        <EmptyPane title="No project open" hint="Open a project to see its footage and images." />
      ) : media && media.length === 0 ? (
        <EmptyPane
          title="No media yet"
          hint="Drop a video, photos or audio on the chat and Luca adds them to the project."
        />
      ) : (
        <div className="scroll min-h-0 flex-1 p-3">
          <p className="px-0.5 pb-2.5 text-[12px] leading-[1.5] text-text-2">
            Click a file to mention it to Luca.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(media ?? []).map((path) => (
              <MediaTile key={path} path={path} projectId={project.id} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MediaTile({ path, projectId }: { path: string; projectId: string }): ReactElement {
  const src = `/p/${encodeURIComponent(projectId)}/${path.split('/').map(encodeURIComponent).join('/')}`
  const name = nameOf(path)
  return (
    <button
      type="button"
      title={`Mention ${name} to Luca`}
      onClick={() => mention(path)}
      className="card card-hover group relative aspect-video overflow-hidden text-left"
    >
      {VIDEO.test(path) ? (
        <video
          src={`${src}#t=0.5`}
          muted
          preload="metadata"
          className="absolute inset-0 size-full object-cover"
        />
      ) : AUDIO.test(path) ? (
        <div className="absolute inset-0 flex items-center justify-center bg-bg-muted text-clip-audio-ink">
          <AudioLines size={20} strokeWidth={1.6} />
        </div>
      ) : (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      <span className="absolute bottom-1.5 left-1.5 max-w-[calc(100%-12px)] truncate rounded-[4px] bg-black/70 px-1.5 py-[2px] font-mono text-[10px] text-white">
        {name}
      </span>
    </button>
  )
}
