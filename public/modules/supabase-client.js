import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2?target=es2022';

let clientPromise;

async function loadConfig(){
  const response=await fetch('/api/config',{headers:{accept:'application/json'}});
  if(!response.ok) throw new Error('Unable to load Supabase configuration.');
  return response.json();
}

export async function getSupabase(){
  if(!clientPromise){
    clientPromise=loadConfig().then(config=>{
      if(!config.configured) return null;
      return createClient(config.url,config.publishableKey,{
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
      });
    });
  }
  return clientPromise;
}

export async function getCurrentSession(){
  const supabase=await getSupabase();
  if(!supabase) return {supabase:null,session:null};
  const {data,error}=await supabase.auth.getSession();
  if(error) throw error;
  return {supabase,session:data.session};
}

export function onAuthChange(handler){
  getSupabase().then(supabase=>{
    if(!supabase) return;
    supabase.auth.onAuthStateChange((_event,session)=>handler(session));
  });
}
