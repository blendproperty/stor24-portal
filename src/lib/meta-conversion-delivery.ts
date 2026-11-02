export const META_DATASET = '2256945718217336';
export type MetaLeadEvent = {event_name:'Lead';event_time:number;event_id:string;action_source:'website';event_source_url:string;user_data:{fbp:string;fbc?:string;client_ip_address?:string;client_user_agent?:string}};
export async function deliverMetaLead(token:string,event:MetaLeadEvent,testEventCode?:string) {
  try {
    const response = await fetch(`https://graph.facebook.com/v25.0/${META_DATASET}/events`, {
      method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify({data:[event],...(testEventCode?{test_event_code:testEventCode}:{})}),
      signal:AbortSignal.timeout(10000),cache:'no-store',
    });
    if(response.ok){const body=await response.json();if(body.events_received===1)return {status:'accepted' as const,http:response.status};return {status:'retry' as const,http:response.status};}
    return {status:response.status===429||response.status>=500?'retry' as const:'rejected' as const,http:response.status};
  } catch {return {status:'retry' as const,http:0};}
}
