import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ModeId } from '../shared.js';
import { DEFAULT_VIEW_OPTIONS } from '../logic/viewOptions.js';
import { ViewOptionsControl } from './ViewOptionsControl.js';

function open(mode: ModeId, onChange = vi.fn()) {
  render(<ViewOptionsControl mode={mode} options={DEFAULT_VIEW_OPTIONS} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'View options' }));
  return onChange;
}

describe('the "Show sub-agents under each agent" view option', () => {
  it.each(['tree', 'custom'] as const)('is offered in %s mode, off by default, and turning it on reports the new options', (mode) => {
    const onChange = open(mode);
    const toggle = screen.getByRole('switch', { name: 'Show sub-agents under each agent' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_VIEW_OPTIONS, subagents: { show: true } });
  });

  it.each(['groups', 'inbox'] as const)('is not offered in %s mode (those rows have no children)', (mode) => {
    open(mode);
    expect(screen.queryByRole('switch', { name: 'Show sub-agents under each agent' })).toBeNull();
  });
});
