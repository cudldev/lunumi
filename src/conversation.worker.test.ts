import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const {pipeline,webgpu}=vi.hoisted(()=>({pipeline:vi.fn(),webgpu:{} as {device?:unknown}}));
vi.mock('@huggingface/transformers',()=>({env:{backends:{onnx:{wasm:{},webgpu}}},pipeline,TextStreamer:class {}}));
beforeEach(()=>{vi.resetModules();pipeline.mockReset();delete webgpu.device});
afterEach(()=>vi.unstubAllGlobals());
it.each([['compact','q4f16'],['standard','q4f16']] as const)('loads the %s profile on GPU using its explicit %s export',async(modelSize,dtype)=>{
  const model=vi.fn().mockResolvedValue([]);pipeline.mockResolvedValue(model);
  const scope={location:{origin:'https://example.test'},postMessage:vi.fn(),onmessage:null as ((event:MessageEvent)=>void)|null};
  vi.stubGlobal('self',scope);vi.stubGlobal('navigator',{gpu:{requestAdapter:async()=>({features:new Set(['shader-f16'])})}});
  await import('./conversation.worker');
  await scope.onmessage!(new MessageEvent('message',{data:{messages:[],mode:'prepare',device:'webgpu',modelSize}}));
  expect(pipeline).toHaveBeenCalledWith('text-generation',expect.any(String),expect.objectContaining({device:'webgpu',dtype}));
  expect(model).toHaveBeenCalledWith(expect.any(Array),expect.objectContaining({max_new_tokens:1}));
  expect(scope.postMessage).toHaveBeenCalledWith({type:'done',text:'ready'});
});
it('includes the actual device loss in a failed readiness check',async()=>{
  let lose!: (info:{reason:string;message:string})=>void;
  webgpu.device={lost:new Promise(resolve=>{lose=resolve}),addEventListener:vi.fn()};
  pipeline.mockResolvedValue(vi.fn().mockImplementation(async()=>{
    lose({reason:'unknown',message:'Instance reference lost'});
    throw new Error('MatMul failed');
  }));
  const scope={location:{origin:'https://example.test'},postMessage:vi.fn(),onmessage:null as ((event:MessageEvent)=>void)|null};
  vi.stubGlobal('self',scope);vi.stubGlobal('navigator',{gpu:{requestAdapter:async()=>({features:new Set(['shader-f16'])})}});
  await import('./conversation.worker');
  await scope.onmessage!(new MessageEvent('message',{data:{messages:[],mode:'prepare',device:'webgpu',modelSize:'compact'}}));
  expect(scope.postMessage).toHaveBeenCalledWith({type:'error',text:expect.stringContaining('deviceLost=unknown: Instance reference lost')});
  expect(scope.postMessage).toHaveBeenCalledWith({type:'error',text:expect.stringContaining('stage=readiness')});
  expect(scope.postMessage).not.toHaveBeenCalledWith({type:'done',text:'ready'});
  expect(pipeline).toHaveBeenCalledOnce();
});
