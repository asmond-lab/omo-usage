<p align="center"><img src="https://raw.githubusercontent.com/asmond-lab/omo-usage/main/assets/banner.png" alt="omo-usage" width="100%"></p>

# omo-usage

**English** | [한국어](README.ko.md)

Shows how much usage is **left** for the model you are using, right in the OMO Native footer.
Switch models and it follows; models with no usage data are simply not shown.

![Usage on its own line under a busy footer](https://raw.githubusercontent.com/asmond-lab/omo-usage/main/assets/own-line.png)
![Kiro, plenty left](https://raw.githubusercontent.com/asmond-lab/omo-usage/main/assets/kiro.png)
![ChatGPT subscription, about half left](https://raw.githubusercontent.com/asmond-lab/omo-usage/main/assets/chatgpt.png)
![Running low](https://raw.githubusercontent.com/asmond-lab/omo-usage/main/assets/low.png)

## Install

```sh
omo install https://github.com/asmond-lab/omo-usage
```

Then start `omo` (or run `/reload` in an open session).

## Supported

| Provider in OMO | What it shows |
|---|---|
| `kiro` (any extension that registers the `kiro` provider) | Credits left this month, e.g. `3,542 / 5,000` |
| `chatgpt-subscription` | Weekly limit left (the tighter window if there are two) |
| `anthropic-subscription` | The tighter of the 5-hour and 7-day limits |
| `openrouter` | The key's spending limit left (only when the key has a limit) |
| `vercel-ai-gateway` | Credit balance |

Anything else (API-key providers like `xai` or `anthropic`) only exposes per-minute rate limits,
not how much is left, so nothing is shown.

## Colors

| Left | Color |
|---|---|
| more than 50% | green |
| 20–50% | amber |
| under 20% | red, with **곧 소진** (running out) |

## Good to know

- It uses the login OMO already has for that provider. No extra setup, and nothing is stored.
- The bar gets its own line at the bottom, under OMO's footer, so a long session name or other statuses never push it off screen.
- It refreshes after every reply: about 5 seconds after, then once more 45 seconds later, because Kiro sometimes counts a reply late. Lookups start at least 10 seconds apart, a burst of replies updates within 15 seconds, and lookups stop when the session is idle.
- The ChatGPT and Claude subscription numbers come from the same endpoints their official apps use.
  Those are not public APIs and may change; if one breaks, that provider just stops showing.
- Tested live with Kiro, ChatGPT, OpenRouter and Vercel. The Claude subscription lookup follows
  other working clients but has not been run against a real Claude account yet.
- Labels are in Korean (`남음`, `리셋`, `곧 소진`).

Tests: `bun test tests`

## License

MIT
