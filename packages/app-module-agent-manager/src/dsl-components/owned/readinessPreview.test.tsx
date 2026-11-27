import { AbExperiments } from '@wadeck-app/dsl-ui';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailHeader } from '../detail/DetailHeader.js';
import { row } from '../logic/fixtures.js';
import { DEFAULT_UI_VARIANTS, SWITCH_READINESS, UI_QUESTIONS, type UiVariantValues } from '../logic/uiVariants.js';
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

describe('the hand-over preview of the dock, on an agent that was not started here', () => {
  it('real (default): no hand-over button, no preview chip', () => {
    const { container } = header({});
    expect(container.querySelector('[data-readiness-preview]')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Hand over to/ })).toBeNull();
  });

  for (const state of ['free', 'busy', 'unknown'] as const) {
    for (const look of SWITCH_READINESS) {
      it(`look ${look} with ${state}: a preview chip and a plain icon whose glyph carries the state, no colour, no pill, no badge, no banner`, async () => {
        const { container } = header({ readinessPreview: state, switchReadiness: look });
        await waitFor(() => expect(container.querySelector('[data-readiness-preview]')).not.toBeNull());
        expect(container.querySelector('[data-readiness-preview]')).toHaveTextContent(`Preview: ${state}`);
        const wrapper = container.querySelector('[data-adopt-button]') as HTMLElement;
        expect(wrapper).toHaveAttribute('data-readiness', state);
        const button = within(wrapper).getByRole('button');
        // The state is said in words by the accessible name, and drawn in a part of the glyph.
        expect(button.getAttribute('aria-label')).toMatch(state === 'free' ? /nothing is running/ : state === 'busy' ? /interrupts 2 running items/ : /cannot tell what runs/);
        expect(button.textContent).toBe('');
        expect(button.querySelector('[data-handover-glyph]')).toHaveAttribute('data-handover-glyph', look);
        expect(button.querySelector('[data-handover-glyph]')).toHaveAttribute('data-handover-state', state);
        expect(container.querySelector('[data-line-item="move"]')).toBeNull();
        expect(container.querySelector('[data-adopt-banner], [data-adopt-badge], [data-readiness-dot], [data-readiness-tint]')).toBeNull();
        expect(wrapper.innerHTML).not.toMatch(/hue-green|bg-warning|text-warning/);
      });
    }
  }

  it('the preview hand-over button sends nothing: a click says it is a preview (even with the daemon known down)', async () => {
    const { container, fetches } = header({ readinessPreview: 'busy' });
    const button = await waitFor(() => {
      const found = container.querySelector('[data-adopt-button] button');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(button).toBeEnabled();
    const before = fetches.calls.length;
    await userEvent.click(button);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(/Preview only \(A\/B dock\): nothing was handed over/)).toBeInTheDocument();
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
    expect(Object.keys(UI_QUESTIONS.switchReadiness.options)).toEqual([...SWITCH_READINESS]);
    expect(SWITCH_READINESS).toHaveLength(5);
    for (const option of Object.values(UI_QUESTIONS.switchReadiness.options)) {
      expect(option.hint).toMatch(/No colour, no text, no extra row/);
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
