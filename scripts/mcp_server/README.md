# Remote MCP server (source)

Source of the read-only remote MCP server live at https://hundredthrun-compute-desk.pages.dev/mcp
(Cloudflare Pages Function, streamable HTTP, JSON responses, no auth).

Tools:
- `list_gpus`: GPU models tracked by the desk
- `cheapest_gpu`: cheapest current on-demand price for one GPU, with provider and date
- `get_prices`: all tracked prices for one GPU

Every answer cites the desk page and the CC BY 4.0 data license.
Listed on the official MCP Registry as `io.github.hundredthrun/gpu-cloud-prices`.

Code in this folder is MIT licensed (see the repo LICENSE).
