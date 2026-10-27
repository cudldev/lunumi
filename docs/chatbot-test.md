# Standalone chatbot test

- Entry: `chat-test/` on live and staging. No onboarding, location, menu fetching, recommendations, or restaurant actions.
- SmolLM2-1.7B-Instruct (Apache 2.0), revision `31b70e2e869a7173562077fd711b654946d38674`, runs locally through Transformers.js 4.3.2 in a worker.
- First use downloads about 1.4 GB from Hugging Face/CDN hosts; cached files may remain after clearing chat. WebGPU is preferred; a fresh WASM worker provides slower CPU fallback.
- Conversation stays in memory on-device, with bounded recent history and streamed replies. Stop cancels work; Clear removes the conversation and releases the worker. Startup times out after six minutes; stalled token generation stops after 90 seconds.
- Best tested on desktop. Memory limits and browser support can prevent inference. The small model can make mistakes; replies are limited to 160 tokens and repeated phrases are constrained.
- Main app and full restaurant-agent development are separate from this test.

Sources: [model card](https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct), [Transformers.js](https://huggingface.co/docs/transformers.js/).
