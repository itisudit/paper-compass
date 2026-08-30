// ---- focused step-by-step Deep Dive ----
(function(){
  const stepMeta=[
    ['Phase 1 · Aerial view','Get a broad overview'],
    ['Phase 1 · Aerial view','Name the core question'],
    ['Phase 1 · Aerial view','Map the knowledge gap'],
    ['Phase 2 · Interrogation','Appraise methods & power'],
    ['Phase 2 · Interrogation','Reach your conclusion first'],
    ['Phase 3 · Verdict','Reconcile conclusions'],
    ['Phase 3 · Verdict','Find confounders & limits']
  ];
  const articles=[...document.querySelectorAll('.step')];
  const phases=[...document.querySelectorAll('.phase')];
  const audit=document.querySelector('.workspace[aria-labelledby="evidence-title"]');
  if(!articles.length) return;
  let current=1;
  const nav=document.createElement('div');
  nav.className='step-navigator';
  nav.innerHTML=`<div class="step-nav-copy"><div class="step-nav-kicker"></div><div class="step-nav-title"></div></div><div class="step-dots" aria-label="Reading progress"></div><div class="step-nav-controls"><button type="button" class="secondary" data-prev>← Previous</button><button type="button" data-next>Next →</button></div>`;
  phases[0].parentNode.insertBefore(nav,phases[0]);
  const auditToggle=document.createElement('div');
  auditToggle.className='audit-toggle';
  auditToggle.innerHTML='<button type="button" class="secondary">Show research audit</button>';
  if(audit){ audit.parentNode.insertBefore(auditToggle,audit); audit.classList.add('audit-collapsed'); }
  function renderFocusedStep(){
    articles.forEach((a,i)=>a.classList.toggle('step-hidden',i!==current-1));
    phases.forEach(phase=>phase.classList.toggle('step-hidden',!phase.contains(articles[current-1])));
    const [phase,title]=stepMeta[current-1];
    nav.querySelector('.step-nav-kicker').textContent=`Step ${String(current).padStart(2,'0')} of 07 · ${phase}`;
    nav.querySelector('.step-nav-title').textContent=title;
    nav.querySelector('.step-dots').innerHTML=articles.map((_,i)=>`<button type="button" class="step-dot ${i+1===current?'active':''} ${document.getElementById('s'+(i+1))?.checked?'done':''}" data-jump="${i+1}" aria-label="Go to step ${i+1}"></button>`).join('');
    nav.querySelector('[data-prev]').disabled=current===1;
    nav.querySelector('[data-next]').textContent=current===7?'Finish':'Next →';
    nav.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>{current=+b.dataset.jump;renderFocusedStep();nav.scrollIntoView({behavior:'smooth',block:'start'});});
  }
  nav.querySelector('[data-prev]').onclick=()=>{if(current>1){current--;renderFocusedStep();nav.scrollIntoView({behavior:'smooth',block:'start'});}};
  nav.querySelector('[data-next]').onclick=()=>{if(current<7){current++;renderFocusedStep();nav.scrollIntoView({behavior:'smooth',block:'start'});}else if(audit){audit.classList.remove('audit-collapsed');auditToggle.querySelector('button').textContent='Hide research audit';audit.scrollIntoView({behavior:'smooth',block:'start'});}};
  if(audit){auditToggle.querySelector('button').onclick=()=>{const hidden=audit.classList.toggle('audit-collapsed');auditToggle.querySelector('button').textContent=hidden?'Show research audit':'Hide research audit';if(!hidden)audit.scrollIntoView({behavior:'smooth',block:'start'});};}
  // Keep progress dots in sync with existing completion controls.
  articles.forEach((_,i)=>document.getElementById('s'+(i+1))?.addEventListener('change',renderFocusedStep));
  renderFocusedStep();
})();
