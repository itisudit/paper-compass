// ---- theme ----
function applyTheme(theme){
  document.documentElement.setAttribute('data-theme',theme);
  localStorage.setItem('paper-compass-theme',theme);
  const btn=$('#themeToggle'); if(btn) btn.textContent=theme==='dark'?'☀ Light':'● Dark';
}
function initTheme(){
  const saved=localStorage.getItem('paper-compass-theme');
  const theme=saved||(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  applyTheme(theme);
}
initTheme();

// ---- saved labels (personal taxonomy, kept in localStorage, reused across every paper) ----
function getSavedLabels(){
  try{ return JSON.parse(localStorage.getItem(LABELS_STORAGE_KEY)||'[]'); }catch(e){ return []; }
}
function setSavedLabels(list){
  localStorage.setItem(LABELS_STORAGE_KEY, JSON.stringify([...new Set(list.map(l=>l.trim()).filter(Boolean))]));
}
function addSavedLabel(label){
  const clean=label.trim(); if(!clean) return;
  const list=getSavedLabels();
  if(!list.some(l=>l.toLowerCase()===clean.toLowerCase())){ list.push(clean); setSavedLabels(list); }
  renderLabelChips();
}
function currentLabelsList(){
  return $('#labels').value.split(',').map(l=>l.trim()).filter(Boolean);
}
function addLabelToField(label){
  const current=currentLabelsList();
  if(current.some(l=>l.toLowerCase()===label.toLowerCase())) return;
  current.push(label);
  $('#labels').value=current.join(', ');
  $('#labels').dispatchEvent(new Event('input'));
}
function renderLabelChips(){
  const row=$('#labelChipRow'); if(!row) return;
  const saved=getSavedLabels();
  if(!saved.length){ row.innerHTML=''; return; }
  row.innerHTML=saved.map(l=>`<button type="button" class="label-chip" data-chip="${esc(l)}">${esc(l)} +</button>`).join('');
  row.querySelectorAll('[data-chip]').forEach(btn=>btn.onclick=()=>addLabelToField(btn.dataset.chip));
}
$('#addNewLabel').onclick=()=>{
  const input=$('#newLabelInput'); const val=input.value.trim();
  if(!val) return;
  addSavedLabel(val);
  addLabelToField(val);
  input.value='';
};
$('#newLabelInput').addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); $('#addNewLabel').click(); } });

const fields=()=>[...document.querySelectorAll('input,textarea')].filter(x=>!['eConcern','eEvidence','eLocation','eSeverity','cClaim','cEvidence','cAssessment','cStrength','modalTitle','modalCitation','modalExplore','modalSource','modalPdf','modalAuthors','modalJournal','modalYear','authEmail','workspacePdf','selectionLink','newLabelInput'].includes(x.id));
const fieldKey=x=>x.dataset.note?`note-${x.dataset.note}`:x.id;
function readFields(){ fields().forEach(x=>data.fields[fieldKey(x)]=x.type==='checkbox'?x.checked:x.value); }

// ---- structured citation helpers ----
function composedCitation(f){
  const parts=[f.authors,f.journal,f.year,f.citation].map(x=>(x||'').trim()).filter(Boolean);
  return parts.join(' · ');
}

// ---- cloud persistence (debounced) ----
let cloudTimer=null;
function queueCloudSave(){ clearTimeout(cloudTimer); cloudTimer=setTimeout(cloudSaveActive,700); }
async function cloudSaveActive(){
  if(!library.activeId||!currentUser) return;
  const paper=library.papers[library.activeId];
  const {error}=await supaClient.from('papers').update({
    title:paper.title, citation:paper.citation, data:paper.data,
    authors:paper.authors||'', journal:paper.journal||'', year:paper.year||'',
    pdf_path:paper.pdfPath||null,
    updated_at:new Date().toISOString()
  }).eq('id',library.activeId);
  if(error){ $('#saved').textContent='Could not sync to the cloud — check your connection.'; return; }
  paper.updatedAt=Date.now();
}

