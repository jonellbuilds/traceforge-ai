export default function handler(_req,res){
  const url=process.env.SUPABASE_URL||'';
  const publishableKey=process.env.SUPABASE_PUBLISHABLE_KEY||'';
  res.setHeader('Cache-Control','public, max-age=60, s-maxage=300');
  res.status(200).json({configured:Boolean(url&&publishableKey),url,publishableKey});
}
