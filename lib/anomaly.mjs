export const median = (xs) => {
  if (!xs.length) return NaN;
  const a=[...xs].sort((x,y)=>x-y); const m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
};
export const mad=(xs,med=median(xs))=>median(xs.map(x=>Math.abs(x-med)));
export function robustZ(x, baseline, floor=1){
  const med=median(baseline); const sigma=Math.max(1.4826*mad(baseline,med),floor);
  return {z:(x-med)/sigma,median:med};
}
const specs={
  latency:{label:'p95 latency',floor:m=>Math.max(m*.1,25),significant:(o,m)=>o>=m*1.8},
  errors:{label:'error rate',floor:m=>Math.max(m*.5,.02),significant:(o,m)=>o>=m+.15},
  tokens:{label:'tokens/request',floor:m=>Math.max(m*.1,20),significant:(o,m)=>o>=m*1.8},
  cost:{label:'hourly cost',floor:m=>Math.max(m*.1,.002),significant:(o,m)=>o>=m*1.8}
};
export function detect(series,{window=12,threshold=3.5}={}){
  const out=[];
  for(const metric of Object.keys(specs)){
    const spec=specs[metric];
    for(let i=window;i<series.length;i++){
      const base=series.slice(i-window,i).map(p=>p[metric]).filter(Number.isFinite);
      const x=series[i][metric];
      if(base.length<Math.ceil(window/2)||!Number.isFinite(x)) continue;
      const {z,median:med}=robustZ(x,base,spec.floor(median(base)));
      if(z>=threshold&&spec.significant(x,med)) out.push({
        metric,
        score:+z.toFixed(2),
        observed:x,
        baseline:med,
        bucket:series[i].bucket,
        severity:z>=8?'critical':z>=6?'high':z>=4.5?'medium':'low',
        reason:`${spec.label} deviated sharply from its rolling median baseline.`
      });
    }
  }
  return out.sort((a,b)=>b.score-a.score);
}
