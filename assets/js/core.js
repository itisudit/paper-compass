
// ————————————————————————————————————————————————————————————
// CLOUD DATABASE CONFIG — fill these in from your Supabase project
// (Project Settings → API → Project URL / anon public key)
// ————————————————————————————————————————————————————————————
const SUPABASE_URL = 'https://xpbnzbqzwldtouqhvhgc.supabase.co/';
const SUPABASE_ANON_KEY = 'sb_publishable_R5RAQMS_7o4n3rIr5nu_Ww_T1XQyBKb';
const PDF_BUCKET = 'paper-pdfs';
const LABELS_STORAGE_KEY = 'paper-compass-saved-labels-v1';

const $=s=>document.querySelector(s), profileNames=['Research question clarity','Design appropriateness','Internal validity','Statistical credibility','Measurement quality','External validity','Reproducibility','Transparency','Strength of evidence','Strength of conclusions'];
const blankData=()=>({fields:{},evidence:[],claims:[],profile:{},history:[],verdictLocked:false,annotations:[],dismissedReminders:[],stepHistory:[]});
let library={papers:{},activeId:null}, data=blankData(), searchCache=[];
let supaClient=null, currentUser=null, newPaperReturn=null;
let pendingPdfFile=null; // PDF chosen in the "new paper" form, uploaded once the paper row exists
let openPaperToken=0; // guards against a slow PDF load from paper A finishing after paper B was opened
let sessionsCache=[]; // reading_sessions rows for the current user, loaded lazily for the Stats view
document.querySelectorAll('.phase')[2].after(document.querySelector('.workspace'));

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

// ---- view management ----
const allViews=['configErrorView','authView','homeView','libraryView','exploreView','statsView','methodView','newPaperView','workspaceView'];
function hideAllViews(){ allViews.forEach(id=>{const el=document.getElementById(id); if(el) el.hidden=true;}); }
function setNav(view){[['navHome','homeView'],['navExplore','exploreView'],['navStats','statsView'],['navMethod','methodView']].forEach(([n,v])=>$('#'+n).classList.toggle('active',v===view));}

function relative(ts){const d=Math.max(0,Date.now()-ts),m=Math.floor(d/60000);return m<1?'just now':m<60?`${m}m ago`:m<1440?`${Math.floor(m/60)}h ago`:new Date(ts).toLocaleDateString();}
function renderLibrary(){
  const papers=Object.values(library.papers).sort((a,b)=>b.updatedAt-a.updatedAt);
  $('#paperList').innerHTML=papers.length?papers.map(p=>{const count=Object.entries(p.data.fields||{}).filter(([k,v])=>/^s[1-7]$/.test(k)&&v===true).length;const confidence=(p.data.profile&&Object.values(p.data.profile).filter(v=>v==='Strong').length>=5)?'Strong':(p.data.profile&&Object.values(p.data.profile).some(v=>v!=='Unassessed'))?'Moderate':'Unassessed';const metaLine=[p.authors,[p.journal,p.year].filter(Boolean).join(' ')].filter(Boolean).join(' · ');return `<button class="paper-card" data-paper="${p.id}" type="button"><span><h3>${esc(p.title||'Untitled paper')}</h3><p>${esc(p.citation||'No citation added')}</p>${metaLine?`<p class="paper-meta-line">${esc(metaLine)}</p>`:''}</span><span class="paper-meta">Progress ${count} / 7<br>Last edited ${relative(p.updatedAt)}<br>Confidence: ${confidence}${p.pdfPath?'<br>PDF attached':''}<br><button class="delete" data-delete="${p.id}" type="button">Delete</button></span></button>`;}).join(''):'<p class="empty">No papers yet. Create one to begin a structured reading.</p>';
  document.querySelectorAll('[data-paper]').forEach(b=>b.onclick=()=>openPaper(b.dataset.paper));
  document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=(e)=>{e.stopPropagation();deletePaper(b.dataset.delete);});
  checkLegacyLocal();
}
async function deletePaper(id){
  if(!confirm('Delete this paper and all its notes? This cannot be undone.')) return;
  const paper=library.papers[id];
  if(paper&&paper.pdfPath){
    await supaClient.storage.from(PDF_BUCKET).remove([paper.pdfPath]).catch(()=>{});
  }
  const {error}=await supaClient.from('papers').delete().eq('id',id);
  if(error){ alert('Could not delete: '+error.message); return; }
  delete library.papers[id];
  if(library.activeId===id) library.activeId=null;
  renderLibrary();
}

function showLibrary(){ if(!requireAuth('libraryView')) return; hideAllViews(); $('#libraryView').hidden=false; setNav('libraryView'); renderLibrary(); }
function showHome(){ if(!requireAuth('homeView')) return;
  const papers=Object.values(library.papers).sort((a,b)=>b.updatedAt-a.updatedAt),unfinished=papers.filter(p=>Object.entries(p.data.fields||{}).filter(([k,v])=>/^s[1-7]$/.test(k)&&v).length<7);
  $('#continueCopy').textContent=unfinished.length?'Pick up where your reading left off.':'Your deep-reading workspace is ready.';
  $('#continueList').innerHTML=unfinished.slice(0,3).map(p=>{const step=Object.entries(p.data.fields||{}).filter(([k,v])=>/^s[1-7]$/.test(k)&&!v).map(([k])=>+k.slice(1))[0]||7;const labels={1:'Get a broad overview',2:'Name the core question',3:'Map the knowledge gap',4:'Appraise methods & power',5:'Reach your conclusion first',6:'Reconcile conclusions',7:'Find confounders & limits'};return `<button class="resume" data-resume="${p.id}" type="button"><span><strong>${esc(p.title||'Untitled paper')}</strong><span>Step ${step} · ${labels[step]}</span></span><em>Continue →</em></button>`;}).join('');
  const complete=papers.length-unfinished.length; $('#librarySummary').textContent=papers.length?`${papers.length} paper${papers.length===1?'':'s'} · ${complete} completed · ${unfinished.length} in progress`:'';
  document.querySelectorAll('[data-resume]').forEach(b=>b.onclick=()=>openPaper(b.dataset.resume));
  hideAllViews(); $('#homeView').hidden=false; setNav('homeView');
}
function showExplore(){ hideAllViews(); $('#exploreView').hidden=false; setNav('exploreView'); }
function showMethod(){ hideAllViews(); $('#methodView').hidden=false; setNav(''); }
async function openPaper(id){
  if(!requireAuth('workspaceView')) return;
  const p=library.papers[id]; if(!p) return;
  const myToken=++openPaperToken; // invalidates any in-flight PDF load from a previously opened paper

  library.activeId=id; data={...blankData(),...p.data};
  data.history=(data.history||[]).map(x=>typeof x==='string'?{at:Date.now(),label:x}:x);
  data.annotations=data.annotations||[];
  data.dismissedReminders=data.dismissedReminders||[];
  data.stepHistory=data.stepHistory||[];
  data.fields.authors=data.fields.authors||p.authors||'';
  data.fields.journal=data.fields.journal||p.journal||'';
  data.fields.year=data.fields.year||p.year||'';
  fields().forEach(x=>{const v=data.fields[fieldKey(x)];x.type==='checkbox'?x.checked=Boolean(v):x.value=v||'';});
  resetPdfViewer();
  resetTimerUI();
  hideAllViews(); $('#workspaceView').hidden=false; setNav('');
  update(); render();
  if(p.pdfPath){ await loadPdfFromStorage(p.pdfPath, myToken); }
}

