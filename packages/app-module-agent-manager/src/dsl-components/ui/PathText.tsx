import { Scope } from './Scope.js';

/** A path in a tooltip card, which is portaled outside our scope: the scope puts our utilities back, and the path may break anywhere. */
export function PathText({ text }: { text: string }) {
  return (
    <Scope>
      <span className="break-all">{text}</span>
    </Scope>
  );
}
