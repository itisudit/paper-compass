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
