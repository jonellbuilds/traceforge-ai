import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,join,normalize} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=join(fileURLToPath(new URL('.',import.meta.url)),'public');
const port=Number(process.env.PORT||3000);
const type={
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.svg':'image/svg+xml',
  '.json':'application/json; charset=utf-8'
};
const send=(res,code,body,headers={})=>{
  res.writeHead(code,{'content-type':'application/json; charset=utf-8',...headers});
  res.end(typeof body==='string'?body:JSON.stringify(body));
};
async function ingest(req,res){
  if(req.method!=='POST') return send(res,405,{error:'method_not_allowed'});
  const key=(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!key) return send(res,401,{error:'missing_api_key'});
  let raw='';
  for await(const c of req) raw+=c;
  if(raw.length>250_000)return send(res,413,{error:'payload_too_large'});
  let body;
  try{body=JSON.parse(raw)}catch{return send(res,400,{error:'invalid_json'})}
  for(const k of ['provider','model','status','latency_ms']){
    if(body[k]===undefined)return send(res,400,{error:'validation_error',field:k});
  }
  if(!['success','error'].includes(body.status)||!Number.isFinite(Number(body.latency_ms))){
    return send(res,400,{error:'validation_error'});
  }
  const url=process.env.SUPABASE_URL;
  const anon=process.env.SUPABASE_ANON_KEY;
  if(!url||!anon)return send(res,503,{error:'supabase_not_configured'});
  const r=await fetch(`${url}/rest/v1/rpc/ingest_trace`,{
    method:'POST',
    headers:{'content-type':'application/json',apikey:anon,authorization:`Bearer ${anon}`},
    body:JSON.stringify({_api_key:key,_payload:body})
  });
  const data=await r.json().catch(()=>({error:'upstream_error'}));
  return send(res,r.ok?200:r.status,data);
}
const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost');
    if(u.pathname==='/health'){
      return send(res,200,{ok:true,service:'traceforge-ai',time:new Date().toISOString()});
    }
    if(u.pathname==='/api/v1/traces')return ingest(req,res);
    let p=u.pathname==='/'?'/index.html':u.pathname;
    p=normalize(p).replace(/^\.\.(\/|\\)/,'');
    const fp=join(root,p);
    try{
      const data=await readFile(fp);
      res.writeHead(200,{
        'content-type':type[extname(fp)]||'application/octet-stream',
        'cache-control':extname(fp)==='.html'?'no-store':'public, max-age=3600'
      });
      res.end(data);
    }catch{
      const data=await readFile(join(root,'index.html'));
      res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
      res.end(data);
    }
  }catch{
    send(res,500,{error:'internal_error'});
  }
});
server.listen(port,()=>console.log(`TraceForge AI on http://localhost:${port}`));
