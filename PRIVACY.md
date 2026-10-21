# Privacy Policy

_Last updated: October 21, 2026_

sysdesign-board ("sketch/design") is open-source software that runs entirely on your own computer. The author does not operate any server for it, has no accounts, and collects no analytics or telemetry. This policy explains what the software handles and where that data goes.

## Data the software handles

- **Your board:** shapes, components, arrows, text, sticky notes and freehand drawings you create.
- **The interview:** the problem statement, timer and phase, chat messages, transcripts of what you say into the microphone, and the feedback the AI interviewer writes.
- **Settings:** theme, panel layout and similar preferences.
- **A local access token** for the optional HTTP endpoint (`/mcp`).

## Where it is stored

Everything is stored locally on your machine:

- in your browser's local storage for the board page (`http://localhost:<port>`), and
- in the `~/.sysdesign-board/` folder (`state.json` for the board and chat, `token` for the access token).

Nothing is uploaded to the author or to any server run by the author.

## When data leaves your computer

Data only leaves your machine through services you choose to use:

- **The AI app you connect** (for example Claude Desktop, Claude Code, Codex or ChatGPT). When the AI interviewer calls a tool, it receives the data that tool returns: a description of your board, a picture of your board, your messages and transcripts. That data is then handled by the AI provider under its own privacy policy and terms.
- **Speech recognition in your browser.** The microphone feature uses your browser's built-in Web Speech API. Depending on the browser, audio may be sent to the browser vendor for transcription (Google Chrome sends it to Google; Safari uses Apple's speech service). Reading replies aloud uses your system's voices, some of which may be network voices provided by the browser vendor. If you never press the mic button, no audio is captured.
- **Installation.** Installing or running it with `npx` downloads the package from the npm registry, which sees a normal download request.
- **Optional tunnel.** If you choose to expose the HTTP endpoint through a tunnel (for example Cloudflare) to use ChatGPT, requests to `/mcp` pass through that tunnel provider. The board page, its API and its WebSocket refuse requests that don't come from your own machine, and `/mcp` always requires your token.

The software has no ads, does not sell or share data with third parties, and sends no data anywhere else.

## Retention and deletion

Data stays on your machine until you delete it. You can:

- clear the board from the menu (**Clear board** or **New board**),
- delete the `~/.sysdesign-board/` folder, and
- clear the site data for `localhost` in your browser.

Data you have already sent to an AI provider is retained according to that provider's policy.

## Children

The software is not directed at children under 13 and collects no information about its users.

## Changes

Changes to this policy are published in this file in the project's repository, with an updated date.

## Contact

Questions or concerns: open an issue at https://github.com/tGhattas/sysdesign-board/issues
