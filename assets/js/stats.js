// ---- STATS DASHBOARD ---- 
function dayKey(d){ const x=new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`; }
function monthKey(d){ const x=new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}`; }
async function ensureSessionsLoaded(){
  if(sessionsCache.length||!currentUser) return sessionsCache;
  const {data:rows,error}=await supaClient.from('reading_sessions').select('*').eq('user_id',currentUser.id).order('started_at',{ascending:true});
  if(error){ console.error(error); sessionsCache=[]; return sessionsCache; }
  sessionsCache=rows||[];
  return sessionsCache;
}
function computeStreaks(daySet){
  const days=[...daySet].sort();
  if(!days.length) return {current:0,longest:0};
  let longest=1, run=1;
  for(let i=1;i<days.length;i++){
    const prev=new Date(days[i-1]), cur=new Date(days[i]);
    const diff=Math.round((cur-prev)/86400000);
    if(diff===1){ run++; } else { longest=Math.max(longest,run); run=1; }
  }
  longest=Math.max(longest,run);
  let current=0; let cursor=new Date();
  while(daySet.has(dayKey(cursor))){ current++; cursor.setDate(cursor.getDate()-1); }
  return {current,longest};
}
function formatHM(totalSeconds){
  const h=Math.floor(totalSeconds/3600), m=Math.round((totalSeconds%3600)/60);
  return `${h}h ${m}m`;
}
// Flattens stepHistory from every paper into one array of completion events,
// each tagged with which paper it belongs to. Only 'completed' actions count
// toward the "steps completed" stats (unchecking a step doesn't count as
// negative progress here — it simply won't appear as a completion event).
function allStepCompletions(){
  const events=[];
  Object.values(library.papers).forEach(p=>{
    (p.data.stepHistory||[]).forEach(ev=>{
      if(ev.action==='completed') events.push({...ev, paperId:p.id});
    });
  });
  return events.sort((a,b)=>a.completedAt-b.completedAt);
}
let statsRange='week';
let stepsRange='week';
async function showStats(){
  if(!requireAuth('statsView')) return;
  hideAllViews(); $('#statsView').hidden=false; setNav('statsView');
  await renderStats();
}
async function renderStats(){
  const sessions=await ensureSessionsLoaded();
  const totalSeconds=sessions.reduce((sum,s)=>sum+(s.duration_seconds||0),0);
  const papers=Object.values(library.papers);
  const completed=papers.filter(p=>Object.entries(p.data.fields||{}).filter(([k,v])=>/^s[1-7]$/.test(k)&&v===true).length===7).length;
  const stepEvents=allStepCompletions();

  $('#statTotalTime').textContent=formatHM(totalSeconds);
  $('#statSessions').textContent=sessions.length;
  $('#statPapers').textContent=papers.length;
  $('#statCompleted').textContent=completed;
  $('#statAvgSession').textContent=sessions.length?`${Math.round((totalSeconds/sessions.length)/60)}m`:'0m';
  $('#statStepsTotal').textContent=stepEvents.length;

  const now=new Date();
  const weekAgo=new Date(now); weekAgo.setDate(weekAgo.getDate()-6); weekAgo.setHours(0,0,0,0);
  const thisWeekSeconds=sessions.filter(s=>new Date(s.started_at)>=weekAgo).reduce((sum,s)=>sum+(s.duration_seconds||0),0);
  $('#statThisWeek').textContent=formatHM(thisWeekSeconds);
  $('#statStepsThisWeek').textContent=stepEvents.filter(ev=>new Date(ev.completedAt)>=weekAgo).length;

  const daySet=new Set(sessions.map(s=>dayKey(s.started_at)));
  const {current,longest}=computeStreaks(daySet);
  $('#statStreak').textContent=current;
  $('#statLongestStreak').textContent=longest;

  renderHeatmap(sessions);
  renderTimeChart(sessions);
  renderStepsChart(stepEvents);
}
function renderHeatmap(sessions){
  const byDay={};
  sessions.forEach(s=>{ const k=dayKey(s.started_at); byDay[k]=(byDay[k]||0)+(s.duration_seconds||0); });
  const days=[]; const today=new Date(); today.setHours(0,0,0,0);
  const totalDays=371; // \~53 weeks, contribution-style
  const start=new Date(today); start.setDate(start.getDate()-(totalDays-1));
  while(start.getDay()!==0){ start.setDate(start.getDate()-1); }
  for(let d=new Date(start); d<=today; d.setDate(d.getDate()+1)){
    days.push(new Date(d));
  }
  const maxSeconds=Math.max(1,...Object.values(byDay));
  const heatmap=$('#heatmap');
  heatmap.innerHTML=days.map(d=>{
    const k=dayKey(d);
    const secs=byDay[k]||0;
    let level=0;
    if(secs>0){ const ratio=secs/maxSeconds; level = ratio>0.75?4 : ratio>0.5?3 : ratio>0.25?2 : 1; }
    return `<div class="cell" data-level="${level}" data-day="${k}" data-secs="${secs}" title="${k}: ${Math.round(secs/60)}m"></div>`;
  }).join('');
  heatmap.querySelectorAll('.cell').forEach(cell=>cell.onclick=()=>{
    const k=cell.dataset.day;
    const daySessions=sessions.filter(s=>dayKey(s.started_at)===k);
    const detail=$('#dayDetail');
    if(!daySessions.length){
      detail.className='day-detail empty-state';
      detail.textContent=`No reading sessions on ${k}.`;
      return;
    }
    detail.className='day-detail';
    const totalM=Math.round(daySessions.reduce((s,x)=>s+x.duration_seconds,0)/60);
    detail.innerHTML=`<strong>${k}</strong> — ${totalM} minute${totalM===1?'':'s'} across ${daySessions.length} session${daySessions.length===1?'':'s'}<br>`+
      daySessions.map(s=>{
        const paper=library.papers[s.paper_id];
        const start=new Date(s.started_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
        return `${start} · ${Math.round(s.duration_seconds/60)}m${paper?` · ${esc(paper.title||'Untitled paper')}`:''}`;
      }).join('<br>');
  });
}
function renderTimeChart(sessions){
  const wrap=$('#timeChart');
  let buckets={}, order=[], labelFor;
  if(statsRange==='week'){
    for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); const k=dayKey(d); buckets[k]=0; order.push(k); }
    sessions.forEach(s=>{ const k=dayKey(s.started_at); if(k in buckets) buckets[k]+=s.duration_seconds; });
    labelFor=k=>new Date(k).toLocaleDateString([], {weekday:'short'});
  } else if(statsRange==='month'){
    for(let i=29;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); const k=dayKey(d); buckets[k]=0; order.push(k); }
    sessions.forEach(s=>{ const k=dayKey(s.started_at); if(k in buckets) buckets[k]+=s.duration_seconds; });
    labelFor=k=>{ const d=new Date(k); return `${d.getDate()}/${d.getMonth()+1}`; };
  } else {
    for(let i=11;i>=0;i--){ const d=new Date(); d.setMonth(d.getMonth()-i,1); const k=monthKey(d); buckets[k]=0; order.push(k); }
    sessions.forEach(s=>{ const k=monthKey(s.started_at); if(k in buckets) buckets[k]+=s.duration_seconds; });
    labelFor=k=>{ const [y,m]=k.split('-'); return new Date(+y,+m-1,1).toLocaleDateString([], {month:'short'}); };
  }
  const maxVal=Math.max(1,...order.map(k=>buckets[k]));
  wrap.innerHTML=order.map(k=>{
    const secs=buckets[k];
    const heightPct=Math.max(2,Math.round((secs/maxVal)*100));
    const mins=Math.round(secs/60);
    return `<div class="bar-col"><span class="bar-value">${mins?mins+'m':''}</span><div class="bar" style="height:${heightPct}%"></div><span class="bar-label">${esc(labelFor(k))}</span></div>`;
  }).join('');
}
document.querySelectorAll('.range-toggle button[data-range]').forEach(btn=>btn.onclick=async()=>{
  statsRange=btn.dataset.range;
  document.querySelectorAll('.range-toggle button[data-range]').forEach(b=>b.classList.toggle('active',b===btn));
  renderTimeChart(await ensureSessionsLoaded());
});
// Exact steps-completed chart, built from real stepHistory completion
// timestamps across every paper — no estimation.
function renderStepsChart(stepEvents){
  stepEvents=stepEvents||allStepCompletions();
  const wrap=$('#stepsChart');
  let buckets={}, order=[], labelFor;
  if(stepsRange==='week'){
    for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); const k=dayKey(d); buckets[k]=0; order.push(k); }
    stepEvents.forEach(ev=>{ const k=dayKey(ev.completedAt); if(k in buckets) buckets[k]++; });
    labelFor=k=>new Date(k).toLocaleDateString([], {weekday:'short'});
  } else if(stepsRange==='month'){
    for(let i=29;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); const k=dayKey(d); buckets[k]=0; order.push(k); }
    stepEvents.forEach(ev=>{ const k=dayKey(ev.completedAt); if(k in buckets) buckets[k]++; });
    labelFor=k=>{ const d=new Date(k); return `${d.getDate()}/${d.getMonth()+1}`; };
  } else {
    for(let i=11;i>=0;i--){ const d=new Date(); d.setMonth(d.getMonth()-i,1); const k=monthKey(d); buckets[k]=0; order.push(k); }
    stepEvents.forEach(ev=>{ const k=monthKey(ev.completedAt); if(k in buckets) buckets[k]++; });
    labelFor=k=>{ const [y,m]=k.split('-'); return new Date(+y,+m-1,1).toLocaleDateString([], {month:'short'}); };
  }
  const maxVal=Math.max(1,...order.map(k=>buckets[k]));
  wrap.innerHTML=order.map(k=>{
    const val=buckets[k];
    const heightPct=Math.max(2,Math.round((val/maxVal)*100));
    return `<div class="bar-col"><span class="bar-value">${val||''}</span><div class="bar" style="height:${heightPct}%"></div><span class="bar-label">${esc(labelFor(k))}</span></div>`;
  }).join('');
}
document.querySelectorAll('.range-toggle button[data-steps-range]').forEach(btn=>btn.onclick=()=>{
  stepsRange=btn.dataset.stepsRange;
  document.querySelectorAll('.range-toggle button[data-steps-range]').forEach(b=>b.classList.toggle('active',b===btn));
  renderStepsChart();
});


boot();
