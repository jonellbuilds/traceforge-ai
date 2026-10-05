import { createHash, randomUUID } from 'node:crypto';

const jsonHeaders={'content-type':'application/json'};

function fail(status,error,extra={}){return {status,body:{error,...extra}}}

export function validateTrace(payload){
  if(!payload||typeof payload!=='object') return fail(400,'validation_error',{message:'JSON object required'});
  for(const field of ['provider','model','status','latency_ms']){
    if(payload[field]===undefined||payload[field]===null||payload[field]===''){
      return fail(400,'validation_error',{field});
    }
  }
  if(!['success','error'].includes(payload.status)) return fail(400,'validation_error',{field:'status'});
  const latency=Number(payload.latency_ms);
  if(!Number.isFinite(latency)||latency<0) return fail(400,'validation_error',{field:'latency_ms'});
  for(const field of ['input_tokens','output_tokens','cost_usd']){
    if(payload[field]!==undefined&&!Number.isFinite(Number(payload[field]))) return fail(400,'validation_error',{field});
  }
  if(Array.isArray(payload.spans)&&payload.spans.length>100) return fail(400,'validation_error',{field:'spans',message:'max 100 spans'});
  return null;
}

async function supabaseFetch(url,secret,path,options={}){
  return fetch(`${url}/rest/v1/${path}`,{
    ...options,
    headers:{
      apikey:secret,
      authorization:`Bearer ${secret}`,
      ...jsonHeaders,
      ...(options.headers||{})
    }
  });
}

export async function ingestTrace({authorization,payload,env=process.env}){
  const validation=validateTrace(payload);
  if(validation) return validation;

  const apiKey=(authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!apiKey) return fail(401,'missing_api_key');

  const url=env.SUPABASE_URL;
  const secret=env.SUPABASE_SECRET_KEY;
  if(!url||!secret) return fail(503,'supabase_not_configured');

  const hash=createHash('sha256').update(apiKey).digest('hex');
  const keyQuery=new URLSearchParams({
    select:'id,project_id',
    key_hash:`eq.${hash}`,
    revoked_at:'is.null',
    limit:'1'
  });
  const keyResponse=await supabaseFetch(url,secret,`api_keys?${keyQuery}`,{method:'GET'});
  if(!keyResponse.ok) return fail(502,'supabase_lookup_failed');
  const [keyRow]=await keyResponse.json();
  if(!keyRow) return fail(401,'invalid_api_key');

  const since=new Date(Date.now()-60_000).toISOString();
  const rateQuery=new URLSearchParams({
    select:'id',
    api_key_id:`eq.${keyRow.id}`,
    created_at:`gte.${since}`
  });
  const rateResponse=await supabaseFetch(url,secret,`traces?${rateQuery}`,{
    method:'HEAD',
    headers:{prefer:'count=exact'}
  });
  const count=Number((rateResponse.headers.get('content-range')||'0/0').split('/')[1]||0);
  if(Number.isFinite(count)&&count>=600) return fail(429,'rate_limited',{limit_per_minute:600});

  const traceId=(payload.trace_id||`tr_${randomUUID().replaceAll('-','').slice(0,20)}`).slice(0,120);
  const traceRow={
    project_id:keyRow.project_id,
    trace_id:traceId,
    ts:payload.timestamp||new Date().toISOString(),
    provider:String(payload.provider).slice(0,80),
    model:String(payload.model).slice(0,120),
    status:payload.status,
    status_code:payload.status_code??null,
    error_message:payload.error_message?String(payload.error_message).slice(0,1000):null,
    latency_ms:Number(payload.latency_ms),
    input_tokens:Number(payload.input_tokens||0),
    output_tokens:Number(payload.output_tokens||0),
    cost_usd:Number(payload.cost_usd||0),
    environment:String(payload.environment||'production').slice(0,60),
    route:payload.route?String(payload.route).slice(0,200):null,
    tags:Array.isArray(payload.tags)?payload.tags.slice(0,30).map(String):[],
    metadata:payload.metadata&&typeof payload.metadata==='object'?payload.metadata:{},
    api_key_id:keyRow.id,
    is_synthetic:false
  };

  const traceResponse=await supabaseFetch(url,secret,'traces',{
    method:'POST',
    headers:{prefer:'return=representation'},
    body:JSON.stringify(traceRow)
  });
  if(!traceResponse.ok){
    const message=await traceResponse.text();
    return fail(502,'trace_insert_failed',{detail:message.slice(0,300)});
  }
  const [inserted]=await traceResponse.json();

  if(Array.isArray(payload.spans)&&payload.spans.length){
    const spanRows=payload.spans.map(span=>({
      trace_row_id:inserted.id,
      project_id:keyRow.project_id,
      name:String(span.name||'span').slice(0,160),
      kind:String(span.kind||'internal').slice(0,60),
      start_offset_ms:Number(span.start_offset_ms||0),
      duration_ms:Number(span.duration_ms||0),
      status:String(span.status||'ok').slice(0,40),
      attributes:span.attributes&&typeof span.attributes==='object'?span.attributes:{}
    }));
    const spanResponse=await supabaseFetch(url,secret,'spans',{
      method:'POST',
      body:JSON.stringify(spanRows)
    });
    if(!spanResponse.ok) return fail(502,'span_insert_failed');
  }

  await supabaseFetch(url,secret,`api_keys?id=eq.${keyRow.id}`,{
    method:'PATCH',
    body:JSON.stringify({last_used_at:new Date().toISOString()})
  });

  return {status:200,body:{id:inserted.id,trace_id:traceId}};
}
