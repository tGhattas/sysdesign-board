# sketch/design — System Design Interview Board

Practice system design interviews with Claude as your interviewer. This plugin gives Claude a hand-drawn whiteboard that opens in your browser. You draw your architecture with ready-made components (load balancers, caches, databases, queues, event streams and more), talk by voice or text, and Claude reads your diagram, asks follow-up questions, pins comments on specific components, tracks the interview phases and ends with scored feedback.

![A mock interview in progress](https://raw.githubusercontent.com/tGhattas/sysdesign-board/main/docs/screenshot.png)

## What's included

- **MCP server `sysdesign-board`:** 13 tools to start an interview, wait for and talk to the candidate, read the board as structured data or as an image, annotate and highlight components, draw, set the phase, and end with feedback.
- **Skill `system-design-interview`:** teaches Claude how to run the interview loop like a real interviewer.

## How to use

After installing, ask Claude:

> Start a system design interview with me on my sketch board.

The board opens at `http://localhost:4321`. Use Chrome, Edge or Safari for the microphone.

Example prompts:

1. "Give me a senior-level system design interview: design a URL shortener, 45 minutes."
2. "Mock interview me on designing a chat app like WhatsApp, and be tough on the deep dive."
3. "Look at what I drew and tell me where the bottleneck is."

## What it runs and what it sends

- **What it runs:** the MCP server, the npm package `sysdesign-board`. It's pinned to an exact version with its checksum in `package-lock.json`. Claude Code installs it from that lockfile when you install the plugin (with install scripts disabled) and starts it with `node`. It runs a small web server bound to `127.0.0.1` that serves the board page and syncs it over a local WebSocket. The package has no dependencies of its own.
- **What it connects to:** nothing beyond your machine. It has no telemetry, no analytics and no accounts. The board, its API and its WebSocket refuse requests that don't come from localhost.
- **What it writes:** board and chat state to `~/.sysdesign-board/`. It also opens the board URL in your default browser.
- **What reaches Claude:** whatever the tools return when Claude calls them: the board description, a picture of the board, your messages and your transcripts.

Source code: https://github.com/tGhattas/sysdesign-board

## Privacy Policy

The full policy is at https://github.com/tGhattas/sysdesign-board/blob/main/PRIVACY.md. In short:

- **Stored only on your machine:** the board, the chat, your voice transcripts and your settings. They live in your browser's local storage and in `~/.sysdesign-board/`.
- **Sent to Claude only when it calls a tool:** board content, images and messages, which are then handled under Anthropic's privacy policy.
- **Microphone:** uses your browser's speech recognition. Chrome sends the audio to Google for transcription; Safari uses Apple's speech service.
- **No collecting, selling or sharing:** the author operates no server and keeps no data.
- **Deleting it:** data stays until you clear the board or delete `~/.sysdesign-board/`.
- **Contact:** https://github.com/tGhattas/sysdesign-board/issues

## License

MIT
