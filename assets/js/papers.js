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
