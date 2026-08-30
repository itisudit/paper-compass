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
