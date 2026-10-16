// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WeatherKeyField } from '../../../src/components/sim/WeatherKeyField';
import { readWeatherKey } from '../../../src/services/weather/weatherKey';
import i18n from '../../../src/i18n';

afterEach(cleanup);

describe('the weather key field', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  /** Settings closing with Escape removes the field with no blur. */
  it('saves the key when the field goes away before it loses focus', () => {
    const { unmount } = render(<WeatherKeyField />);
    fireEvent.change(screen.getByLabelText(i18n.t('weather.keyLabel')), { target: { value: 'test-key' } });
    unmount();
    expect(readWeatherKey()).toBe('test-key');
  });
});
