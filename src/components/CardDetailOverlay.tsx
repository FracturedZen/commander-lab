import type { CardRef } from '@/types/card'

type Props = {
  card: CardRef
  onClose: () => void
}

function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine
}

export function CardDetailOverlay({ card, onClose }: Props) {
  const src =
    online()
      ? card.imageLarge ?? card.imageNormal ?? card.imageSmall
      : undefined

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={card.name}
      onClick={onClose}
    >
      <div
        className="relative max-h-[92vh] w-full max-w-md overflow-auto rounded-2xl border border-sky-400/30 bg-slate-950 shadow-2xl shadow-sky-900/40"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-2 top-2 z-10 rounded-full bg-black/60 px-2.5 py-1 text-sm text-white"
          onClick={onClose}
        >
          Close
        </button>
        {src ? (
          <img
            src={src}
            alt={card.name}
            className="mx-auto max-h-[70vh] w-auto rounded-t-2xl object-contain"
            decoding="async"
          />
        ) : (
          <div className="flex aspect-[5/7] items-center justify-center bg-slate-900 p-6 text-center text-lg text-slate-200">
            {card.name}
            <span className="mt-2 block text-xs text-slate-500">
              Art unavailable offline — sync once while online.
            </span>
          </div>
        )}
        <div className="space-y-1 border-t border-slate-800 p-3 text-xs text-slate-300">
          <p className="text-sm font-semibold text-white">{card.name}</p>
          {card.manaCost && (
            <p className="text-amber-200/90">{card.manaCost}</p>
          )}
          {card.typeLine && <p className="text-slate-400">{card.typeLine}</p>}
          {card.oracleText && (
            <p className="whitespace-pre-wrap leading-relaxed text-slate-300">
              {card.oracleText}
            </p>
          )}
          {(card.power || card.toughness) && (
            <p className="tabular-nums text-slate-200">
              {card.power}/{card.toughness}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
