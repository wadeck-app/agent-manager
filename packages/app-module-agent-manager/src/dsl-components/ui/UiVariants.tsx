import { useAbTest, useRegisterAbTests } from '@wadeck-app/dsl-ui';
import { createContext, useContext, type ReactNode } from 'react';
import { DEFAULT_UI_VARIANTS, UI_QUESTIONS, type UiQuestion, type UiQuestionKey, type UiVariantValues } from '../logic/uiVariants.js';

/** The current options. Exported for the tests, which force one option without the dock. */
export const UiVariantsContext = createContext<UiVariantValues>(DEFAULT_UI_VARIANTS);
const Values = UiVariantsContext;

/** One question of the dock: the options are the keys of the question (a table, so that a variant added to the type is a compile error here). */
function useQuestion<T extends string>(question: UiQuestion<T>) {
  return useAbTest<T>({ id: question.id, label: question.label, initial: question.initial, options: question.options as Record<T, { label: string; hint: string }> });
}

/**
 * Declares the design questions of the UI audit in the A/B dock (one bottom-centre switcher for all of them, dev server or `--ab-tests` only; the choice of each
 * is kept in localStorage `ab.<id>`) and gives their current values to the page below. Without this provider (a test, or a component used alone) every
 * question shows its recommended option.
 */
export function UiVariants({ children }: { children: ReactNode }) {
  const headerActions = useQuestion(UI_QUESTIONS.headerActions);
  const treeDensity = useQuestion(UI_QUESTIONS.treeDensity);
  const chipStyle = useQuestion(UI_QUESTIONS.chipStyle);
  const switchReadiness = useQuestion(UI_QUESTIONS.switchReadiness);
  const threadPlacement = useQuestion(UI_QUESTIONS.threadPlacement);
  const groupHeader = useQuestion(UI_QUESTIONS.groupHeader);
  useRegisterAbTests([headerActions, treeDensity, chipStyle, switchReadiness, threadPlacement, groupHeader]);
  const values: UiVariantValues = {
    headerActions: headerActions.value,
    treeDensity: treeDensity.value,
    chipStyle: chipStyle.value,
    switchReadiness: switchReadiness.value,
    threadPlacement: threadPlacement.value,
    groupHeader: groupHeader.value,
  };
  return <Values.Provider value={values}>{children}</Values.Provider>;
}

/** The current option of one design question. */
export function useUiVariant<K extends UiQuestionKey>(key: K): UiVariantValues[K] {
  return useContext(Values)[key];
}
