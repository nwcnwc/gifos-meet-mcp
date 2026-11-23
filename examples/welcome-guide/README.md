# GifOS welcome guide (bot kit example)

Our own instance of the GifOS bot kit ([@gifos-app/agent/kit](https://github.com/nwcnwc/gifos-agent/blob/main/docs/bot-kit.md)):
a bot that welcomes people to GifOS, explains its features and helps them use them well. Its facts come from the
live https://gifos.app/llms.txt and https://gifos.app/meet/llms.txt, fetched at start and every hour, so they
follow the site. It says it is a bot, stays on GifOS, never asks for personal data and never claims to do what it
cannot.

| File | What |
|---|---|
| `mia.demo.bot.json`, `leo.demo.bot.json` | The demo pair: two siblings (Mia leads, Leo takes over when she is gone), an LLM brain on a local Ollama, the on-device Kokoro voice and the animated avatar. |
| `live.bot.json` | The always-on welcome bot: no LLM (answers from the live guide text), **no voice, no avatar** (it runs on a small computer). |
| `kit-handler.mjs` | The same brain as a guard handler, for a bot that runs as a guard (`examples/guard`). |

Run the demo pair in a room of your own (each bot is one process; Ollama with `qwen2.5:7b` and `kokoro-js` installed):

```sh
GIFOS_BOT_LINK=https://gifos.app/meet/<your-room> npx gifos-bot mia.demo.bot.json
GIFOS_BOT_LINK=https://gifos.app/meet/<your-room> npx gifos-bot leo.demo.bot.json
```

Copy a file to make your own bot: change the name, declaration, prompt, knowledge and link. The recipe has every
field, and the brain, voice and avatar choices with their costs.
