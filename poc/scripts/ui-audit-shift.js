(() => {
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  return JSON.stringify({ row: r(document.querySelector('[role=treeitem][aria-selected=true]')), header: r(document.querySelector('[data-agent-detail] header')), log: r(document.querySelector('[data-agent-detail] [data-log], [data-agent-detail] [role=log], [data-agent-detail] .overflow-y-auto')), composer: r(document.querySelector('[data-agent-detail] textarea')), list: r(document.querySelector('[data-pane=list] [role=tree]')) });
})()
