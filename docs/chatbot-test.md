# Standalone chatbot test

- Entry: `chat-test/` on live and staging. No onboarding or restaurant tools.
- Private Transformers.js worker: SmolLM2-1.7B-Instruct (revision `31b70e2e869a7173562077fd711b654946d38674`, about 1.4 GB) on desktop; SmolLM2-360M-Instruct (revision `a10cc1512eabd3dde888204e902eca88bddb4951`, about 390 MB) on mobile/low-memory devices. Both are Apache 2.0.
- Desktop preparation begins on entry. Mobile and previously interrupted sessions wait for **Enable private AI**. Progress, pause, and retry appear before messaging becomes available. Loading runs a real inference readiness check.
- WebGPU is preferred; WASM is used without GPU support. Standard GPU initialization failures retry on CPU; compact GPU failures stop to avoid a second allocation. Phone memory limits may still prevent loading. The compact model gives less reliable answers.
- Chats stay in memory on-device. Model requests contact Hugging Face/CDN hosts; browser caches can retain weights. Stop cancels work, Clear removes messages and releases the worker. Pending-work recovery flags contain no conversation data. Startup times out after six minutes; stalled generation stops after 90 seconds.
- This guide describes the staging mobile fix; live keeps its earlier behavior until promoted.

Sources: [standard model](https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct), [compact model](https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct), [Transformers.js](https://huggingface.co/docs/transformers.js/).
