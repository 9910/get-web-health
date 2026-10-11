export async function newIntegrationKey() {
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 const key='gwh_'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
 return {key,key_hash:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')};
}
