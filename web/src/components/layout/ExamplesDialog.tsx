import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../state/store';
import { Dialog } from '../common/Dialog';
import { loadExampleIndex, type ExampleMeta } from '../../services/exampleLibrary';

/**
 * The bundled OpenRocket examples, in two places because they answer two
 * different questions.
 *
 * Menu → Import → Examples is the primary one, and the semantically exact one:
 * opening an example IS an import. It goes through `openOrkFile`, it lands as
 * an unsaved copy with no library entry, and it raises the same notes banner a
 * picked `.ork` would. Anything that behaves like an import belongs beside the
 * import that reads a file.
 *
 * The library dialog shows the same list as its second tab, because that is the
 * dialog you open when you are looking for a rocket to work on — and on a first
 * run its other tab is empty, which is exactly when an example is worth most.
 * One list component, mounted twice; there is no second code path.
 */

/**
 * The list itself, minus any dialog chrome, so the library can drop it into a
 * tab and the standalone dialog can wrap it.
 *
 * The index is a fetch, so it has three states and shows all of them: a
 * deployment that never ran `sync-examples.mjs` should say so rather than
 * render an empty list that looks like a feature with nothing in it.
 */
export function ExampleList({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const openExample = useWorkspaceStore((s) => s.openExample);
  const [examples, setExamples] = useState<ExampleMeta[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    loadExampleIndex().then(
      (list) => live && setExamples(list),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  if (failed) return <p className="px-4 py-8 text-center text-sm text-slate-400">{t('library.examplesFailed')}</p>;
  if (!examples) return <p className="px-4 py-8 text-center text-sm text-slate-400">{t('common.loading')}</p>;

  return (
    <ul className="min-h-0 flex-1 divide-y divide-white/5 overflow-y-auto">
      {examples.map((e) => (
        <li key={e.id}>
          <button
            onClick={() => {
              void openExample(e.file);
              onClose();
            }}
            className="w-full px-4 py-2.5 text-left hover:bg-white/5"
          >
            <span className="text-sm text-slate-100">{e.name}</span>
            {e.description && (
              // Clamped: upstream's comment is the author's own note and runs to
              // a full build guide on one of them. The whole text rides along on
              // the design once it is opened, so nothing is lost by not showing
              // all of it in a picker.
              //
              // No `block` beside the clamp. `line-clamp-2` IS a display rule
              // (-webkit-box), so the two fight over `display` and whichever
              // Tailwind emits last wins — which was `block`, and the clamp did
              // nothing. -webkit-box is block-level anyway.
              <span className="mt-0.5 line-clamp-2 text-xs leading-snug text-slate-400">{e.description}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The standalone picker, raised by Menu → Import → Examples. */
export function ExamplesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();

  return (
    <Dialog
      id="examples"
      title={t('library.examplesTitle')}
      onClose={onClose}
      size="lg"
      toolbar={<p className="px-4 py-2 text-xs leading-snug text-slate-400">{t('library.examplesIntro')}</p>}
    >
      <ExampleList onClose={onClose} />
    </Dialog>
  );
}
