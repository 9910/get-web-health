import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
Deno.serve(async req=>{
 if(req.method!=='POST')return Response.json({error:'Use POST'},{status:405});
 const token=req.headers.get('authorization')?.replace(/^Bearer /i,'')??'';
 if(!/^gwh_[a-f0-9]{64}$/.test(token))return Response.json({error:'Invalid telemetry key'},{status:401});
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const {data:app,error:authError}=await admin.from('telemetry_apps').select('id').eq('key_hash',digest).maybeSingle();
 if(authError)return Response.json({error:'Authentication unavailable'},{status:503});
 if(!app)return Response.json({error:'Invalid telemetry key'},{status:401});
 try{
  const reader=req.body?.getReader(); if(!reader)throw new Error('Body required');
  let bytes=0, parts=[]; while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>65536){await reader.cancel();return Response.json({error:'Batch too large'},{status:413});}parts.push(value);}
  const joined=new Uint8Array(bytes);let offset=0;for(const part of parts){joined.set(part,offset);offset+=part.length;}
  const body=JSON.parse(new TextDecoder().decode(joined));
  if(!Array.isArray(body.events)||!body.events.length||body.events.length>50)throw new Error('Invalid events');
  const events=body.events.map((x:any)=>{
   if(!['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(x.method)||typeof x.route!=='string'||x.route.length>200||/[?\r\n]/.test(x.route)||!Number.isInteger(x.status_code)||x.status_code<100||x.status_code>599||!Number.isInteger(x.duration_ms)||x.duration_ms<0||x.duration_ms>600000)throw new Error('Invalid event');
   return {method:x.method,route:x.route,status_code:x.status_code,duration_ms:x.duration_ms,error_type:typeof x.error_type==='string'?x.error_type.replace(/[^a-zA-Z0-9_. -]/g,'').slice(0,80):null};
  });
  const {data,error}=await admin.rpc('record_telemetry',{p_app_id:app.id,p_events:events});
  if(error)return Response.json({error:'Could not save events'},{status:503});
  if(data===-1)return Response.json({error:'Hourly event limit reached'},{status:429});
  return Response.json({accepted:data});
 }catch{return Response.json({error:'Invalid telemetry batch'},{status:400});}
});
