export default function handler(_req,res){
  res.status(200).json({ok:true,service:'traceforge-ai',time:new Date().toISOString()});
}
