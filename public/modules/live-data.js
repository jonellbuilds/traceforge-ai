import { getSupabase } from './supabase-client.js';

function mapTrace(row, spans=[]){
  return {
    id:row.id,
    traceId:row.trace_id,
    ts:row.ts,
    provider:row.provider,
    model:row.model,
    status:row.status,
    latency:row.latency_ms,
    input:row.input_tokens,
    output:row.output_tokens,
    cost:Number(row.cost_usd||0),
    environment:row.environment,
    route:row.route,
    tags:row.tags||[],
    metadata:row.metadata||{},
    spans:spans.map(span=>({
      name:span.name,
      duration:span.duration_ms,
      kind:span.kind,
      status:span.status,
      attributes:span.attributes||{}
    }))
  };
}

export async function loadLiveWorkspace(){
  const supabase=await getSupabase();
  if(!supabase) throw new Error('Supabase is not configured.');

  const {data:{session}}=await supabase.auth.getSession();
  if(!session) throw new Error('Sign in to open your live workspace.');

  let {data:projects,error}=await supabase
    .from('projects')
    .select('id,name,workspace_id,retention_days,environments,default_environment,is_demo')
    .order('created_at',{ascending:true})
    .limit(1);

  if(error) throw error;

  if(!projects?.length){
    const {error:bootstrapError}=await supabase.rpc('bootstrap_workspace');
    if(bootstrapError) throw bootstrapError;
    const retry=await supabase
      .from('projects')
      .select('id,name,workspace_id,retention_days,environments,default_environment,is_demo')
      .order('created_at',{ascending:true})
      .limit(1);
    if(retry.error) throw retry.error;
    projects=retry.data;
  }

  const project=projects?.[0];
  if(!project) throw new Error('No project is available for this account.');

  const [traceResult,spanResult]=await Promise.all([
    supabase.from('traces').select('*').eq('project_id',project.id).order('ts',{ascending:true}).limit(500),
    supabase.from('spans').select('*').eq('project_id',project.id).limit(3000)
  ]);

  if(traceResult.error) throw traceResult.error;
  if(spanResult.error) throw spanResult.error;

  const spansByTrace=new Map();
  for(const span of spanResult.data||[]){
    if(!spansByTrace.has(span.trace_row_id)) spansByTrace.set(span.trace_row_id,[]);
    spansByTrace.get(span.trace_row_id).push(span);
  }

  return {
    session,
    project,
    traces:(traceResult.data||[]).map(row=>mapTrace(row,spansByTrace.get(row.id)||[]))
  };
}

export async function createLiveApiKey(projectId,name='Default key'){
  const supabase=await getSupabase();
  if(!supabase) throw new Error('Supabase is not configured.');
  const {data,error}=await supabase.rpc('create_api_key',{_project:projectId,_name:name});
  if(error) throw error;
  return Array.isArray(data)?data[0]:data;
}

export async function updateProjectSettings(projectId,patch){
  const supabase=await getSupabase();
  if(!supabase) throw new Error('Supabase is not configured.');
  const {data,error}=await supabase
    .from('projects')
    .update(patch)
    .eq('id',projectId)
    .select()
    .single();
  if(error) throw error;
  return data;
}
