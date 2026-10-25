Clasification High-Risk Topical Context with LLM and Systemone model

 - LLM https://huggingface.co/LiquidAI/LFM2.5-8B-A1B-GGUF (4-bit Q4_K_M 5.16 GB)
 - SystemOne https://huggingface.co/LiquidAI/d1-3B-GGUF (4-bit Q4_K_M 1.67 GB)

Clasificaton of "High-Risk Topical Context"

These are not inherently policy violations, but they flag the message as requiring specialized handling or contextual awareness.
 - Politics & Elections: Political campaigns, candidates, voting procedures, and public policy.
 - Medical & Health: Medical advice, symptoms, pharmaceuticals, or mental health discussions.
 - Legal & Regulatory: Court cases, compliance matters, contracts, or law enforcement mentions.
 - Financial & Crypto: Investment advice, stock tickers, banking details, or cryptocurrency.

Clasification will be running python flow and executed in Pi Durable with sqllite ...

There will be Nx1000 clasification tasks, find right datasetsw ith short topics.

Trollino will distrub clasification randomy (kill it) and we can see then PU durable will recover state - make it wisible in GUI as play (make it in delay so humans can see it)

Dokerized:
 - llama.cpp server 7.x
 - Node 24.x for PI durable and GUI
 - Arize Phoenix (traces)

Inspirations:
 - https://github.com/alejandro-ao/pi-durable-demo