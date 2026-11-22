import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageNotices } from './PageNotices.js';

describe('PageNotices', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<PageNotices />);
    expect(container.textContent).toBe('');
  });

  it('one short line per page problem, the full registry error behind Details', () => {
    render(<PageNotices errorText="The folder C:\sessions cannot be read: EACCES. Set AGENT_MANAGER_SESSIONS_DIR." />);
    expect(screen.getByText('Sessions cannot be listed')).toBeInTheDocument();
    expect(screen.queryByText(/EACCES/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText(/EACCES/)).toBeInTheDocument();
  });

  it('two problems are one line', () => {
    render(<PageNotices errorText="boom" unreadableText="2 registry files could not be read, the sessions in them are not shown: a (b)" />);
    expect(screen.getByText('2 notices')).toBeInTheDocument();
  });
});
