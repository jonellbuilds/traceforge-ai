import {getSupabase,onAuthChange} from '/modules/supabase-client.js';
import {loadLiveWorkspace,createLiveApiKey,updateProjectSettings} from '/modules/live-data.js';
import {bucketize} from '/modules/demo-data.js';
import {detect} from '/modules/anomaly.js';

const app=document.querySelector('#app');
const money=n=>`$${Number(n||0).toFixed(Number(n||0)<1?4:2)}`;
const num=n=>Intl.NumberFormat('en-US',{notation:Number(n)>9999?'compact':'standard',maximumFractionDigits:1}).format(Number(n||0));
const pct=n=>`${(Number(n||0)*100).toFixed(1)}%`;

let live={loading:true,error:null,session:null,project:null,traces:[],message:null};

function frame(body){
  app.innerHTML=`<div class="landing">
    <header class="top">
      <a class="brand" href="/"><span class="mark">⌁</span>TraceForge AI</a>
      <span class="mono muted">LIVE WORKSPACE</span>
    </header>
    <main class="hero" style="padding-top:48px">${body}</main>
    <footer class="footer">TraceForge AI · authenticated Supabase workspace</footer>
  </div>`;
}

function loading(message='Loading live workspace…'){
  frame(`<div class="card panel"><h2>${message}</h2><p class="muted">Connecting to Supabase securely with your publishable key and authenticated session.</p></div>`);
}

function errorView(message){
  frame(`<div class="card panel"><h2>Live workspace unavailable</h2><p class="muted">${message}</p><div class="actions"><a class="btn" href="/">Return to demo</a><button class="btn primary" id="retry">Retry</button></div></div>`);
  document.querySelector('#retry')?.addEventListener('click',boot);
}

function authView(){
  frame(`<div class="title"><div class="eyebrow mono">Real Supabase authentication</div><h1 style="font-size:clamp(38px,6vw,68px)">Sign in to your <span class="grad">live workspace.</span></h1><p class="muted">Your session uses Supabase Auth. RLS limits reads and writes to workspaces you belong to.</p></div>
  <div class="split" style="margin-top:28px">
    <section class="card panel">
      <h3>Sign in</h3>
      <label class="muted">Email</label>
      <input class="input" id="email" type="email" autocomplete="email" placeholder="you@example.com" style="width:100%;margin:8px 0 12px">
      <label class="muted">Password</label>
      <input class="input" id="password" type="password" autocomplete="current-password" placeholder="••••••••" style="width:100%;margin:8px 0 14px">
      <div class="actions" style="margin-top:0">
        <button class="btn primary" id="signin">Sign in</button>
        <button class="btn" id="signup">Create account</button>
      </div>
      <div id="auth-msg" class="muted" style="margin-top:14px"></div>
    </section>
    <section class="card panel">
      <h3>Security model</h3>
      <p class="muted">The browser only receives a publishable key. Privileged ingestion uses a server-only secret key, and table access is enforced by Postgres RLS.</p>
      <div class="notice">The built-in public demo remains synthetic. Live data only appears here after authentication.</div>
    </section>
  </div>`);

  const run=async(mode)=>{
    const message=document.querySelector('#auth-msg');
    const email=document.querySelector('#email').value.trim();
    const password=document.querySelector('#password').value;
    if(!email||password.length<6){message.textContent='Enter a valid email and a password of at least 6 characters.';return;}
    message.textContent=mode==='signup'?'Creating account…':'Signing in…';
    const supabase=await getSupabase();
    if(!supabase){message.textContent='Supabase is not configured yet.';return;}
    const result=mode==='signup'
      ? await supabase.auth.signUp({email,password})
      : await supabase.auth.signInWithPassword({email,password});
    if(result.error){message.textContent=result.error.message;return;}
    if(mode==='signup'&&!result.data.session){
      message.textContent='Account created. Check your email to confirm it, then sign in.';
      return;
    }
    await openWorkspace();
  };
  document.querySelector('#signin').onclick=()=>run('signin');
  document.querySelector('#signup').onclick=()=>run('signup');
}

function traceTable(rows){
  if(!rows.length) return '<p class="muted">No traces yet. Generate synthetic telemetry or ingest your first real request.</p>';
  return `<div class="tablewrap"><table class="table"><thead><tr><th>Time</th><th>Provider / model</th><th>Status</th><th>Latency</th><th>Tokens</th><th>Cost</th><th>Environment</th></tr></thead><tbody>${rows.slice(-20).reverse().map(t=>`<tr><td>${new Date(t.ts).toLocaleString()}</td><td>${t.provider}<div class="muted">${t.model}</div></td><td><span class="pill ${t.status==='success'?'ok':'err'}">${t.status}</span></td><td>${t.latency} ms</td><td>${num(t.input+t.output)}</td><td>${money(t.cost)}</td><td>${t.environment}</td></tr>`).join('')}</tbody></table></div>`;
}

