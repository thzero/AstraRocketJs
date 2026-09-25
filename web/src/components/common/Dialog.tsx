import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from './useFocusTrap';
import { layerClass, readExpanded, sizeClasses, writeExpanded, type DialogLayer, type DialogSize } from './dialogSize';

/**
 * The one modal shell.
 *
 * Every dialog in the app is one of these. Each used to hand-roll the same five
 * things: the overlay, the panel,
 * `useFocusTrap`, a `stopPropagation` to keep a click inside from closing it, and
 * a `✕`. Each copy drifted. Two of them skipped `.dialog-panel` entirely and so
 * missed the full-bleed treatment every other dialog gets on a phone (see
 * index.css), nine declared no maximum height and ran off the bottom of a short
 * window, and the accessible name was sometimes an `aria-label` duplicating the
 * visible heading instead of pointing at it.
 *
 * Three body layouts, because there are genuinely three kinds:
 *
 *   - `scroll` (the default) is a header, a body that scrolls, and an optional
 *     footer pinned under it, each separated by a rule. Every list, table and
 *     tabbed dialog is this.
 *   - `pad` is one padded block for prose and short forms, where a rule under the
 *     heading would be heavier than the content.
 *   - `fill` gives the body the whole remaining height and lets IT decide what to
 *     do with it, for a map, a chart, or two panes that scroll separately. The
 *     panel takes a definite height in that case, because a `flex-1` child of an
 *     auto-height parent collapses to nothing. Padding is the body's business
 *     here, not the shell's: a pane layout wants to reach the panel's edges.
 */
