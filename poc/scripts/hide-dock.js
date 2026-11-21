// Page-side script: hides the A/B dock and its spacer (picture only). The dock is the fixed element that holds an A/B test label.
(() => {
  const spacer = document.querySelector('[data-testid="ab-dock-spacer"]');
  if (spacer) spacer.style.display = 'none';
  const label = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /^(Log style|Sessions layout|Sub-agents: layout|Header actions)$/.test(e.textContent || ''));
  let n = label; while (n && getComputedStyle(n).position !== 'fixed') n = n.parentElement;
  if (n) n.style.display = 'none';
  return JSON.stringify({ spacer: !!spacer, dock: !!n });
})()
