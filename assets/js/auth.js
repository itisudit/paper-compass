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
