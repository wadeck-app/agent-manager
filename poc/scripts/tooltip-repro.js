// Run through `agent-browser eval` on a page of the app-core shell: rebuilds the structure of the old herdr rows with dsl-ui's Tooltip markup
// (a span.group with an absolute span.group-hover:opacity-100) inside an outer element that also has class `group` (the Collapsible).
(() => {
  const host = document.createElement('div');
  host.id = 'tooltip-repro';
  host.style.cssText = 'position:fixed;top:120px;left:300px;width:420px;z-index:9999;background:white;padding:8px;border:1px solid #888';
  const tip = 'pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-xs rounded bg-[#111827] px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-50 whitespace-normal text-center';
  const cell = (n) => `<span class="relative inline-flex group"><button style="margin:24px 12px">row ${n}</button><span role="tooltip" class="${tip}">tooltip ${n}</span></span>`;
  host.innerHTML = '<div class="group" id="outer-group">' + [1, 2, 3, 4].map(cell).join('') + '</div><div id="plain-wrapper">' + [5, 6, 7, 8].map(cell).join('') + '</div>';
  document.body.appendChild(host);
  return 'ok';
})();