export function Dialog({
  id,
  title,
  name,
  eyebrow,
  onClose,
  size = 'lg',
  height,
  layer = 'base',
  layout = 'scroll',
  expandable = true,
  dismissible = true,
  fullBleed = true,
  leading,
  actions,
  toolbar,
  footer,
  children,
}: {
  /**
   * A stable id, used to remember an expanded dialog. Required, because an
   * unnamed dialog could not persist the choice and would silently collapse
   * again on every open.
   */
  id: string;
  title: string;
  /**
   * An accessible name of its own, for the rare dialog whose visible heading is
   * CONTENT rather than a label: Help shows the title of the page you are
   * reading, which changes as you navigate WITHIN the open dialog, and a dialog
   * that renames itself under the user is worse than one named for its frame.
   * Everything else names itself by its heading, which is the rule this is an
   * exception to -- not an invitation to write an `aria-label` that repeats the
   * heading, which is the drift the shell was built to end.
   */
  name?: string;
  /** A small line above the title, for a qualifier the title alone loses: the
   *  manufacturer over a motor designation. Not part of the accessible name,
   *  which stays the title. */
  eyebrow?: string;
  onClose: () => void;
  size?: DialogSize;
  /**
   * A height in pixels, for a dialog whose height must NOT follow its content:
   * a tabbed panel that would otherwise resize every time you switch tabs, or a
   * two-pane browser whose list needs room to be a list. Still capped by the
   * panel's max-height on a short window, and still overridden by the full-bleed
   * phone treatment. Omit it and the dialog hugs its content (or takes the
   * viewport, under `fill`).
   */
  height?: number;
  layer?: DialogLayer;
  layout?: 'scroll' | 'pad' | 'fill';
  /** False for a dialog there is no point widening (a short confirmation). */
  expandable?: boolean;
  /**
   * False while the dialog must not be dismissed by a stray click or keypress,
   * which is any moment it is doing work that closing would throw away (writing
   * a PDF). The ✕ still closes: this suppresses the two ACCIDENTAL exits, not
   * the deliberate one, and a control that stops working mid-export would be
   * the worse answer.
   */
  dismissible?: boolean;
  /**
   * False for a dialog that should stay a centered card on a phone rather than
   * filling it: the report's print settings opens on top of an already
   * full-screen dialog, and blowing it up to full bleed reads as that dialog
   * being REPLACED rather than something opening over it.
   */
  fullBleed?: boolean;
  /**
   * Controls BEFORE the title, for a dialog you navigate within rather than
   * just read: a contents toggle and a back arrow. They lead the header because
   * that is where going back belongs, and because they act on the title beside
   * them rather than on the dialog as a whole.
   */
  leading?: ReactNode;
  /** Extra controls in the header, to the left of expand and close. */
  actions?: ReactNode;
  /**
   * A band under the header that does NOT scroll with the body: the filter bar
   * of a list dialog. Put inside the scrolling body it slides away as soon as
   * you scroll the rows it is filtering. `scroll` layout only.
   */
  toolbar?: ReactNode;
  /** Pinned below the body. Ignored by the `pad` layout, which puts its own
   *  buttons in the flow. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  // The trap goes on the PANEL, not the overlay: anchored on the overlay it
  // treated the whole viewport as the dialog, and role/aria-modal sat on an
  // element with no accessible name.
  // Escape reaches only the topmost open surface, so a nested dialog closing on
  // Escape no longer takes the one it opened from with it (useFocusTrap).
  const panelRef = useFocusTrap<HTMLDivElement>(true, { onEscape: dismissible ? onClose : undefined });
  const headingId = useId();
  const [expanded, setExpanded] = useState(() => readExpanded(id));
  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    writeExpanded(id, next);
  };

  return (
    <div
      className={`dialog-overlay fixed inset-0 ${layerClass[layer]} flex items-center justify-center bg-black/60 p-4`}
      // The stop is not optional: a nested dialog renders INSIDE its parent's
      // overlay, so a bare onClose here bubbled up and dismissed both at once.
      // One dialog had noticed and written the guard itself; the rest had not.
      onClick={(e) => {
        e.stopPropagation();
        if (dismissible) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={name === undefined ? headingId : undefined}
        aria-label={name}
        className={`${fullBleed ? 'dialog-panel' : ''} flex w-full flex-col overflow-hidden rounded-xl bg-slate-900 ring-1 ring-white/10 ${sizeClasses(size, expanded, layout === 'fill' && height === undefined)} ${height === undefined ? '' : 'h-[var(--dialog-height)]'}`}
        // The pixel height arrives as a CUSTOM PROPERTY read by a class, not as
        // an inline `height`. Inline styles beat a stylesheet, so an inline
        // height silently defeated the full-bleed phone rule in index.css and a
        // 560px Settings panel floated in the middle of an 844px phone. As a
        // class it loses to that rule, exactly as `fill`'s own height does.
        style={height === undefined ? undefined : ({ '--dialog-height': `${height}px` } as CSSProperties)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/10 p-3">
          {/*
            The title scale follows the CONTENT's density rather than the dialog:
            a dense list wants a quiet heading, a page of prose wants a real one.
            Three scales were in use before and which one you got depended on
            which dialog you opened, which is drift; two, chosen by layout, is a
            rule.
          */}
          {leading}
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <div className="truncate text-[11px] font-semibold uppercase tracking-wider text-amber-400/90">
                {eyebrow}
              </div>
            )}
            <h2
              id={headingId}
              className={`truncate font-semibold text-slate-200 ${layout === 'scroll' ? 'text-sm' : 'text-base'}`}
            >
              {title}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            {expandable && (
              // Hidden below `lg`, where `.dialog-panel` is already full-bleed
              // and there is nothing left to expand into.
              <button
                onClick={toggleExpanded}
                aria-pressed={expanded}
                aria-label={t(expanded ? 'dialog.shrink' : 'dialog.expand')}
                title={t(expanded ? 'dialog.shrink' : 'dialog.expand')}
                className="hidden rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 lg:block"
              >
                {expanded ? '⤡' : '⤢'}
              </button>
            )}
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
            >
              ✕
            </button>
          </div>
        </div>

        {layout === 'scroll' && (
          <>
            {toolbar && <div className="border-b border-white/10">{toolbar}</div>}
            <div className="min-h-0 flex-1 overflow-auto">{children}</div>
          </>
        )}
        {layout === 'pad' && <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>}
        {layout === 'fill' && <div className="flex min-h-0 flex-1 flex-col">{children}</div>}
        {layout !== 'pad' && footer && <div className="border-t border-white/10">{footer}</div>}
      </div>
    </div>
  );
}
