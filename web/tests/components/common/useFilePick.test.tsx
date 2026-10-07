// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../testing/renderWithProviders';
import { useFilePick } from '../../../src/components/common/useFilePick';

function Picker({ onFile }: { onFile: (f: File) => void }) {
  const file = useFilePick({ accept: '.csv', onFile, label: 'CSV file' });
  return (
    <>
      <button onClick={file.pick}>Import</button>
      {file.input}
    </>
  );
}

describe('useFilePick', () => {
  it('hands over the picked file and clears the input so the same file can be picked again', () => {
    const onFile = vi.fn();
    renderWithProviders(<Picker onFile={onFile} />);
    const input = screen.getByLabelText('CSV file') as HTMLInputElement;
    const f = new File(['a,b'], 'levels.csv');
    fireEvent.change(input, { target: { files: [f] } });
    expect(onFile).toHaveBeenCalledWith(f);
    expect(input.value).toBe('');
  });

  it('opens the chooser from the button', () => {
    renderWithProviders(<Picker onFile={() => {}} />);
    const input = screen.getByLabelText('CSV file') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(click).toHaveBeenCalled();
  });
});
