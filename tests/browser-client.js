// Local UI test fixture only. The production build never imports this module.
let currentSession = null, listener;
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'ui-test@example.com' };
let records = [], history = [];
if (new URLSearchParams(location.search).has('monitoring')) {
  const id = '22222222-2222-4222-8222-222222222222';
  records = [{ id, user_id: user.id, name: 'LOCAL TEST backend', url: 'https://demo.onrender.com/health', enabled: true, interval_minutes: 10, last_status: 'up', last_checked_at: new Date().toISOString() }];
  history = Array.from({ length: 30 }, (_, i) => ({ id: `fixture-${i}`, monitor_id: id, user_id: user.id, status: i % 7 === 3 ? 'down' : 'up', http_code: i % 7 === 3 ? 503 : 200, response_ms: 80 + i * 25, error: i === 3 ? 'Request timed out' : null, checked_at: new Date(Date.now() - i * 3600000).toISOString() }));
}
const extras={telemetry_apps:[],request_events:[],alert_acknowledgements:[],status_pages:[],status_components:[]};
if(new URLSearchParams(location.search).has('monitoring')){
 extras.telemetry_apps=[{id:'test-app',name:'LOCAL TEST API',last_received_at:new Date().toISOString()}];
 extras.request_events=Array.from({length:120},(_,i)=>({id:i,app_id:'test-app',method:i%3?'GET':'POST',route:i%3?'/products/:id':'/orders',status_code:i%9===0?500:200,duration_ms:70+i*7,error_type:i%9===0?'TypeError':null,received_at:new Date(Date.now()-i*600000).toISOString()}));
}
function query(table) {
  let action = 'select', payload, conditions = [], single = false;
  const q = {
    select() { return q; }, order() { return q; }, limit() { return q; },
    eq(key,value) { conditions.push([key,value]); return q; },
    maybeSingle() { single = true; return q; }, single() { single = true; return q; },
    insert(value) { action = 'insert'; payload = value; return q; },
    update(value) { action = 'update'; payload = value; return q; },
    delete() { action = 'delete'; return q; },
    then(resolve) {
      const match = row => conditions.every(([key,value]) => row[key] === value);
      let rows = table === 'monitors' ? records : table === 'health_checks' ? history : table==='scheduler_status'?[{id:true,last_run_at:new Date().toISOString()}]:extras[table]??[];
      if(action === 'insert') { const row={...payload,id:crypto.randomUUID(),enabled:true,created_at:new Date().toISOString(),last_checked_at:null}; (table==='monitors'?records:extras[table]).push(row); rows=[row]; }
      else if(action === 'update') { rows=rows.filter(match); rows.forEach(row=>Object.assign(row,payload)); }
      else if(action === 'delete') { if(table==='monitors')records=records.filter(row=>!match(row));else extras[table]=extras[table].filter(row=>!match(row));rows=[]; }
      else rows=rows.filter(match);
      resolve({data:single ? rows[0] ?? null : rows,error:null});
    },
  }; return q;
}
export function createClient() {
  return {
    auth: {
      onAuthStateChange(callback) { listener=callback; setTimeout(()=>callback('INITIAL_SESSION',currentSession),0); },
      async signInWithPassword() { currentSession={user}; listener('SIGNED_IN',currentSession); return {error:null}; },
      async signUp() { return {data:{session:null},error:null}; },
      async resetPasswordForEmail() { return {error:null}; },
      async updateUser() { return {error:null}; },
      async signOut() { currentSession=null; listener('SIGNED_OUT',null); return {error:null}; },
    },
    from:query,
    async rpc(_name,{p_page_id,p_monitor_ids}){extras.status_components=extras.status_components.filter(r=>r.page_id!==p_page_id).concat(p_monitor_ids.map(monitor_id=>({page_id:p_page_id,monitor_id})));return {error:null};},
    functions:{ async invoke(_name,{body}) { const m=records.find(row=>row.id===body.monitor_id); const result={status:'up',http_code:200,response_ms:124,error:null}; const now=new Date().toISOString(); Object.assign(m,{last_status:'up',last_checked_at:now,last_http_code:200}); history.unshift({...result,id:crypto.randomUUID(),monitor_id:m.id,checked_at:now,user_id:user.id}); return {data:{result},error:null}; } },
  };
}
