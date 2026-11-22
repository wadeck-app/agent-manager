import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ownedRow, row } from '../logic/fixtures.js';
import { DaemonStateProvider } from './DaemonState.js';
import { MoveStatusLine } from './MoveStatus.js';

describe('the Move line of an agent that has no Move button', () => {
  it('a discovered session shows its readiness and why it cannot move', () => {
    render(<MoveStatusLine session={row({ adoptReadiness: { state: 'busy', reasons: ['A turn is running', 'Tool Bash is running'] } })} />);
    expect(screen.getByText('Busy: 2 running')).toBeInTheDocument();
    expect(screen.getByText('Not launched by agent-manager: moving needs adoption (not built yet)')).toBeInTheDocument();
  });

  it('a free discovered session says Free to move (the readiness does not come from the daemon)', () => {
    render(
      <DaemonStateProvider down>
        <MoveStatusLine session={row({ adoptReadiness: { state: 'free', reasons: [] } })} />
      </DaemonStateProvider>,
    );
    expect(screen.getByText('Free to move')).toBeInTheDocument();
  });

  it('a session that has the Move button leaves its badge to the button (nothing here)', () => {
    const { container } = render(<MoveStatusLine session={ownedRow()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('an ended session says nothing', () => {
    const { container } = render(<MoveStatusLine session={row({ alive: false })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
