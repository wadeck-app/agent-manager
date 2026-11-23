import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
// violations-suppress: ts/no-deep-relative test fixtures of the logic folder
import { overview } from '../../logic/permissionsFixtures.js';
import { permissionsOf, row } from '../deps.js';
import type { CliGrantDto, SessionGrantsDto } from '../deps.js';
import { PermissionsPanel } from './PermissionsPanel.js';

const SID = '00000000-0000-4000-8000-000000000001';
const session = row({ sessionId: SID, cwd: '/w/shop' });
const grant: CliGrantDto = { id: 'a1b2c3d4', category: 'rm', mode: 'once', sessionId: SID, expiresAt: Date.now() + 600_000, remainingMs: 600_000, remainingText: '10 min', usesLeft: 1, reason: 'clean the build folder', origin: null };
const data: SessionGrantsDto = { ok: true, code: '', sessionId: SID, cwd: '/w/shop', cwdNote: '', grants: [grant], errorText: '', };

// jsdom has no layout: the structure is what can be pinned. The text must not share a flex row with the button (the rail is about 250 px wide).
describe('the layout of a bypass in a narrow rail', () => {
  it('the text takes the full width and the Revoke button sits in its own row below it', () => {
    const files = overview([]);
    render(<PermissionsPanel session={session} feed={{ overview: files, view: permissionsOf(files, SID, session.cwd), error: '', loading: false, reload: vi.fn(), cli: { kind: 'ok', data } }} />);
    const item = screen.getByRole('region', { name: 'This session' }).querySelector('[data-cli-grant="a1b2c3d4"]') as HTMLElement;
    const revoke = within(item).getByRole('button', { name: 'Revoke the rm bypass' });
    const actions = revoke.closest('[data-grant-actions]') as HTMLElement;
    expect(actions).not.toBeNull();
    const text = item.querySelector('[data-grant-text]') as HTMLElement;
    expect(text.className).toContain('w-full');
    expect(text.parentElement).toBe(item);
    expect(actions.parentElement).toBe(item);
    expect(text.contains(revoke)).toBe(false);
  });
});
