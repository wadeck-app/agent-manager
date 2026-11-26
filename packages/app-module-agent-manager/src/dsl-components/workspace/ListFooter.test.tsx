import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ListFooter } from './ListFooter.js';

const show = (extra: Partial<Parameters<typeof ListFooter>[0]> = {}) => render(<ListFooter onNewSession={vi.fn()} onNewGroup={async () => true} {...extra} />);

describe('the footer of the list pane', () => {
  it('holds New session and New group, both quiet (no solid primary fill)', () => {
    show();
    const footer = document.querySelector('[data-list-footer]') as HTMLElement;
    for (const name of ['New session', 'New group']) {
      const button = screen.getByRole('button', { name });
      expect(footer.contains(button)).toBe(true);
      expect(button.className, name).not.toContain('color-primary-solid');
      expect(button.className, name).not.toMatch(/\bbg-danger\b/);
    }
  });

  it('has no New group button without a way to create a group (Groups and Inbox modes)', () => {
    show({ onNewGroup: undefined });
    expect(screen.queryByRole('button', { name: 'New group' })).toBeNull();
    expect(screen.getByRole('button', { name: 'New session' })).toBeInTheDocument();
  });

  it('New session calls its handler', async () => {
    const onNewSession = vi.fn();
    show({ onNewSession });
    await userEvent.click(screen.getByRole('button', { name: 'New session' }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });

  it('the name form is an overlay anchored above the bar (absolute, out of the flow), not an inline form', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'New group' }));
    const field = screen.getByLabelText('Name of the new group');
    expect(document.activeElement).toBe(field);
    const panel = field.closest('[role="dialog"]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('aria-label')).toBe('New group');
    expect(panel.className).toMatch(/\babsolute\b/);
    expect(panel.className).toMatch(/\bbottom-full\b/);
  });

  it('Enter creates the group and closes the overlay, the focus goes back to New group', async () => {
    const onNewGroup = vi.fn(async () => true);
    show({ onNewGroup });
    await userEvent.click(screen.getByRole('button', { name: 'New group' }));
    await userEvent.type(screen.getByLabelText('Name of the new group'), 'Reviews{Enter}');
    await waitFor(() => expect(screen.queryByLabelText('Name of the new group')).toBeNull());
    expect(onNewGroup).toHaveBeenCalledWith('Reviews');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New group' }));
  });

  it('Escape closes it and puts the focus back', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'New group' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByLabelText('Name of the new group')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'New group' }));
  });

  it('a click outside closes it', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'New group' }));
    await userEvent.click(document.body);
    expect(screen.queryByLabelText('Name of the new group')).toBeNull();
  });

  it('a bad name is said in the overlay and the field stays', async () => {
    const onNewGroup = vi.fn(async () => true);
    show({ onNewGroup });
    await userEvent.click(screen.getByRole('button', { name: 'New group' }));
    await userEvent.type(screen.getByLabelText('Name of the new group'), '{Enter}');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(onNewGroup).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name of the new group')).toBeInTheDocument();
  });
});
