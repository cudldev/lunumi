import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const {pipeline}=vi.hoisted(()=>({pipeline:vi.fn()}));
vi.mock('@huggingface/transformers',()=>({env:{backends:{onnx:{wasm:{}}}},pipeline,TextStreamer:class {}}));
beforeEach(()=>{vi.resetModules();pipeline.mockReset()});
afterEach(()=>vi.unstubAllGlobals());
it.each([['compact','fp16'],['standard','q4f16']] as const)('loads the %s profile on GPU using its explicit %s export',async(modelSize,dtype)=>{
  const model=vi.fn().mockResolvedValue([]);pipeline.mockResolvedValue(model);
  const scope={location:{origin:'https://example.test'},postMessage:vi.fn(),onmessage:null as ((event:MessageEvent)=>void)|null};
  vi.stubGlobal('self',scope);vi.stubGlobal('navigator',{gpu:{requestAdapter:async()=>({features:new Set(['shader-f16'])})}});
  await import('./conversation.worker');
  await scope.onmessage!(new MessageEvent('message',{data:{messages:[],mode:'prepare',device:'webgpu',modelSize}}));
  expect(pipeline).toHaveBeenCalledWith('text-generation',expect.any(String),expect.objectContaining({device:'webgpu',dtype}));
  expect(model).toHaveBeenCalledWith(expect.any(Array),expect.objectContaining({max_new_tokens:1}));
  expect(scope.postMessage).toHaveBeenCalledWith({type:'done',text:'ready'});
});
