/** Bound the streamed body before JSON parsing or allocating the entire request. */
export async function reportRequestBody(request:Request,maxBytes:number) {
  const reader=request.body?.getReader();if(!reader)throw new SyntaxError();let size=0;const parts:Uint8Array[]=[];
  try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>maxBytes){await reader.cancel();throw new Error("REPORT_REQUEST_LIMIT");}parts.push(chunk.value);}return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;}finally{reader.releaseLock();}
}
