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
  onFiles,
  label,
}: {
  accept: string;
  /** One file. */
  onFile?: (file: File) => void;
  /** Several at once: the picker then lets the user choose more than one. */
  onFiles?: (files: File[]) => void;
  /** The input's accessible name, for a picker a test or a screen reader reaches directly. */
  label?: string;
}): { pick: () => void; input: ReactElement } {
  const ref = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      multiple={!!onFiles}
      aria-label={label}
      className="hidden"
      onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = '';
        if (onFiles) {
          if (files.length) onFiles(files);
        } else if (files[0]) onFile?.(files[0]);
      }}
    />
  );
  return { pick: () => ref.current?.click(), input };
}