function workspaceView(){
  const traces=live.traces;
  const series=bucketize(traces);
  const anomalies=detect(series);
  const errors=traces.filter(t=>t.status==='error').length;
  const latency=[...traces].map(t=>t.latency).sort((a,b)=>a-b);
  const p95=latency.length?latency[Math.min(latency.length-1,Math.floor(latency.length*.95))]:0;
  const tokens=traces.reduce((s,t)=>s+t.input+t.output,0);
  const cost=traces.reduce((s,t)=>s+t.cost,0);

  frame(`<div class="appbar" style="position:static;border:1px solid var(--line);border-radius:12px;margin-bottom:18px">
    <div><b>${live.project.name}</b> <span class="mono muted">/ live</span></div>
    <div class="actions" style="margin:0"><button class="btn" id="refresh">Refresh</button><button class="btn" id="signout">Sign out</button></div>
  </div>
  ${live.message?`<div class="notice">${live.message}</div>`:''}
  <div class="title"><div class="eyebrow mono">Authenticated production workspace</div><h1 style="font-size:clamp(36px,5vw,58px)">Live telemetry</h1><p class="muted">Data below is read from your Supabase project and protected by RLS.</p></div>
  <div class="kpis">${[
    ['Requests',num(traces.length)],
    ['Success rate',traces.length?pct(1-errors/traces.length):'—'],
    ['p95 latency',traces.length?`${p95} ms`:'—'],
    ['Tokens',num(tokens)],
    ['Est. cost',money(cost)],
    ['Anomalies',anomalies.length]
  ].map(([l,v])=>`<div class="card kpi"><div class="label">${l}</div><div class="val">${v}</div></div>`).join('')}</div>
  <div class="grid2" style="margin-top:14px">
    <section class="card panel">
      <h3>Project controls</h3>
      <div class="switch"><div><b>Retention</b><div class="muted">Persisted in Supabase.</div></div>
        <select class="select" id="retention"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select>
      </div>
      <div class="actions"><button class="btn" id="save-settings">Save settings</button><button class="btn" id="generate-demo">Generate synthetic telemetry</button></div>
    </section>
    <section class="card panel">
      <h3>API ingestion</h3>
      <p class="muted">Create a project-scoped key. Plaintext is displayed once and only the hash remains in Postgres.</p>
      <div class="actions"><button class="btn primary" id="create-key">Create API key</button></div>
      <div id="key-output" style="margin-top:12px"></div>
    </section>
  </div>
  <section class="card panel" style="margin-top:14px"><h3>Recent traces</h3>${traceTable(traces)}</section>`);

  document.querySelector('#retention').value=String(live.project.retention_days||30);
  document.querySelector('#refresh').onclick=openWorkspace;
  document.querySelector('#signout').onclick=async()=>{const supabase=await getSupabase();await supabase?.auth.signOut();live={loading:false,error:null,session:null,project:null,traces:[],message:null};authView();};
  document.querySelector('#save-settings').onclick=async()=>{
    const retention_days=Number(document.querySelector('#retention').value);
    try{
      live.project=await updateProjectSettings(live.project.id,{retention_days});
      live.message='Project settings saved.';
      workspaceView();
    }catch(error){live.message=error.message;workspaceView();}
  };
  document.querySelector('#create-key').onclick=async()=>{
    const output=document.querySelector('#key-output');
    output.innerHTML='<span class="muted">Creating key…</span>';
    try{
      const key=await createLiveApiKey(live.project.id,'Web ingestion key');
      output.innerHTML=`<div class="code">${key.api_key}</div><p class="notice">Copy this key now. It will not be shown again.</p>`;
    }catch(error){output.innerHTML=`<p class="muted">${error.message}</p>`;}
  };
  document.querySelector('#generate-demo').onclick=async()=>{
    live.message='Generating clearly labeled synthetic telemetry…';
    workspaceView();
    try{
      const supabase=await getSupabase();
      const {error}=await supabase.rpc('generate_demo_telemetry',{_project:live.project.id,_days:3});
      if(error) throw error;
      await openWorkspace('Synthetic telemetry generated in your live project. Every generated row is flagged is_synthetic=true.');
    }catch(error){live.message=error.message;workspaceView();}
  };
}

async function openWorkspace(message=null){
  loading();
  try{
    const data=await loadLiveWorkspace();
    live={loading:false,error:null,...data,message};
    workspaceView();
  }catch(error){
    live.error=error.message;
    if(/sign in/i.test(error.message)) authView();
    else errorView(error.message);
  }
}

async function boot(){
  loading('Checking production configuration…');
  try{
    const supabase=await getSupabase();
    if(!supabase){errorView('Supabase has not been connected to this deployment yet. The synthetic demo is still available from the landing page.');return;}
    const {data,error}=await supabase.auth.getSession();
    if(error) throw error;
    if(data.session) await openWorkspace();
    else authView();
  }catch(error){errorView(error.message);}
}

onAuthChange(session=>{if(session&&!live.session)openWorkspace();});
boot();
