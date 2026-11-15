// Page-side script: the box of the workspace, the panes, the page scroll and the smallest font size in the workspace.
(() => {
  const w = document.querySelector('[data-agent-workspace]');
  if (!w) return JSON.stringify({ vw: innerWidth, vh: innerHeight, workspace: null });
  const r = w.getBoundingClientRect(); const l = document.querySelector('[data-pane="list"]'); const d = document.querySelector('[data-pane="detail"]');
  let min = 99; for (const e of w.querySelectorAll('*')) { if (e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) { const s = parseFloat(getComputedStyle(e).fontSize); if (s < min) min = s; } }
  const rows = [...document.querySelectorAll('[data-nav-item]')].map((e) => Math.round(e.getBoundingClientRect().height));
  return JSON.stringify({ vw: innerWidth, vh: innerHeight, ws: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], pct: Math.round(100 * r.width * r.height / (innerWidth * innerHeight)), list: l && Math.round(l.getBoundingClientRect().width), detail: d && Math.round(d.getBoundingClientRect().width), pageScroll: document.documentElement.scrollHeight - innerHeight, minFont: min, rowMin: rows.length ? Math.min(...rows) : null, rowMax: rows.length ? Math.max(...rows) : null });
})()