// ---- new paper (real page, not a popup) ----
function showNewPaperView(prefill={}, returnTo=showHome){
  if(!requireAuth('newPaperView')) return;
  newPaperReturn=returnTo;
  pendingPdfFile=null;
  hideAllViews(); $('#newPaperView').hidden=false; setNav('');
  $('#modalTitle').value=prefill.title||''; $('#modalCitation').value=prefill.citation||''; $('#modalSource').value=prefill.source||'';
  $('#modalAuthors').value=prefill.authors||''; $('#modalJournal').value=prefill.journal||''; $('#modalYear').value=prefill.year||'';
  $('#modalPdf').value='';
  $('#lookupStatus').textContent=''; $('#modalTitle').focus();
}
function closeNewPaper(){ $('#newPaperForm').reset(); pendingPdfFile=null; (newPaperReturn||showHome)(); }
function sanitizeFileName(name){ return name.replace(/[^a-z0-9._-]/gi,'_'); }
async function uploadPdfForPaper(paperId,file){
  const path=`${currentUser.id}/${paperId}-${Date.now()}-${sanitizeFileName(file.name)}`;
  const {error}=await supaClient.storage.from(PDF_BUCKET).upload(path,file,{contentType:'application/pdf',upsert:false});
  if(error) throw error;
  return path;
}
async function createPaper(fieldsIn,fromExplore=false){
  const submitBtn=$('#submitNewPaper'); submitBtn.disabled=true; submitBtn.textContent='Creating…';
  const next=blankData();
  next.fields.title=(fieldsIn.title||'').trim()||'Untitled paper';
  next.fields.authors=(fieldsIn.authors||'').trim();
  next.fields.journal=(fieldsIn.journal||'').trim();
  next.fields.year=(fieldsIn.year||'').trim();
  next.fields.citation=(fieldsIn.citation||'').trim();
  next.history=[{at:Date.now(),label:fromExplore?'Started paper from Explore':'Started paper'}];
  const citation=composedCitation(next.fields);
  const {data:row,error}=await supaClient.from('papers').insert({
    user_id:currentUser.id, title:next.fields.title, citation,
    authors:next.fields.authors, journal:next.fields.journal, year:next.fields.year,
    data:next
  }).select().single();
  if(error){ submitBtn.disabled=false; submitBtn.textContent='Start reading'; $('#lookupStatus').textContent='Could not create paper: '+error.message; return; }

  let pdfPath=null;
  if(pendingPdfFile){
    submitBtn.textContent='Uploading PDF…';
    try{
      pdfPath=await uploadPdfForPaper(row.id,pendingPdfFile);
      await supaClient.from('papers').update({pdf_path:pdfPath}).eq('id',row.id);
    }catch(err){
      $('#lookupStatus').textContent='Paper created, but the PDF upload failed: '+err.message+'. You can upload it again from the workspace.';
    }
  }

  submitBtn.disabled=false; submitBtn.textContent='Start reading';
  library.papers[row.id]={id:row.id,title:row.title,citation:row.citation,authors:row.authors||'',journal:row.journal||'',year:row.year||'',pdfPath,createdAt:new Date(row.created_at).getTime(),updatedAt:new Date(row.updated_at).getTime(),data:row.data};
  $('#newPaperForm').reset();
  pendingPdfFile=null;
  openPaper(row.id);
}

function authorsFrom(item){return (item.author||[]).slice(0,8).map(a=>[a.family,a.given].filter(Boolean).join(', ')).join('; ');}
function yearFrom(item){return String((((item.published&&item.published['date-parts']&&item.published['date-parts'][0])||[])[0])||'');}
function citationFrom(item){const authors=authorsFrom(item);const year=yearFrom(item);return [authors,item['container-title']&&item['container-title'][0],year,item.DOI&&`doi:${item.DOI}`].filter(Boolean).join(' · ');}
function doiFrom(text){const m=String(text||'').match(/10\.\d{4,9}\/[\w.()/:;+-]+/i);return m?m[0].replace(/[.,;]+$/,''):'';}
async function fillFromDoi(doi){
  const response=await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  if(!response.ok)throw new Error('No metadata record found');
  const item=(await response.json()).message;
  $('#modalTitle').value=(item.title||[])[0]||'';
  $('#modalAuthors').value=authorsFrom(item);
  $('#modalJournal').value=(item['container-title']&&item['container-title'][0])||'';
  $('#modalYear').value=yearFrom(item);
  $('#modalCitation').value=item.DOI?`doi:${item.DOI}`:'';
  return item;
}

