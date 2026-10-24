import { useRef, type PointerEvent } from 'react'
import type { CardRef } from '@/types/card'

export type CardChipSize = 'tiny' | 'hand' | 'board' | 'command'

type CardChipProps = {
  card: CardRef
  faceDown?: boolean
  draggable?: boolean
  selected?: boolean
  /** Arena-style soft cyan glow when a legal action is available now. */
  highlighted?: boolean
  tapped?: boolean
  size?: CardChipSize
  onClick?: () => void
  onDragStart?: () => void
  /** Long-press / info → full card preview. */
  onInspect?: () => void
  quantity?: number
  showImage?: boolean
}

const SIZE_CLASS: Record<CardChipSize, string> = {
  tiny: 'h-[3.25rem] w-[2.35rem]',
  hand: 'h-[7.25rem] w-[5.2rem] sm:h-32 sm:w-[5.75rem]',
  board: 'h-[5.75rem] w-[4.1rem] sm:h-[6.5rem] sm:w-[4.65rem]',
  command: 'h-[6.25rem] w-[4.5rem] sm:h-28 sm:w-20',
}

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine
}

function artUrl(card: CardRef, preferSmall: boolean): string | undefined {
  if (preferSmall) return card.imageSmall ?? card.imageNormal ?? card.imageLarge
  return card.imageNormal ?? card.imageLarge ?? card.imageSmall
}

export function CardChip({
  card,
  faceDown = false,
  draggable = false,
  selected = false,
  highlighted = false,
  tapped = false,
  size = 'board',
  onClick,
  onDragStart,
  onInspect,
  quantity,
  showImage = true,
}: CardChipProps) {
  const q = quantity ?? card.quantity
  const holdTimer = useRef<number | null>(null)
  const preferSmall = size === 'tiny' || size === 'hand'
  const src =
    showImage && !faceDown && online() ? artUrl(card, preferSmall) : undefined

  function clearHold() {
    if (holdTimer.current != null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }

  function onPointerDown(_e: PointerEvent) {
    if (!onInspect) return
    clearHold()
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null
      onInspect()
    }, 420)
  }

  return (
    <button
      type="button"
      draggable={draggable}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={clearHold}
      onPointerLeave={clearHold}
      onPointerCancel={clearHold}
      onContextMenu={(e) => {
        if (!onInspect) return
        e.preventDefault()
        onInspect()
      }}
      onDragStart={(e) => {
        clearHold()
        if (!draggable) return
        e.dataTransfer.setData('text/plain', card.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart?.()
      }}
      className={[
        'card-chip relative flex flex-col justify-end overflow-hidden rounded-md border bg-gradient-to-b from-slate-800 to-slate-950 text-left shadow-md shadow-black/50 transition-[transform,box-shadow] duration-200',
        SIZE_CLASS[size],
        selected
          ? 'border-emerald-400 ring-2 ring-emerald-400/55'
          : 'border-slate-500/70',
        highlighted ? 'card-chip--activatable' : '',
        highlighted && selected ? 'card-chip--activatable-strong' : '',
        highlighted ? 'card-chip--legal-cursor' : '',
        tapped ? 'origin-center rotate-90 opacity-90' : '',
        onClick || draggable ? 'cursor-pointer' : '',
      ].join(' ')}
      title={
        faceDown
          ? 'Facedown card'
          : `${card.name}${tapped ? ' (tapped)' : ''}${
              highlighted ? ' — action available' : ''
            }`
      }
      aria-label={
        highlighted
          ? `${card.name}, action available`
          : faceDown
            ? 'Facedown card'
            : card.name
      }
    >
      {faceDown ? (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-emerald-950 to-slate-950 text-[9px] font-bold tracking-widest text-emerald-400/70">
          MTG
        </div>
      ) : src ? (
        <>
          <img
            src={src}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.display = 'none'
            }}
          />
          <span className="relative z-10 line-clamp-2 w-full bg-gradient-to-t from-black/85 via-black/45 to-transparent px-0.5 pb-0.5 pt-3 text-[7px] leading-tight text-white sm:text-[8px]">
            {card.name}
          </span>
        </>
      ) : (
        <>
          <span className="line-clamp-4 px-0.5 pt-1 text-[8px] leading-tight text-slate-100">
            {card.name}
          </span>
          {card.manaCost && (
            <span className="px-0.5 pb-0.5 text-[7px] text-amber-200/80">
              {card.manaCost}
            </span>
          )}
        </>
      )}
      {q != null && q > 1 && (
        <span className="absolute -right-1 -top-1 z-20 rounded-full bg-emerald-600 px-1 text-[9px] font-bold text-white">
          ×{q}
        </span>
      )}
      {onInspect && !faceDown && (
        <span
          role="presentation"
          className="absolute bottom-0.5 right-0.5 z-20 flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-[9px] font-bold text-sky-100/90"
          onPointerDown={(e) => {
            e.stopPropagation()
            clearHold()
            onInspect()
          }}
          title="Card details (or long-press)"
        >
          i
        </span>
      )}
    </button>
  )
}
