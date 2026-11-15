// Page-side script: direct children of #root, and the first row above the workspace (top bar, breadcrumb).
(() => {
  const out = [];
  for (const el of document.getElementById('root').children) { const r = el.getBoundingClientRect(); out.push([el.tagName, String(el.className).slice(0, 50), Math.round(r.y), Math.round(r.height)]); }
  const bar = document.querySelector('header'); const bc = document.querySelector('nav[aria-label*="read" i], nav[aria-label*="Breadcrumb" i]');
  const b = bc && bc.getBoundingClientRect();
  return JSON.stringify({ rootChildren: out, header: bar && Math.round(bar.getBoundingClientRect().height), crumb: b && [Math.round(b.y), Math.round(b.height)], sidebar: (document.querySelector('aside') || {getBoundingClientRect: () => ({})}).getBoundingClientRect().width });
})()
