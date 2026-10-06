import { useRef, type ReactElement } from 'react';

/**
 * A file picker behind any button: render `input` once (it is hidden) and call
 * `pick()` from the button. The input is cleared after every pick, so choosing
 * the same file again still fires, which is how anyone retrying an import after
 * fixing the file expects it to behave.
 */
export function useFilePick({
  accept,
  onFile,
  label,
}: {
  accept: string;
  onFile: (file: File) => void;
  /** The input's accessible name, for a picker a test or a screen reader reaches directly. */
  label?: string;
}): { pick: () => void; input: ReactElement } {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      aria-label={label}
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) onFile(file);
      }}
    />
  );
  return { pick: () => ref.current?.click(), input };
}
