import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import './generate-button.css'

/**
 * Vengeance UI "Generate Button" (vengenceui.com/r/generate-button), adapted for Luca:
 * controlled `generating` state, custom labels/icon, compact sizing and theme tokens.
 * Used for every action that hands work to an AI model.
 */
export type GenerateButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Hue (0–360) of the highlight. 210 matches Luca's accent. */
  hue?: number
  generating?: boolean
  label: string
  generatingLabel?: string
  icon?: ReactNode
  size?: 'sm' | 'md'
}

function Letters({ text, keyPrefix }: { text: string; keyPrefix: string }): ReactNode {
  return text.split('').map((ch, i) => (
    <span key={`${keyPrefix}-${i}`} className="gen-btn-letter">
      {ch === ' ' ? '\u00a0' : ch}
    </span>
  ))
}

export const GenerateButton = forwardRef<HTMLButtonElement, GenerateButtonProps>(
  function GenerateButton(
    {
      hue = 210,
      generating = false,
      label,
      generatingLabel = `${label}…`,
      icon,
      size = 'md',
      className,
      style,
      ...props
    },
    ref
  ) {
    return (
      <button
        ref={ref}
        type="button"
        data-generating={generating ? 'true' : 'false'}
        data-size={size}
        className={cn('gen-btn no-drag', className)}
        style={{ ...style, ['--highlight-color-hue' as string]: `${hue}deg` }}
        // the letters are spans each, and both labels are in the page: say just the one shown
        aria-label={generating ? generatingLabel : label}
        {...props}
      >
        {icon ?? (
          <svg className="gen-btn-svg" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
          </svg>
        )}
        <span className="gen-txt-wrapper" aria-hidden="true">
          <span className="gen-txt-1">
            <Letters text={label} keyPrefix="a" />
          </span>
          <span className="gen-txt-2">
            <Letters text={generatingLabel} keyPrefix="b" />
          </span>
          <span className="gen-txt-measure" aria-hidden="true">
            {generatingLabel.length > label.length ? generatingLabel : label}
          </span>
        </span>
      </button>
    )
  }
)
