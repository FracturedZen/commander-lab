import type { CardRef } from '@/types/card'

type CardChipProps = {
  card: CardRef
  faceDown?: boolean
  draggable?: boolean
  selected?: boolean
  tapped?: boolean
  onClick?: () => void
  onDragStart?: () => void
  quantity?: number
  showImage?: boolean
}

export function CardChip({
  card,
  faceDown = false,
  draggable = false,
  selected = false,
  tapped = false,
  onClick,
  onDragStart,
  quantity,
  showImage = false,
}: CardChipProps) {
  const q = quantity ?? card.quantity
  return (
    <button
      type="button"
      draggable={draggable}
      onClick={onClick}
      onDragStart={(e) => {
        if (!draggable) return
        e.dataTransfer.setData('text/plain', card.id)
        e.dataTransfer.effectAllowed = 'move'
        onDragStart?.()
      }}
      className={[
        'card-chip relative flex h-14 w-10 flex-col justify-between overflow-hidden rounded border bg-gradient-to-b from-slate-800 to-slate-900 p-1 text-left shadow-md shadow-black/40 transition-transform',
        selected
          ? 'border-emerald-400 ring-2 ring-emerald-400/50'
          : 'border-slate-600/80',
        tapped ? 'origin-center rotate-90 opacity-90' : '',
        onClick || draggable ? 'cursor-pointer' : '',
      ].join(' ')}
      title={faceDown ? 'Facedown card' : `${card.name}${tapped ? ' (tapped)' : ''}`}
    >
      {faceDown ? (
        <div className="flex h-full items-center justify-center rounded bg-emerald-950/80 text-[9px] font-bold text-emerald-400/70">
          MTG
        </div>
      ) : showImage &&
        card.imageSmall &&
        typeof navigator !== 'undefined' &&
        navigator.onLine ? (
        <>
          <img
            src={card.imageSmall}
            alt={card.name}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            draggable={false}
          />
          <span className="relative z-10 line-clamp-2 rounded bg-black/55 px-0.5 text-[7px] leading-tight text-white">
            {card.name}
          </span>
        </>
      ) : (
        <>
          <span className="line-clamp-3 text-[8px] leading-tight text-slate-100">
            {card.name}
          </span>
          {card.manaCost && (
            <span className="text-[7px] text-amber-200/80">{card.manaCost}</span>
          )}
        </>
      )}
      {q != null && q > 1 && (
        <span className="absolute -right-1 -top-1 z-20 rounded-full bg-emerald-600 px-1 text-[9px] font-bold text-white">
          ×{q}
        </span>
      )}
    </button>
  )
}
