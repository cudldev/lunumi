# Standalone chatbot test

- Entry: `chat-test/` on live and staging. No onboarding or restaurant tools.
- Private Transformers.js worker: SmolLM2-1.7B-Instruct (revision `31b70e2e869a7173562077fd711b654946d38674`, about 1.1 GB) on desktop; SmolLM2-360M-Instruct (revision `a10cc1512eabd3dde888204e902eca88bddb4951`, about 273 MB) on mobile/low-memory devices. Both are Apache 2.0.
- Desktop preparation begins on entry. Mobile and previously interrupted sessions wait for **Enable private AI**. Progress, pause, and retry appear before messaging becomes available. Loading runs a real inference readiness check.
- GPU-only trial uses q4f16 exports on WebGPU for both model sizes. WebGPU and shader-f16 are checked before download. There is no CPU inference fallback or CPU retry control. GPU files differ from the previous q4 CPU files, so a new download may be needed. GPU memory limits can still prevent loading; compact-model answers are less reliable.
- Chats stay in memory on-device. Model requests contact Hugging Face/CDN hosts; browser caches can retain weights. Stop cancels work, Clear removes messages and releases the worker. Pending-work recovery flags contain no conversation data. Startup times out after six minutes; stalled generation stops after 90 seconds.
- This guide describes the staging mobile fix; live keeps its earlier behavior until promoted.

Sources: [standard model](https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct), [compact model](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct), [Transformers.js](https://huggingface.co/docs/transformers.js/).
