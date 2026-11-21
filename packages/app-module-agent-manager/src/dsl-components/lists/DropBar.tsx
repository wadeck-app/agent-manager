/** The bar of a drop position: above or below the element it sits in (which must be `relative`). */
export function DropBar({ edge }: { edge: 'before' | 'after' | undefined }) {
  if (edge === undefined) {
    return null;
  }
  return <span aria-hidden="true" data-drop-indicator={edge} className={`pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary ${edge === 'before' ? 'top-0' : 'bottom-0'}`} />;
}