// ---- PDF text extraction for lookup (uses pdf.js properly, instead of raw-byte regex) ----
async function extractPdfTextAndMeta(file){
  const buf=await file.arrayBuffer();
  const doc=await pdfjsLib.getDocument({data:buf}).promise;
  const meta=await doc.getMetadata().catch(()=>null);
  let fullText='';
  const pagesToScan=Math.min(2,doc.numPages);
  const lines=[];
  for(let i=1;i<=pagesToScan;i++){
    const page=await doc.getPage(i);
    const content=await page.getTextContent();
    let lastY=null, currentLine='';
    content.items.forEach(item=>{
      const y=item.transform[5];
      if(lastY!==null && Math.abs(y-lastY)>2){
        if(currentLine.trim()) lines.push(currentLine.trim());
        currentLine='';
      }
      currentLine+=item.str+' ';
      lastY=y;
    });
    if(currentLine.trim()) lines.push(currentLine.trim());
    fullText+=content.items.map(it=>it.str).join(' ')+'\n';
  }
  return {fullText, lines, info:meta&&meta.info};
}
function guessTitleFromLines(lines){
  const skipPatterns=/^(doi|issn|volume|vol\.|www\.|http|copyright|©|received|accepted|published|journal of|proceedings of)/i;
  for(const line of lines.slice(0,25)){
    const clean=line.trim();
    if(clean.length<15||clean.length>220) continue;
    if(skipPatterns.test(clean)) continue;
    if(/^\d+$/.test(clean)) continue;
    return clean;
  }
  return '';
}
function guessAuthorsFromLines(lines,titleLine){
  const titleIdx=lines.findIndex(l=>l===titleLine);
  const searchFrom=titleIdx>=0?titleIdx+1:0;
  const authorPattern=/^([A-Z][a-zà-ÿ'-]+(\s[A-Z]\.?)\*\s[A-Z][a-zà-ÿ'-]+)(\s\*,\s\*|\s+and\s+|\s\*&\s\*)/;
  for(const line of lines.slice(searchFrom,searchFrom+6)){
    const clean=line.trim();
    if(clean.length<6||clean.length>300) continue;
    if(authorPattern.test(clean) || /,/.test(clean) && /[A-Z][a-z]+ [A-Z][a-z]+/.test(clean)){
      return clean.replace(/\s\*\d+(,\d+)\*\s\*$/,'').trim();
    }
  }
  return '';
}
function guessJournalYear(fullText){
  const yearMatch=fullText.match(/\b(19|20)\d{2}\b/);
  const journalMatch=fullText.match(/(?:published in|journal of [a-z &]+|proceedings of [a-z &]+)/i);
  return { year: yearMatch?yearMatch[0]:'', journal: journalMatch?journalMatch[0].replace(/^published in\s\*/i,'').trim():'' };
}

async function lookupPaper(){
  const status=$('#lookupStatus'), source=$('#modalSource').value.trim(), pdf=$('#modalPdf').files[0];
  status.textContent='Looking up metadata…';
  try{
    let doi=doiFrom(source);
    if(doi){
      await fillFromDoi(doi);
      status.textContent='Paper details filled from DOI metadata.';
      return;
    }

    if(!pdf){
      throw new Error('Add a DOI, DOI-link, or choose a PDF to look up.');
    }

    status.textContent='Reading the PDF for a DOI and title/author details…';
    const {fullText, lines, info}=await extractPdfTextAndMeta(pdf);

    doi=doiFrom(fullText);
    if(doi){
      await fillFromDoi(doi);
      status.textContent='Found a DOI inside the PDF text and filled details from CrossRef metadata. Please double-check.';
      return;
    }

    const pdfInfoTitle=info&&info.Title&&info.Title.trim();
    const pdfInfoAuthor=info&&info.Author&&info.Author.trim();

    const guessedTitle=pdfInfoTitle||guessTitleFromLines(lines)||pdf.name.replace(/\.pdf$/i,'').replace(/[_-]+/g,' ');
    const guessedAuthors=pdfInfoAuthor||guessAuthorsFromLines(lines,guessedTitle);
    const {year,journal}=guessJournalYear(fullText);

    $('#modalTitle').value=$('#modalTitle').value||guessedTitle;
    $('#modalAuthors').value=$('#modalAuthors').value||guessedAuthors;
    $('#modalJournal').value=$('#modalJournal').value||journal;
    $('#modalYear').value=$('#modalYear').value||year;

    status.textContent='No DOI found in this PDF, so details were estimated from the document text — please check title, authors, journal and year carefully.';
  }catch(error){
    status.textContent=`Could not look that up: ${error.message}. You can still enter details manually.`;
  }
}

