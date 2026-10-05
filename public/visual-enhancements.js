const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function ensureAmbient(){
  if(document.querySelector('.ambient-layer')) return;
  const layer=document.createElement('div');
  layer.className='ambient-layer';
  layer.innerHTML='<span class="orb orb-a"></span><span class="orb orb-b"></span><span class="orb orb-c"></span><span class="noise"></span>';
  document.body.prepend(layer);
}
function attachCardGlow(){
  document.querySelectorAll('.card,.btn,.appbar').forEach(el=>{
    if(el.dataset.fxBound) return;
    el.dataset.fxBound='1';
    el.addEventListener('pointermove',e=>{
      const r=el.getBoundingClientRect();
      el.style.setProperty('--mx',`${e.clientX-r.left}px`);
      el.style.setProperty('--my',`${e.clientY-r.top}px`);
    });
  });
}
function ensureHeroVisual(){
  const hero=document.querySelector('.hero');
  if(!hero || hero.querySelector('.hero-visual-shell')) return;
  const shell=document.createElement('section');
  shell.className='hero-visual-shell';
  shell.innerHTML=`
    <div class="hero-visual-head"><span class="status-dot"></span><span>traceforge://live-signal</span><span class="hero-chip">MAD + robust z-score</span></div>
    <div class="hero-visual-body">
      <canvas class="trace-canvas" aria-hidden="true"></canvas>
      <div class="signal-column">
        <div class="signal-card signal-card-primary">
          <div class="signal-row"><span>p95 latency</span><b>842 ms</b></div>
          <div class="signal-spark"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
          <small>baseline 491 ms · z 6.42</small>
        </div>
        <div class="mini-grid">
          <div class="signal-card"><small>SUCCESS RATE</small><b>98.7%</b><span class="trend positive">+0.8%</span></div>
          <div class="signal-card"><small>EST. COST</small><b>$14.82</b><span class="trend">24h</span></div>
        </div>
        <div class="trace-stream">
          <div><span class="provider-dot openai"></span><b>gpt-5-mini</b><em>620ms</em></div>
          <div><span class="provider-dot anthropic"></span><b>claude-sonnet</b><em>781ms</em></div>
          <div class="trace-alert"><span class="provider-dot google"></span><b>gemini-flash</b><em>2.8s</em></div>
        </div>
      </div>
    </div>`;
  hero.appendChild(shell);
  startTraceCanvas(shell.querySelector('.trace-canvas'));
}
function startTraceCanvas(canvas){
  if(!canvas || reduceMotion || canvas.dataset.started) return;
  canvas.dataset.started='1';
  const ctx=canvas.getContext('2d'); let raf; let nodes=[];
  const resize=()=>{
    const r=canvas.getBoundingClientRect(); const dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.max(1,Math.floor(r.width*dpr)); canvas.height=Math.max(1,Math.floor(r.height*dpr));
    ctx.setTransform(dpr,0,0,dpr,0,0);
    nodes=Array.from({length:28},(_,i)=>({x:Math.random()*r.width,y:Math.random()*r.height,vx:(Math.random()-.5)*.18,vy:(Math.random()-.5)*.18,phase:Math.random()*Math.PI*2,hot:i%9===0}));
  };
  resize(); new ResizeObserver(resize).observe(canvas);
  const draw=(t)=>{
    const w=canvas.clientWidth,h=canvas.clientHeight; ctx.clearRect(0,0,w,h);
    for(const n of nodes){n.x+=n.vx;n.y+=n.vy;if(n.x<0||n.x>w)n.vx*=-1;if(n.y<0||n.y>h)n.vy*=-1}
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],dx=a.x-b.x,dy=a.y-b.y,d=Math.hypot(dx,dy);if(d<110){ctx.globalAlpha=(1-d/110)*.22;ctx.strokeStyle='#5ee7f3';ctx.lineWidth=.7;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}}
    ctx.globalAlpha=1;
    for(const n of nodes){const pulse=1.8+Math.sin(t/800+n.phase)*.7;ctx.fillStyle=n.hot?'#a786ff':'#5ee7f3';ctx.globalAlpha=n.hot?.95:.68;ctx.beginPath();ctx.arc(n.x,n.y,n.hot?pulse+1:pulse,0,Math.PI*2);ctx.fill()}
    ctx.globalAlpha=1; raf=requestAnimationFrame(draw);
  };
  raf=requestAnimationFrame(draw);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelAnimationFrame(raf);else raf=requestAnimationFrame(draw)});
}
function animateBars(){
  document.querySelectorAll('.bar').forEach((bar,i)=>{if(bar.dataset.animated)return;bar.dataset.animated='1';bar.animate([{transform:'scaleY(.05)',opacity:.2},{transform:'scaleY(1)',opacity:.88}],{duration:520+Math.min(i,30)*18,easing:'cubic-bezier(.22,.8,.22,1)',fill:'both'})});
}
function enhanceLive(){
  const liveTitle=[...document.querySelectorAll('.eyebrow')].find(x=>/production workspace|real supabase|live/i.test(x.textContent||''));
  if(!liveTitle || document.querySelector('.live-signal-strip')) return;
  const strip=document.createElement('div'); strip.className='live-signal-strip';
  strip.innerHTML='<span><i class="pulse-dot"></i> Supabase connected</span><span>RLS protected</span><span>serverless ingestion</span><span>encrypted API keys</span>';
  liveTitle.parentElement?.insertBefore(strip,liveTitle.nextSibling);
}
function runEnhancements(){ensureAmbient();ensureHeroVisual();enhanceLive();attachCardGlow();animateBars()}
new MutationObserver(()=>requestAnimationFrame(runEnhancements)).observe(document.body,{childList:true,subtree:true});
runEnhancements();
