// Page-side script (run with agent-browser eval): bounding box + box model of every ancestor of the workspace root, up to body.
(() => {
  const start = document.querySelector('[data-pane="list"]');
  if (!start) return JSON.stringify({ error: 'no [data-pane=list] on the page' });
  const split = start.parentElement;
  const chain = [];
  for (let el = split; el && el !== document.documentElement; el = el.parentElement) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    chain.push({
      tag: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + String(el.className).split(/\s+/).slice(0, 4).join('.'),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      pad: cs.padding, mar: cs.margin, maxW: cs.maxWidth, ov: cs.overflowX + '/' + cs.overflowY, disp: cs.display, pos: cs.position,
    });
  }
  const list = start.getBoundingClientRect();
  const detail = document.querySelector('[data-pane="detail"]').getBoundingClientRect();
  return JSON.stringify({ vw: innerWidth, vh: innerHeight, scrollH: document.documentElement.scrollHeight, listW: Math.round(list.width), detailW: Math.round(detail.width), splitH: Math.round(split.getBoundingClientRect().height), chain }, null, 1);
})()
