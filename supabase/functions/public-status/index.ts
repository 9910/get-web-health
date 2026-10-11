import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const headers={'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
Deno.serve(async req=>{
 if(req.method!=='GET')return json({error:'Use GET'},405);
 const slug=new URL(req.url).searchParams.get('slug')??'';
 if(!/^[a-f0-9]{32}$/.test(slug))return json({error:'Status page not found'},404);
 const {data:page,error}=await admin.from('status_pages').select('id,title,user_id').eq('slug',slug).eq('published',true).maybeSingle();
 if(error)return json({error:'Status unavailable'},503);if(!page)return json({error:'Status page not found'},404);
 const {data:components,error:componentError}=await admin.from('status_components').select('monitor_id').eq('page_id',page.id);
 if(componentError)return json({error:'Status unavailable'},503);
 if(!components.length)return json({title:page.title,components:[],updated_at:new Date().toISOString()});
 const {data:monitors,error:monitorError}=await admin.from('monitors').select('name,enabled,last_status,last_checked_at,interval_minutes').in('id',components.map(c=>c.monitor_id)).eq('user_id',page.user_id);
 if(monitorError)return json({error:'Status unavailable'},503);
 return json({title:page.title,updated_at:new Date().toISOString(),components:monitors.map(m=>({name:m.name,last_checked_at:m.last_checked_at,status:!m.enabled?'maintenance':!m.last_checked_at?'pending':Date.now()-Date.parse(m.last_checked_at)>(m.interval_minutes+3)*60000?'unknown':m.last_status==='up'?'operational':'disrupted'}))});
});
