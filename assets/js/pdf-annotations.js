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
