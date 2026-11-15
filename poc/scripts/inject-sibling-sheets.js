// Page-side script (agent-browser eval): appends the full Tailwind sheet of the other modules, linked from the REAL dev shell (GET only, a cross-origin
// stylesheet needs no CORS), after ours, as the real shell does (it loads every module's sheet).
(async () => {
  const modules = ['orchestrator', 'flow', 'flow-chart', 'task'];
  await Promise.all(modules.map((name) => new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.dataset.sibling = name;
    link.href = 'http://localhost:5173/api/modules/' + name + '/_lib/style.css';
    link.onload = resolve;
    link.onerror = () => reject(new Error('cannot load the sheet of ' + name));
    document.head.appendChild(link);
  })));
  return 'injected ' + document.querySelectorAll('link[data-sibling]').length;
})()
