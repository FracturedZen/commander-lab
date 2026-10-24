import type { DragEvent, ReactNode } from 'react'

type ZonePanelProps = {
  title: string
  count?: number
  children?: ReactNode
  className?: string
  compact?: boolean
  onDragOver?: (e: DragEvent) => void
  onDrop?: (e: DragEvent) => void
  dropActive?: boolean
}

export function ZonePanel({
  title,
  count,
  children,
  className = '',
  compact = false,
  onDragOver,
  onDrop,
  dropActive = false,
}: ZonePanelProps) {
  return (
    <section
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={[
        'zone-panel flex flex-col overflow-hidden rounded-xl transition',
        compact ? 'min-h-[5.5rem]' : 'min-h-[8rem]',
        dropActive ? 'ring-2 ring-emerald-400/70' : '',
        className,
      ].join(' ')}
    >
      <header className="flex items-center justify-between border-b border-emerald-500/10 px-3 py-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-200/90">
          {title}
        </h3>
        {typeof count === 'number' && (
          <span className="rounded-full bg-black/30 px-2 py-0.5 text-[11px] tabular-nums text-slate-300">
            {count}
          </span>
        )}
      </header>
      <div className="flex flex-1 flex-wrap content-start gap-1.5 p-2">{children}</div>
    </section>
  )
}