function save(message='Saved'){
  if(!library.activeId) return;
  readFields();
  if(message==='Saved'&&Object.values(data.fields).some(Boolean)&&Date.now()-(data.lastCheckpointAt||0)>300000){data.lastCheckpointAt=Date.now();recordMilestone('Automatic research checkpoint');}
  const paper=library.papers[library.activeId];
  const f=data.fields;
  paper.data=data;
  paper.title=f.title||'Untitled paper';
  paper.authors=f.authors||'';
  paper.journal=f.journal||'';
  paper.year=f.year||'';
  paper.citation=composedCitation(f);
  paper.updatedAt=Date.now();
  queueCloudSave();
  $('#saved').textContent=message==='Saved'?'Saved · syncing…':message;
  clearTimeout(save.notice); save.notice=setTimeout(()=>$('#saved').textContent='',1500);
  update(); render();
}
function update(){ const count=[...document.querySelectorAll('.done:checked')].length; $('#progressText').textContent=`${count} / 7`; $('#progressBar').style.width=`${count/7*100}%`; }
function esc(v){return String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
const annotationTargetLabel=v=>({'note-s1':'Step 1','note-s2':'Step 2','note-s3':'Step 3','note-s4':'Step 4','note-s5':'Step 5','note-s6':'Step 6','note-s7':'Step 7','evidence':'Evidence table','claim':'Claim matrix'}[v]||'Unlinked');
function render(){
  $('#evidenceRows').innerHTML=data.evidence.map((x,i)=>`<tr><td>${esc(x.concern)}</td><td>${esc(x.evidence)}</td><td>${esc(x.location)}</td><td>${esc(x.severity)}</td><td><button class="delete" data-e="${i}" type="button">×</button></td></tr>`).join('')||'<tr><td colspan="5">No evidence recorded yet.</td></tr>';
  $('#claimRows').innerHTML=data.claims.map((x,i)=>`<tr><td>${esc(x.claim)}</td><td>${esc(x.evidence)}</td><td>${esc(x.assessment)}</td><td>${esc(x.strength)}</td><td><button class="delete" data-c="${i}" type="button">×</button></td></tr>`).join('')||'<tr><td colspan="5">No claims assessed yet.</td></tr>';
  $('#profile').innerHTML=profileNames.map(n=>`<label class="dimension"><span>${n}</span><select data-profile="${n}"><option>Unassessed</option><option>Strong</option><option>Uncertain</option><option>Weak</option></select></label>`).join('');
  document.querySelectorAll('[data-profile]').forEach(s=>{s.value=data.profile[s.dataset.profile]||'Unassessed';s.onchange=()=>{data.profile[s.dataset.profile]=s.value;save();};});
  const f=data.fields, passport=[['Authors',f.authors],['Journal / year',[f.journal,f.year].filter(Boolean).join(' · ')],['Question',f['note-s2']],['Design',f['note-s1']],['Main finding',f['note-s5']],['Author conclusion',f['note-s6']],['Biggest weakness',(data.evidence.find(x=>x.severity==='High')||{}).concern],['Most important evidence',(data.evidence[0]||{}).location],['Current confidence',f['note-s7']],['Would change my mind',f.changeMind]];
  $('#passport').innerHTML=passport.map(([k,v])=>`<dt>${k}</dt><dd>${esc(v||'—')}</dd>`).join('');
  $('#history').innerHTML=data.history.slice(0,12).map((x,i)=>`<li><strong>${esc(x.label||x)}</strong> <span class="text-muted">${x.at?new Date(x.at).toLocaleString():''}</span> ${x.snapshot?`<button class="delete" data-version="${i}" type="button">Open</button>`:''}</li>`).join('')||'<li>No revisions yet.</li>';
  const verdict=document.querySelector('[data-note="s5"]'), lock=$('#lockVerdict'); verdict.readOnly=data.verdictLocked; verdict.classList.toggle('locked',data.verdictLocked); lock.textContent=data.verdictLocked?'Verdict locked':'Lock verdict & reveal discussion'; lock.disabled=data.verdictLocked; $('#discussionState').classList.toggle('show',data.verdictLocked);
  document.querySelectorAll('.delete[data-version],.delete[data-e],.delete[data-c]').forEach(b=>b.onclick=()=>{if(b.dataset.version!==undefined){if(confirm('Open this earlier version? Your current version remains in history.')){const current=structuredClone(data);data=structuredClone(data.history[+b.dataset.version].snapshot);data.history=current.history;fields().forEach(x=>{const v=data.fields[fieldKey(x)];x.type==='checkbox'?x.checked=Boolean(v):x.value=v||'';});save('Earlier version opened');}}else if(b.dataset.e!==undefined)data.evidence.splice(+b.dataset.e,1);else data.claims.splice(+b.dataset.c,1);save();});
  renderReminders();
  renderAnnotations();
  renderLabelChips();
}

// ---- step-completion history (per paper, precise timestamps) ---- 
// Every s1..s7 checkbox change is logged here as {step, completedAt, action},
// separately from the generic autosave-on-input/change wiring below, so the
// Stats "steps completed over time" chart can be built from real events
// instead of an approximation.
function logStepChange(stepNum, checked){
  data.stepHistory=data.stepHistory||[];
  data.stepHistory.push({ step: stepNum, completedAt: Date.now(), action: checked?'completed':'uncompleted' });
}
[1,2,3,4,5,6,7].forEach(n=>{
  const box=document.getElementById('s'+n);
  box.addEventListener('change',()=>{
    logStepChange(n, box.checked);
    save(); // triggers the normal save/cloud-sync pipeline
  });
});

// ---- phase reminders (dismissible, persisted per paper) ----
function renderReminders(){
  ['reminder1','reminder2','reminder3'].forEach(id=>{
    const el=document.getElementById(id);
    if(!el) return;
    el.hidden=(data.dismissedReminders||[]).includes(id);
  });
}
document.querySelectorAll('[data-dismiss]').forEach(b=>b.onclick=()=>{
  const id=b.dataset.dismiss;
  data.dismissedReminders=data.dismissedReminders||[];
  if(!data.dismissedReminders.includes(id)) data.dismissedReminders.push(id);
  save('Saved');
});

// ---- prodding-question toggles (UI-only, no save needed) ----
document.querySelectorAll('.hint-toggle').forEach(btn=>{
  btn.onclick=()=>{
    const panel=document.getElementById(btn.dataset.hint);
    const showing=panel.classList.toggle('show');
    btn.classList.toggle('active',showing);
  };
});
