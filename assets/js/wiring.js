// ---- wiring ---- 
$('#authForm').onsubmit=async e=>{ 
  e.preventDefault(); 
  const email=$('#authEmail').value.trim(), status=$('#authStatus'), btn=e.target.querySelector('button'); 
  btn.disabled=true; status.textContent='Sending magic link…'; 
  const redirectTo=authRedirectUrl(); 
  if(!redirectTo){ 
    btn.disabled=false; 
    status.textContent='This file is opened directly from disk. Host the site on your preferred web host (or use a local web server) before using magic-link login.'; 
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
