(() => {
  const out = { vw: innerWidth, docOverflowX: document.documentElement.scrollWidth - innerWidth, offscreen: [], noName: [], smallHit: [], reducedMotionRule: false };
  const name = (e) => (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.textContent || e.getAttribute('title') || '').trim();
  for (const e of document.querySelectorAll('button,a[href],[role=button],input,select,textarea')) {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (!name(e) && !(e.labels && e.labels.length)) out.noName.push(e.outerHTML.slice(0, 90));
    if ((r.width < 24 || r.height < 24) && e.tagName !== 'INPUT') out.smallHit.push(`${name(e).slice(0, 25)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  for (const e of document.querySelectorAll('main *, [data-owned-bar] *, header *')) {
    const r = e.getBoundingClientRect();
    if (r.width > 0 && (r.right > innerWidth + 1 || r.left < -1)) { out.offscreen.push(`${e.tagName}.${(e.className || '').toString().slice(0, 40)} ${Math.round(r.left)}..${Math.round(r.right)}`); if (out.offscreen.length > 6) break; }
  }
  for (const sheet of document.styleSheets) { try { for (const rule of sheet.cssRules) { if (rule.conditionText && rule.conditionText.includes('prefers-reduced-motion')) out.reducedMotionRule = true; } } catch (_) {} }
  out.smallHit = out.smallHit.slice(0, 12); out.noName = out.noName.slice(0, 8);
  return JSON.stringify(out);
})()
