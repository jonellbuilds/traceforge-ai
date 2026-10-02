function rng(seed=1337){let s=seed>>>0;return()=>((s=(s*1664525+1013904223)>>>0)/4294967296)}
export function makeDemo(seed=1337,count=260){
  const r=rng(seed);
  const models=[['OpenAI','gpt-5-mini'],['Anthropic','claude-sonnet'],['Google','gemini-flash']];
  const traces=[]; const now=Date.now();
  for(let i=0;i<count;i++){
    const [provider,model]=models[Math.floor(r()*models.length)];
    const spike=i>155&&i<170;
    const errorBurst=i>210&&i<220;
    const input=Math.round(450+r()*1100+(spike?1800:0));
    const output=Math.round(120+r()*500);
    const latency=Math.round(380+r()*900+(spike?2200:0));
    const error=errorBurst&&r()>.35;
    const cost=+(((input+output)/1e6)*(provider==='Anthropic'?5.2:provider==='OpenAI'?3.5:1.2)).toFixed(6);
    const ts=new Date(now-(count-i)*4*60_000).toISOString();
    const id=`tr_${(seed+i).toString(16).padStart(8,'0')}`;
    traces.push({
      id,traceId:id,ts,provider,model,status:error?'error':'success',latency,input,output,cost,
      environment:i%9===0?'staging':'production',
      route:['/chat','/summarize','/agent/run'][i%3],
      tags:error?['retry','upstream']:['primary'],
      metadata:{synthetic:true,region:['blr','sin','fra'][i%3],cache_hit:r()>.72},
      spans:[
        {name:'prompt.build',duration:Math.round(18+r()*35)},
        {name:'llm.call',duration:Math.round(latency*.88)},
        {name:'postprocess',duration:Math.round(20+r()*60)}
      ]
    });
  }
  return traces;
}
export function bucketize(traces){
  const m=new Map();
  for(const t of traces){
    const d=new Date(t.ts);d.setMinutes(0,0,0);
    const k=d.toISOString();
    if(!m.has(k))m.set(k,[]);
    m.get(k).push(t);
  }
  return [...m].map(([bucket,a])=>{
    const l=a.map(x=>x.latency).sort((x,y)=>x-y);
    const p95=l[Math.min(l.length-1,Math.floor(l.length*.95))]||0;
    return {
      bucket,
      requests:a.length,
      latency:p95,
      errors:a.filter(x=>x.status==='error').length/a.length,
      tokens:a.reduce((s,x)=>s+x.input+x.output,0)/a.length,
      cost:a.reduce((s,x)=>s+x.cost,0)
    };
  }).sort((a,b)=>a.bucket.localeCompare(b.bucket));
}
