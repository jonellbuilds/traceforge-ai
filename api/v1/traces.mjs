import { ingestTrace } from '../../lib/ingest.mjs';

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'method_not_allowed'});
  const result=await ingestTrace({
    authorization:req.headers.authorization,
    payload:req.body,
    env:process.env
  });
  return res.status(result.status).json(result.body);
}