async function searchExplore(query){const status=$('#searchStatus');status.textContent='Searching scholarly records…';$('#searchResults').innerHTML='';try{const response=await fetch(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=8)`);if(!response.ok)throw new Error('Search unavailable');searchCache=(await response.json()).message.items||[];$('#searchResults').innerHTML=searchCache.map((x,i)=>`<article class="result"><div><h3>${esc((x.title||[])[0]||'Untitled record')}</h3><p>${esc(citationFrom(x)||x.DOI||'Metadata incomplete')}</p></div><button class="quiet-link" data-result="${i}" type="button">Deep dive →</button></article>`).join('')||'<p class="search-status">No records found.</p>';document.querySelectorAll('[data-result]').forEach(b=>b.onclick=()=>{const x=searchCache[+b.dataset.result];showNewPaperView({title:(x.title||[])[0]||'',authors:authorsFrom(x),journal:(x['container-title']&&x['container-title'][0])||'',year:yearFrom(x),citation:x.DOI?`doi:${x.DOI}`:'',source:x.DOI||''},showExplore);});status.textContent=searchCache.length?`${searchCache.length} records found. Choose only the papers worth a deep dive.`:'';}catch(error){status.textContent='Search is unavailable right now. You can still use the external research tools below.';}} 

// ---- legacy local-storage import (one-time, opt-in) ---- 
function checkLegacyLocal(){ 
  try{ 
    const raw=localStorage.getItem('paper-compass-library-v1'); 
    if(!raw){ $('#importNote').hidden=true; return; } 
    const legacy=JSON.parse(raw); 
    $('#importNote').hidden=!(legacy&&legacy.papers&&Object.keys(legacy.papers).length); 
  }catch(e){ $('#importNote').hidden=true; } 
} 
async function importLegacyLocal(){ 
  const raw=localStorage.getItem('paper-compass-library-v1'); if(!raw) return; 
  let legacy; try{ legacy=JSON.parse(raw); }catch(e){ return; } 
  const papers=Object.values(legacy.papers||{}); if(!papers.length) return; 
  const btn=$('#importLocal'); btn.textContent='Importing…'; btn.disabled=true; 
  for(const p of papers){ 
    const d={...blankData(),...p.data};
    await supaClient.from('papers').insert({user_id:currentUser.id,title:p.title||'Untitled paper',citation:p.citation||'',authors:d.fields.authors||'',journal:d.fields.journal||'',year:d.fields.year||'',data:d}); 
  } 
  localStorage.removeItem('paper-compass-library-v1'); 
  await loadLibrary(); renderLibrary(); 
} 

// ---- PDF.js viewer + text-selection annotations + cloud storage ---- 
let pdfDoc=null, pdfCurrentPage=1, pdfScale=1.15, pdfRenderingLock=false, pdfPendingSelection=null;
if(window['pdfjsLib']) pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

function setPdfStatus(text,cls){
  const pill=$('#pdfStatusPill');
  pill.textContent=text||'';
  pill.className='pdf-status-pill'+(cls?` ${cls}`:'');
}
function resetPdfViewer(){
  pdfDoc=null; pdfCurrentPage=1; pdfScale=1.15; pdfPendingSelection=null;
  $('#pdfFileName').textContent='';
  $('#workspacePdf').value='';
  $('#pdfCanvasWrap').innerHTML='<p class="pdf-empty">No PDF loaded yet. Upload one above to read alongside your notes — select any text to turn it into a linked annotation.</p>';
  $('#pdfPageInfo').textContent='– / –';
  $('#pdfZoomInfo').textContent='100%';
  setPdfStatus('');
  hideSelectionBar();
}
async function loadPdfFromArrayBuffer(buf,label,token){
  $('#pdfCanvasWrap').innerHTML='<p class="pdf-empty">Loading PDF…</p>';
  try{
    const loaded=await pdfjsLib.getDocument({data:buf}).promise;
    if(token!==undefined && token!==openPaperToken) return; // a newer paper was opened meanwhile — discard
    pdfDoc=loaded;
    pdfCurrentPage=1;
    await renderPdfPage();
    if(label) $('#pdfFileName').textContent=label;
  }catch(err){
    if(token!==undefined && token!==openPaperToken) return;
    $('#pdfCanvasWrap').innerHTML=`<p class="pdf-empty">Could not open this PDF: ${esc(err.message)}</p>`;
    setPdfStatus('Could not open PDF','error');
  }
}
async function loadPdfFromStorage(path,token){
  setPdfStatus('Loading saved PDF…','uploading');
  try{
    const {data:blob,error}=await supaClient.storage.from(PDF_BUCKET).download(path);
    if(error) throw error;
    if(token!==undefined && token!==openPaperToken) return; // stale — a different paper is now open
    const buf=await blob.arrayBuffer();
    await loadPdfFromArrayBuffer(buf, path.split('/').pop().replace(/^\d+-/,''), token);
    if(token!==undefined && token!==openPaperToken) return;
    setPdfStatus('Saved PDF loaded','ready');
  }catch(err){
    if(token!==undefined && token!==openPaperToken) return;
    setPdfStatus('Could not load saved PDF: '+err.message,'error');
  }
}
async function loadPdfFile(file){
  if(!library.activeId){ alert('Open a paper before uploading a PDF.'); return; }
  const myToken=openPaperToken; // uploads within the currently-open paper only
  $('#pdfFileName').textContent=file.name;
  const buf=await file.arrayBuffer();
  await loadPdfFromArrayBuffer(buf.slice(0), file.name, myToken);
  if(myToken!==openPaperToken) return;

  const paper=library.papers[library.activeId];
  setPdfStatus('Uploading to your account…','uploading');
  try{
    if(paper.pdfPath){
      await supaClient.storage.from(PDF_BUCKET).remove([paper.pdfPath]).catch(()=>{});
    }
    const path=await uploadPdfForPaper(library.activeId,file);
    if(myToken!==openPaperToken) return;
    paper.pdfPath=path;
    const {error}=await supaClient.from('papers').update({pdf_path:path,updated_at:new Date().toISOString()}).eq('id',library.activeId);
    if(error) throw error;
    setPdfStatus('PDF saved to your account','ready');
  }catch(err){
    if(myToken!==openPaperToken) return;
    setPdfStatus('PDF loaded here, but upload failed: '+err.message,'error');
  }
}
// Renders the current page's canvas AND a correctly-aligned pdf.js text layer.
// Canvas + text layer live inside a single relatively-positioned "page stack"
// sized exactly to the page, so absolute top:0/left:0 always lines up —
// regardless of the scroll container's padding/centering. The wrap is fully
// cleared before each render so no stale/overlapping text layer can remain.
async function renderPdfPage(){
  if(!pdfDoc||pdfRenderingLock) return;
  pdfRenderingLock=true;
  try{
    const page=await pdfDoc.getPage(pdfCurrentPage);
    const viewport=page.getViewport({scale:pdfScale});
    const wrap=$('#pdfCanvasWrap');
    wrap.innerHTML='';

    const stack=document.createElement('div');
    stack.className='pdf-page-stack'+(annotationMode?' annotation-active':'');
    stack.style.width=viewport.width+'px';
    stack.style.height=viewport.height+'px';
    wrap.appendChild(stack);

    const canvas=document.createElement('canvas');
    canvas.width=viewport.width; canvas.height=viewport.height;
    stack.appendChild(canvas);
    await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;

    const textContent=await page.getTextContent();
    const textLayer=document.createElement('div');
    textLayer.className='pdf-text-layer';
    textLayer.style.width=viewport.width+'px';
    textLayer.style.height=viewport.height+'px';
    stack.appendChild(textLayer);
    // Build a genuinely selectable text layer. PDF.js 3.x normally does this
    // itself; the fallback below keeps annotation working if the CDN/API changes.
    let textLayerReady=false;
    if(window.pdfjsLib && typeof pdfjsLib.renderTextLayer==='function'){
      try{
        const task=pdfjsLib.renderTextLayer({
          textContentSource:textContent,
          container:textLayer,
          viewport,
          textDivs:[],
          textContentItemsStr:[]
        });
        if(task && task.promise) await task.promise;
        textLayerReady=textLayer.childNodes.length>0;
      }catch(textLayerErr){
        console.warn('PDF.js text layer failed; using selectable fallback.',textLayerErr);
      }
    }
    if(!textLayerReady){
      // Fallback: position real DOM text over the PDF. It is intentionally almost
      // transparent in annotation mode, but remains native browser text so drag
      // selection works without depending on a PDF.js viewer stylesheet.
      const styles=await page.getTextContent();
      const Util=(window.pdfjsLib&&pdfjsLib.Util)?pdfjsLib.Util:null;
      for(const item of styles.items||[]){
        if(!item.str) continue;
        const span=document.createElement('span');
        span.textContent=item.str;
        span.style.position='absolute';
        span.style.whiteSpace='pre';
        span.style.transformOrigin='0 0';
        span.style.lineHeight='1';
        if(Util){
          const tx=Util.transform(viewport.transform,item.transform);
          const angle=Math.atan2(tx[1],tx[0]);
          const fontHeight=Math.hypot(tx[2],tx[3]);
          const left=tx[4];
          const top=tx[5]-fontHeight;
          span.style.left=left+'px';
          span.style.top=top+'px';
          span.style.fontSize=fontHeight+'px';
          span.style.transform=`rotate(${angle}rad)`;
        }
        textLayer.appendChild(span);
      }
      textLayerReady=textLayer.childNodes.length>0;
    }
    if(!textLayerReady) console.warn('This PDF page exposed no selectable text. It may be a scanned/image-only PDF.');
    $('#pdfPageInfo').textContent=`${pdfCurrentPage} / ${pdfDoc.numPages}`;
    $('#pdfZoomInfo').textContent=`${Math.round(pdfScale/1.15*100)}%`;
  }catch(err){
    $('#pdfCanvasWrap').innerHTML=`<p class="pdf-empty">Could not render this page: ${esc(err.message)}</p>`;
  }
  pdfRenderingLock=false;
}
function hideSelectionBar(){ $('#selectionBar').classList.remove('show'); pdfPendingSelection=null; }
let annotationMode=false;
$('#annotateMode').onclick=()=>{
  annotationMode=!annotationMode;
  const btn=$('#annotateMode');
  btn.classList.toggle('active',annotationMode);
  btn.textContent=annotationMode?'✦ Select text to annotate':'✦ Annotate';
  const stack=$('#pdfCanvasWrap .pdf-page-stack');
  if(stack) stack.classList.toggle('annotation-active',annotationMode);
  $('#pdfNote').textContent=annotationMode?'Annotation mode on: your cursor is now a text selector over the PDF. Drag across text, then choose where to link it and save.':"Your PDF is stored privately in your account's cloud storage — reopening this paper on any device will reload it automatically.";
};
document.addEventListener('selectionchange',()=>{
  const sel=window.getSelection();
  if(!sel||sel.isCollapsed||!sel.toString().trim()){ return; }
  const anchor=sel.anchorNode;
  const wrap=$('#pdfCanvasWrap');
  if(!anchor || !wrap || !wrap.contains(anchor)) return;
  const text=sel.toString().trim();
  if(!text) return;
  annotationMode=true;
  const annotateBtn=$('#annotateMode'); if(annotateBtn){ annotateBtn.classList.add('active'); annotateBtn.textContent='✦ Select text to annotate'; }
  pdfPendingSelection={text,page:pdfCurrentPage};
  $('#selectionSnippet').textContent=`“${text.length>140?text.slice(0,140)+'…':text}”`;
  $('#selectionBar').classList.add('show');
});
// Some browsers do not fire selectionchange reliably while dragging over an
// absolutely-positioned PDF text layer, so finalize selection on mouseup too.
$('#pdfCanvasWrap').addEventListener('mouseup',()=>{
  if(!annotationMode) return;
  setTimeout(()=>{
    const sel=window.getSelection();
    if(!sel||sel.isCollapsed) return;
    const wrap=$('#pdfCanvasWrap');
    const anchor=sel.anchorNode;
    const text=sel.toString().trim();
    if(!anchor||!wrap||!wrap.contains(anchor)||!text) return;
    pdfPendingSelection={text,page:pdfCurrentPage};
    $('#selectionSnippet').textContent=`“${text.length>140?text.slice(0,140)+'…':text}”`;
    $('#selectionBar').classList.add('show');
  },0);
});
$('#saveAnnotation').onclick=()=>{
  if(!pdfPendingSelection){ alert('Select some text in the PDF first.'); return; }
  const linkTo=$('#selectionLink').value;
  data.annotations=data.annotations||[];
  data.annotations.unshift({id:Date.now()+Math.random().toString(16).slice(2),text:pdfPendingSelection.text,page:pdfPendingSelection.page,linkTo,note:'',at:Date.now()});
  hideSelectionBar();
  $('#selectionLink').value='';
  window.getSelection().removeAllRanges();
  save('Annotation saved · syncing…');
};
function renderAnnotations(){
  const list=$('#annotationList'); if(!list) return;
  const anns=data.annotations||[];
  if(!anns.length){ list.innerHTML='<p class="annotation-empty">Annotations you save from the PDF will appear here, linked to the step or table you chose.</p>'; return; }
  list.innerHTML=anns.map(a=>`
    <div class="annotation-item" data-ann="${a.id}">
      <div class="meta"><span class="tag">${esc(annotationTargetLabel(a.linkTo))}</span><span>p.${a.page||'?'} · ${a.at?new Date(a.at).toLocaleDateString():''}</span></div>
      <blockquote>${esc(a.text)}</blockquote>
      <textarea class="note-input" data-ann-note="${a.id}" placeholder="Add your own comment on this excerpt…" rows="2">${esc(a.note||'')}</textarea>
      <div class="link-row">
        <select data-ann-link="${a.id}">
          <option value="" ${!a.linkTo?'selected':''}>Unlinked</option>
          <option value="note-s1" ${a.linkTo==='note-s1'?'selected':''}>Step 1</option>
          <option value="note-s2" ${a.linkTo==='note-s2'?'selected':''}>Step 2</option>
          <option value="note-s3" ${a.linkTo==='note-s3'?'selected':''}>Step 3</option>
          <option value="note-s4" ${a.linkTo==='note-s4'?'selected':''}>Step 4</option>
          <option value="note-s5" ${a.linkTo==='note-s5'?'selected':''}>Step 5</option>
          <option value="note-s6" ${a.linkTo==='note-s6'?'selected':''}>Step 6</option>
          <option value="note-s7" ${a.linkTo==='note-s7'?'selected':''}>Step 7</option>
          <option value="evidence" ${a.linkTo==='evidence'?'selected':''}>Evidence table</option>
          <option value="claim" ${a.linkTo==='claim'?'selected':''}>Claim matrix</option>
        </select>
        <button type="button" class="quiet-link" data-ann-insert="${a.id}">Insert into step ↳</button>
        <button type="button" class="delete" data-ann-delete="${a.id}">Delete</button>
      </div>
    </div>`).join('');
  list.querySelectorAll('[data-ann-note]').forEach(t=>t.onchange=()=>{
    const item=anns.find(x=>x.id===t.dataset.annNote); if(item){ item.note=t.value; save(); }
  });
  list.querySelectorAll('[data-ann-link]').forEach(sel=>sel.onchange=()=>{
    const item=anns.find(x=>x.id===sel.dataset.annLink); if(item){ item.linkTo=sel.value; save(); }
  });
  list.querySelectorAll('[data-ann-delete]').forEach(b=>b.onclick=()=>{
    data.annotations=anns.filter(x=>x.id!==b.dataset.annDelete); save();
  });
  list.querySelectorAll('[data-ann-insert]').forEach(b=>b.onclick=()=>{
    const item=anns.find(x=>x.id===b.dataset.annInsert); if(!item||!item.linkTo) { alert('Choose a step/table to link this annotation to first.'); return; }
    const quoted=`“${item.text}”${item.note?` — ${item.note}`:''} (p.${item.page||'?'})`;
    if(item.linkTo==='evidence'){
      $('#eConcern').value=$('#eConcern').value||'From annotation';
      $('#eEvidence').value=quoted; $('#eLocation').value=`p.${item.page||'?'}`;
      $('#eEvidence').focus();
    } else if(item.linkTo==='claim'){
      $('#cEvidence').value=quoted; $('#cEvidence').focus();
    } else {
      const ta=document.querySelector(`[data-note="${item.linkTo.replace('note-','')}"]`);
      if(ta){ ta.value=(ta.value?ta.value+'\n\n':'')+quoted; ta.dispatchEvent(new Event('input')); ta.focus(); }
    }
  });
}
$('#workspacePdf').onchange=e=>{ const f=e.target.files[0]; if(f) loadPdfFile(f); };
$('#modalPdf').onchange=e=>{ pendingPdfFile=e.target.files[0]||null; };
$('#pdfPrev').onclick=()=>{ if(pdfDoc&&pdfCurrentPage>1){ pdfCurrentPage--; renderPdfPage(); } };
$('#pdfNext').onclick=()=>{ if(pdfDoc&&pdfCurrentPage<pdfDoc.numPages){ pdfCurrentPage++; renderPdfPage(); } };
$('#pdfZoomIn').onclick=()=>{ if(pdfDoc){ pdfScale=Math.min(pdfScale*1.15,3); renderPdfPage(); } };
$('#pdfZoomOut').onclick=()=>{ if(pdfDoc){ pdfScale=Math.max(pdfScale/1.15,0.5); renderPdfPage(); } };

// ---- reading session logging (Stats) ----
let sessionStartedAt=null;
function resetTimerUI(){
  seconds=0; if(interval){ clearInterval(interval); interval=null; } paint();
  $('#timerButton').textContent='Start session';
  sessionStartedAt=null;
}
async function flushSession(){
  if(!sessionStartedAt||!currentUser||seconds<5){ sessionStartedAt=null; return; } // ignore accidental sub-5s taps
  const startedAt=sessionStartedAt, endedAt=new Date(), durationSeconds=seconds;
  sessionStartedAt=null;
  const {error}=await supaClient.from('reading_sessions').insert({
    user_id:currentUser.id, paper_id:library.activeId||null,
    started_at:startedAt.toISOString(), ended_at:endedAt.toISOString(), duration_seconds:durationSeconds
  });
  if(!error){ sessionsCache=[]; } // invalidate cache so Stats refetches next time it's opened
}
// Best-effort flush if the tab is closed/refreshed mid-session.
window.addEventListener('beforeunload',()=>{
  if(sessionStartedAt&&currentUser&&seconds>=5&&supaClient){
    try{
      const payload=JSON.stringify({user_id:currentUser.id,paper_id:library.activeId||null,started_at:sessionStartedAt.toISOString(),ended_at:new Date().toISOString(),duration_seconds:seconds});
      navigator.sendBeacon(`${SUPABASE_URL}/rest/v1/reading_sessions`, new Blob([payload],{type:'application/json'}));
    }catch(e){ /* best effort only */ }
  }
});

// ---- Supabase auth + data loading ---- 
function authRedirectUrl(){ 
  const protocol=window.location.protocol; 
  if(protocol==='http:'||protocol==='https:'){ 
    const url=new URL(window.location.href); 
    url.hash=''; 
    url.search=''; 
    return url.toString(); 
  } 
  return ''; 
} 
function showAuth(message=''){ 
  hideAllViews(); 
  $('#authView').hidden=false; 
  setNav(''); 
  $('#signInBtn').hidden=true; 
  if(message) $('#authStatus').textContent=message; 
  setTimeout(()=>$('#authEmail').focus(),0); 
} 
function requireAuth(nextView){ 
  if(currentUser) return true; 
  showAuth('Sign in to continue to your Paper Compass workspace.'); 
  return false; 
} 
function configured(){ return /^https?:\/\//.test(SUPABASE_URL) && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('REPLACE_'); } 
async function loadLibrary(){ 
  library={papers:{},activeId:null}; 
  const {data:rows,error}=await supaClient.from('papers').select('*').order('updated_at',{ascending:false}); 
  if(error){ console.error(error); return; } 
  rows.forEach(r=>{ library.papers[r.id]={id:r.id,title:r.title,citation:r.citation,authors:r.authors||'',journal:r.journal||'',year:r.year||'',pdfPath:r.pdf_path||null,createdAt:new Date(r.created_at).getTime(),updatedAt:new Date(r.updated_at).getTime(),data:{...blankData(),...r.data}}; }); 
} 
// Applies a session to app state WITHOUT touching navigation. Safe to call
// as often as Supabase likes (token refresh, tab refocus, etc.) — it only
// updates who the current user is, never redirects or reloads the library.
function applySessionUser(session){
  if(session&&session.user){
    currentUser=session.user;
    $('#userBadge').style.display='flex'; $('#userEmail').textContent=currentUser.email;
    $('#signInBtn').hidden=true;
  } else {
    currentUser=null;
    $('#userBadge').style.display='none';
    $('#signInBtn').hidden=false;
  }
}
async function boot(){ 
  hideAllViews(); 
  if(!configured()){ $('#configErrorView').hidden=false; return; } 
  supaClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY); 

  supaClient.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_IN'){
      const wasSignedOut=!currentUser;
      applySessionUser(session);
      if(wasSignedOut){
        setTimeout(async()=>{ await loadLibrary(); showHome(); },0);
      }
    } else if(event==='SIGNED_OUT'){
      applySessionUser(null);
      library={papers:{},activeId:null}; data=blankData(); sessionsCache=[];
      setTimeout(()=>showAuth('Sign in to access your saved papers and deep-reading workspace.'),0);
    } else {
      applySessionUser(session);
    }
  }); 

  const hash=window.location.hash; 
  const params=new URLSearchParams(hash.startsWith('#')?hash.slice(1):hash); 
  const authError=params.get('error_description')||params.get('error'); 
  if(authError){ 
    showAuth(`Sign-in link error: ${decodeURIComponent(authError.replace(/\+/g,' '))}`); 
    window.history.replaceState({},document.title,window.location.pathname+window.location.search); 
  } 

  const {data:{session}}=await supaClient.auth.getSession(); 
  applySessionUser(session);
  if(currentUser){
    await loadLibrary();
    showHome();
  } else if(!authError){
    showAuth('Sign in to access your saved papers and deep-reading workspace.');
  }
} 

// ---- wiring ---- 
$('#authForm').onsubmit=async e=>{ 
  e.preventDefault(); 
  const email=$('#authEmail').value.trim(), status=$('#authStatus'), btn=e.target.querySelector('button'); 
  btn.disabled=true; status.textContent='Sending magic link…'; 
  const redirectTo=authRedirectUrl(); 
  if(!redirectTo){ 
    btn.disabled=false; 
    status.textContent='This file is opened directly from disk. Host it on GitHub Pages (or use a local web server) before using magic-link login.'; 
    return; 
  } 
  const {error}=await supaClient.auth.signInWithOtp({email,options:{emailRedirectTo:redirectTo}}); 
  btn.disabled=false; 
  status.textContent=error?`Could not send link: ${error.message}`:'Check your email. The link will return you to this Paper Compass page.'; 
}; 
$('#signOutBtn').onclick=async()=>{ await flushSession(); await supaClient.auth.signOut(); }; 
$('#signInBtn').onclick=()=>showAuth(); 
$('#themeToggle').onclick=()=>{ const cur=document.documentElement.getAttribute('data-theme'); applyTheme(cur==='dark'?'light':'dark'); }; 

$('#newPaper').onclick=()=>showNewPaperView({},showLibrary); 
$('#startPaper').onclick=()=>showNewPaperView({},showHome); 
$('#exploreNew').onclick=()=>showNewPaperView({},showExplore); 
$('#methodStart').onclick=()=>showNewPaperView({},showMethod); 
$('#cancelNew').onclick=closeNewPaper; $('#backNewPaper').onclick=closeNewPaper; 
$('#lookupPaper').onclick=lookupPaper; 
$('#newPaperForm').onsubmit=async e=>{
  e.preventDefault();
  if(!$('#modalTitle').value.trim()){$('#lookupStatus').textContent='Add a title, or look up a DOI/PDF first.';return;}
  await createPaper({
    title:$('#modalTitle').value, authors:$('#modalAuthors').value, journal:$('#modalJournal').value,
    year:$('#modalYear').value, citation:$('#modalCitation').value
  }, $('#modalExplore').checked);
}; 
$('#exploreSearch').onsubmit=e=>{e.preventDefault();searchExplore($('#exploreQuery').value.trim());}; 
$('#backToLibrary').onclick=async()=>{ await flushSession(); currentUser?showLibrary():showAuth(); }; 
$('#browsePapers').onclick=showLibrary; $('#learnMethod').onclick=showMethod; 
$('#navHome').onclick=showHome; $('#navExplore').onclick=showExplore; $('#navMethod').onclick=showMethod; 
$('#navStats').onclick=showStats; $('#goStats').onclick=showStats; 
$('#importLocal').onclick=importLegacyLocal; 

fields().forEach(x=>{ x.addEventListener('input',()=>save()); x.addEventListener('change',()=>save()); }); 
function recordMilestone(label){readFields();const snapshot=structuredClone({...data,history:[]});data.history.unshift({at:Date.now(),label,snapshot});} 
$('#lockVerdict').onclick=()=>{const v=document.querySelector('[data-note="s5"]').value.trim();if(!v){alert('Write your independent conclusion before locking it.');return;}data.verdictLocked=true;recordMilestone('Step 5 locked — independent verdict recorded');save('Blind verdict locked · syncing…');}; 
$('#addEvidence').onclick=()=>{const concern=$('#eConcern').value.trim(), evidence=$('#eEvidence').value.trim();if(!concern||!evidence){alert('Add both a concern and the evidence supporting it.');return;}data.evidence.unshift({concern,evidence,location:$('#eLocation').value.trim(),severity:$('#eSeverity').value});['eConcern','eEvidence','eLocation'].forEach(id=>$('#'+id).value='');save();}; 
$('#addClaim').onclick=()=>{const claim=$('#cClaim').value.trim();if(!claim){alert('Add an author claim first.');return;}data.claims.unshift({claim,evidence:$('#cEvidence').value.trim(),assessment:$('#cAssessment').value,strength:$('#cStrength').value});['cClaim','cEvidence'].forEach(id=>$('#'+id).value='');save();}; 
$('#snapshot').onclick=()=>{recordMilestone(`Revision recorded — ${data.evidence.length} evidence item(s), ${data.claims.length} claim(s)`);save('Revision recorded');}; 
$('#backup').onclick=()=>{readFields();const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='paper-compass-backup.json';a.click();URL.revokeObjectURL(a.href);}; 

let seconds=0, interval; const clock=$('#clock'), timer=$('#timerButton');
function paint(){const h=String(Math.floor(seconds/3600)).padStart(2,'0'),m=String(Math.floor(seconds%3600/60)).padStart(2,'0'),s=String(seconds%60).padStart(2,'0');clock.textContent=`${h}:${m}:${s}`;}
timer.onclick=async()=>{
  if(interval){
    clearInterval(interval); interval=null; timer.textContent='Resume session';
    await flushSession(); // logs this session chunk; resuming later starts a fresh logged session
  } else {
    if(!sessionStartedAt) sessionStartedAt=new Date();
    interval=setInterval(()=>{seconds++;paint()},1000);
    timer.textContent='Pause session';
  }
};

$('#clear').onclick=()=>{if(confirm('Clear this paper from your account? This deletes it from the cloud too.')){deletePaper(library.activeId).then(()=>showLibrary());}}; 

function buildReviewModel(){
  readFields();
  const f=data.fields;
  const stepNames=['Broad overview','Core question','Knowledge gap','Methods & power','My conclusion','Reconciled conclusion','Confounders & limits'];
  const steps=stepNames.map((n,i)=>({n,text:f['note-s'+(i+1)]||''}));
  return { f, steps, evidence:data.evidence, claims:data.claims, annotations:data.annotations||[], profile:data.profile||{} };
}
$('#exportTxt').onclick=()=>{
  const {f,steps,evidence,claims,annotations}=buildReviewModel();
  const stepsText=steps.map((s,i)=>`${i+1}. ${s.n}\n${s.text||'(No notes)'}\n`).join('\n');
  const evidenceText=evidence.map(x=>`• ${x.concern}: ${x.evidence} (${x.location}; ${x.severity})`).join('\n');
  const claimsText=claims.map(x=>`• ${x.claim} | ${x.evidence} | ${x.assessment} (${x.strength})`).join('\n');
  const annotationsText=annotations.map(a=>`• [${annotationTargetLabel(a.linkTo)} · p.${a.page||'?'}] "${a.text}"${a.note?` — ${a.note}`:''}`).join('\n');
  const metaLine=[f.authors,f.journal,f.year].filter(Boolean).join(' · ');
  const content=`PAPER COMPASS REVIEW\n${f.title||'Untitled paper'}\n${metaLine}\n${f.citation||''}\n\n${stepsText}\nEVIDENCE\n${evidenceText}\n\nCLAIM MATRIX\n${claimsText}\n\nPDF ANNOTATIONS\n${annotationsText}\n\nWHAT WOULD CHANGE MY MIND\n${f.changeMind||'(No notes)'}`;
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type:'text/plain'})); a.download='paper-compass-review.txt'; a.click(); URL.revokeObjectURL(a.href);
};
function mdEscapeCell(v){ return String(v||'—').replace(/\|/g,'\\|').replace(/\n/g,' '); }
$('#exportMd').onclick=()=>{
  const {f,steps,evidence,claims,annotations,profile}=buildReviewModel();
  const metaLine=[f.authors,f.journal,f.year].filter(Boolean).join(' · ');
  let md=`# ${f.title||'Untitled paper'}\n\n`;
  if(metaLine) md+=`\*${metaLine}\*\n\n`;
  if(f.citation) md+=`\*\*Citation:\*\* ${f.citation}\n\n`;
  if(f.labels) md+=`\*\*Labels:\*\* ${f.labels}\n\n`;
  md+=`---\n\n## Seven-step review\n\n`;
  steps.forEach((s,i)=>{
    md+=`### ${i+1}. ${s.n}\n\n${s.text?s.text.trim():'\*No notes.\*'}\n\n`;
  });
  md+=`---\n\n## Evidence log\n\n`;
  if(evidence.length){
    md+=`| Concern | Evidence | Location | Severity |\n|---|---|---|---|\n`;
    evidence.forEach(x=>{ md+=`| ${mdEscapeCell(x.concern)} | ${mdEscapeCell(x.evidence)} | ${mdEscapeCell(x.location)} | ${mdEscapeCell(x.severity)} |\n`; });
  } else { md+=`\*No evidence recorded.\*\n`; }
  md+=`\n## Claim → evidence matrix\n\n`;
  if(claims.length){
    md+=`| Author's claim | Evidence presented | Assessment | Strength |\n|---|---|---|---|\n`;
    claims.forEach(x=>{ md+=`| ${mdEscapeCell(x.claim)} | ${mdEscapeCell(x.evidence)} | ${mdEscapeCell(x.assessment)} | ${mdEscapeCell(x.strength)} |\n`; });
  } else { md+=`\*No claims assessed.\*\n`; }
  md+=`\n## PDF annotations\n\n`;
  if(annotations.length){
    annotations.forEach(a=>{
      md+=`- \*\*${annotationTargetLabel(a.linkTo)}\*\* (p.${a.page||'?'}): "${a.text}"${a.note?`\n  - \*Comment:\* ${a.note}`:''}\n`;
    });
  } else { md+=`\*No annotations saved.\*\n`; }
  md+=`\n## Confidence profile\n\n`;
  const assessed=Object.entries(profile).filter(([,v])=>v&&v!=='Unassessed');
  if(assessed.length){
    md+=`| Dimension | Assessment |\n|---|---|\n`;
    assessed.forEach(([k,v])=>{ md+=`| ${mdEscapeCell(k)} | ${mdEscapeCell(v)} |\n`; });
  } else { md+=`\*Not yet assessed.\*\n`; }
  md+=`\n## What would change my mind\n\n${f.changeMind?f.changeMind.trim():'\*No notes.\*'}\n\n`;
  md+=`## Red team\n\n${data.redTeam?data.redTeam.trim():(f.redTeam?f.redTeam.trim():'\*No notes.\*')}\n`;
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([md],{type:'text/markdown'})); a.download='paper-compass-review.md'; a.click(); URL.revokeObjectURL(a.href);
};

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
  const totalDays=371; // \~53 weeks, GitHub-style
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
