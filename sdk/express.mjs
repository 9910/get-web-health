// Server-only Express middleware. Never put the telemetry key in frontend code.
export function createWebHealth({ key=process.env.GWH_TELEMETRY_KEY, endpoint='https://ywkeuvdhtrmhtsugbntj.supabase.co/functions/v1/telemetry-ingest', fetchImpl=fetch, batchSize=20, flushMs=5000 }={}) {
 if(!/^gwh_[a-f0-9]{64}$/.test(key??''))throw new Error('Set GWH_TELEMETRY_KEY to the server-only integration key.');
 const url=new URL(endpoint);if(url.protocol!=='https:')throw new Error('Telemetry endpoint must use HTTPS.');
 batchSize=Math.max(1,Math.min(50,batchSize));let queue=[],inflight=null,stopped=false;
 const timer=setInterval(()=>void flush(),flushMs);timer.unref?.();
 function flush(){
  if(inflight)return inflight;if(!queue.length)return Promise.resolve();const events=queue.splice(0,batchSize);
  inflight=(async()=>{try{await fetchImpl(url,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify({events}),signal:AbortSignal.timeout(5000)});}catch{/* Best effort; never disrupt application requests. */}})().finally(()=>{inflight=null;});
  return inflight;
 }
 const middleware=(req,res,next)=>{
  const start=performance.now();res.once('finish',()=>{
   if(stopped||queue.length>=200)return;
   const route=typeof req.route?.path==='string'?String(req.baseUrl??'')+req.route.path:'unmatched route';
   queue.push({method:['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(req.method)?req.method:'GET',route:route.split('?')[0].slice(0,200),status_code:res.statusCode,duration_ms:Math.min(600000,Math.max(0,Math.round(performance.now()-start))),error_type:res.locals?.gwhErrorType??(res.statusCode>=500?'ServerError':null)});
   if(queue.length>=batchSize)void flush();
  });next();
 };
 const errorMiddleware=(error,req,res,next)=>{res.locals??={};res.locals.gwhErrorType=String(error?.name??'Error').replace(/[^a-zA-Z0-9_. -]/g,'').slice(0,80);next(error);};
 return {middleware,errorMiddleware,flush,async close(){stopped=true;clearInterval(timer);if(inflight)await inflight;while(queue.length)await flush();}};
}
