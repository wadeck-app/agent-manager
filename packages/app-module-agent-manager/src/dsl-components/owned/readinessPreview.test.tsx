import { AbExperiments } from '@wadeck-app/dsl-ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailHeader } from '../detail/DetailHeader.js';
import { row } from '../logic/fixtures.js';
import { DEFAULT_UI_VARIANTS, UI_QUESTIONS, type UiVariantValues } from '../logic/uiVariants.js';
import { UiVariants, UiVariantsContext } from '../ui/UiVariants.js';
import { stubFetch } from './testFetch.js';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => window.localStorage.clear());

const ID = '11111111-1111-4111-8111-111111111111';

function header(values: Partial<UiVariantValues>, fetches = stubFetch({})) {
  const view = render(
    <UiVariantsContext.Provider value={{ ...DEFAULT_UI_VARIANTS, ...values }}>
      <DetailHeader session={row({ sessionId: ID, displayName: 'plain', pid: 12 })} now={2_000_000} busy={false} onBack={vi.fn()} onTogglePin={vi.fn()} onMarkSeen={vi.fn()} onOwnedChange={vi.fn()} onForgotten={vi.fn()} onForked={vi.fn()} onOpenSource={vi.fn()} />
    </UiVariantsContext.Provider>,
  );
  return { ...view, fetches };
}

describe('the Move readiness preview of the dock, on an agent that was not started here', () => {
  it('real (default): no Move button, no preview chip', () => {
    const { container } = header({});
    expect(container.querySelector('[data-readiness-preview]')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Move to/ })).toBeNull();
  });

  for (const [state, words] of [
    ['free', 'Free to move'],
    ['busy', 'Busy: 2 running'],
    ['unknown', 'Unknown: cannot tell what runs'],
  ] as const) {
    it(`look A (badge) with ${state}: a preview chip, a tinted Move icon and the badge "${words}" in the line`, async () => {
      const { container } = header({ readinessPreview: state, switchReadiness: 'badge' });
      await waitFor(() => expect(container.querySelector('[data-readiness-preview]')).not.toBeNull());
      expect(container.querySelector('[data-readiness-preview]')).toHaveTextContent(`Preview: ${state}`);
      expect(container.querySelector('[data-adopt-button]')).toHaveAttribute('data-readiness', state);
      expect(container.querySelector('[data-readiness-tint]')).toHaveAttribute('data-readiness-tint', state);
      expect(container.querySelector('[data-line-item="move"]')).toHaveTextContent(words);
    });

    it(`look B (button) with ${state}: a coloured pill with words, no badge in the line`, async () => {
      const { container } = header({ readinessPreview: state, switchReadiness: 'button' });
      await waitFor(() => expect(container.querySelector('[data-adopt-button]')).not.toBeNull());
      expect(container.querySelector('[data-adopt-button]')).toHaveAttribute('data-readiness', state);
      expect(within(container.querySelector('[data-adopt-button]') as HTMLElement).getByRole('button')).toHaveTextContent(state === 'free' ? 'Move: free' : state === 'busy' ? 'Move: 2 running' : 'Move: unknown');
      expect(container.querySelector('[data-line-item="move"]')).toBeNull();
    });

    it(`look C (banner) with ${state}: a plain icon and the banner row under the line`, async () => {
      const { container } = header({ readinessPreview: state, switchReadiness: 'banner' });
      await waitFor(() => expect(container.querySelector('[data-adopt-banner]')).not.toBeNull());
      expect(container.querySelector('[data-adopt-banner]')).toHaveAttribute('data-adopt-banner', state);
      expect(container.querySelector('[data-adopt-button]')).toHaveAttribute('data-tone', 'neutral');
    });
  }

  it('the preview Move button sends nothing: a click says it is a preview (even with the daemon known down)', async () => {
    const { container, fetches } = header({ readinessPreview: 'busy', switchReadiness: 'button' });
    const button = await waitFor(() => {
      const found = container.querySelector('[data-adopt-button] button');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(button).toBeEnabled();
    const before = fetches.calls.length;
    await userEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(/Preview only \(A\/B dock\): nothing was moved/)).toBeInTheDocument();
    expect(fetches.calls.length).toBe(before);
  });
});

describe('the preview question in the dock', () => {
  const page = (enabled: boolean) => (
    <AbExperiments enabled={enabled}>
      <UiVariants>
        <UiVariantsContext.Consumer>{(values) => <span data-testid="preview">{values.readinessPreview}</span>}</UiVariantsContext.Consumer>
      </UiVariants>
    </AbExperiments>
  );

  it('is listed with real, free, busy and unknown, and its hints say to select any agent first', () => {
    expect(Object.keys(UI_QUESTIONS.readinessPreview.options)).toEqual(['real', 'free', 'busy', 'unknown']);
    for (const option of Object.values(UI_QUESTIONS.switchReadiness.options)) {
      expect(option.hint).toContain('select any agent in the list, then pick Free, Busy or Unknown');
    }
    expect(UI_QUESTIONS.readinessPreview.options.busy.hint).toContain('Select ANY agent');
  });

  it('forces nothing when the dock is off, even with a choice left in the storage', () => {
    window.localStorage.setItem('ab.ui-readiness-preview', 'busy');
    render(page(false));
    expect(screen.getByTestId('preview')).toHaveTextContent('real');
  });

  it('applies the stored choice when the dock is on', () => {
    window.localStorage.setItem('ab.ui-readiness-preview', 'busy');
    render(page(true));
    expect(screen.getByTestId('preview')).toHaveTextContent('busy');
  });
});
