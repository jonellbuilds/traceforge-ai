import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,join,normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ingestTrace} from './lib/ingest.mjs';

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
async function readJson(req){
  let raw='';
  for await(const chunk of req){
    raw+=chunk;
    if(raw.length>250_000) throw new Error('payload_too_large');
  }
  return raw?JSON.parse(raw):{};
}
const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost');
    if(u.pathname==='/health'||u.pathname==='/api/health'){
      return send(res,200,{ok:true,service:'traceforge-ai',time:new Date().toISOString()});
    }
    if(u.pathname==='/api/config'){
      const url=process.env.SUPABASE_URL||'';
      const publishableKey=process.env.SUPABASE_PUBLISHABLE_KEY||'';
      return send(res,200,{configured:Boolean(url&&publishableKey),url,publishableKey},{'cache-control':'no-store'});
    }
    if(u.pathname==='/api/v1/traces'){
      if(req.method!=='POST') return send(res,405,{error:'method_not_allowed'});
      let payload;
      try{payload=await readJson(req)}catch(error){
        return send(res,error.message==='payload_too_large'?413:400,{error:error.message==='payload_too_large'?'payload_too_large':'invalid_json'});
      }
      const result=await ingestTrace({
        authorization:req.headers.authorization,
        payload,
        env:process.env
      });
      return send(res,result.status,result.body);
    }
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
  }catch(error){
    console.error(error);
    send(res,500,{error:'internal_error'});
  }
});
server.listen(port,()=>console.log(`TraceForge AI on http://localhost:${port}`));
