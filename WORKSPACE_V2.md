# relay. / Personal Workspace V2

A visual and interaction-layer redesign of PairDrop. This branch is built on `feature/personal-ui-v1` and **does not change the signaling, WebRTC, room, transfer, or persistent pairing implementations**.

## Product concept

A small personal transfer desk with two explicit areas:

- **Devices**: live nearby / paired / public-room devices supplied by upstream PairDrop; a device can be selected without opening the native file picker.
- **Conversation**: compose text, attach files, drag files in, and see session-only activity. Incoming file downloads and approval flows continue to use the upstream dialogs.

The design language uses lavender, mint, soft surfaces, purposeful whitespace, and a dark-mode token set. Mobile devices use a horizontal device strip above the conversation.

## Responsibilities and architecture

| File | Role |
| --- | --- |
| `public/index.html` | Static semantic shell around the original `x-peers`, `x-no-peers`, `x-instructions` and dialog anchors |
| `public/styles/personal-workspace.css` | Visual tokens, layout, states, responsive design and dialog polish |
| `public/scripts/personal-workspace.js` | View adapter: selected peer, composer, native event bridge, ephemeral log |
| `public/service-worker.js` | Precache new assets; use separate V2 cache prefix |
| `public/manifest.json` | V2 PWA title, colors and scoped share target |

The event bridge emits only the same public events PairDrop already uses:

- `send-text` with `{ text, to }`
- `files-selected` with `{ files, to }`

It consumes `peer-added`, `peer-disconnected`, `peer-display-name-changed`, `room-type-removed`, `share-mode-changed`, `ws-connected`, `ws-disconnected`, `text-received`, and `files-received`.

**Nothing is persisted by PersonalWorkspace.** Session bubbles are a UI aid and say “已发起发送” for outgoing traffic; they do not claim delivery confirmation. Text is inserted using `textContent`, never `innerHTML`, and file data is not stored in a new application state.

## Upstream functionality retained

- Auto discovery and permanent paired-device lookup
- Temporary public rooms
- Receive confirmation and receive / download dialogs
- File-transfer progress from the existing `x-peer` component
- WebRTC, STUN/TURN, signaling and optional WebSocket fallback
- Share-target and clipboard/drag share mode

The adapter does not replace or monkey-patch upstream classes.

## QA checklist

- [ ] New shell loads without Console errors at desktop and mobile widths
- [ ] Device list updates when a peer joins/leaves; selected peer clears after disconnect
- [ ] Select Device A, send text; select Device B, send files; correct recipients
- [ ] Drag one or multiple files onto the conversation panel
- [ ] Pasting into the message field doesn't activate PairDrop's global paste-to-share mode
- [ ] Shift+Enter inserts a newline; Enter sends (outside IME composition)
- [ ] Native pairing and public room dialogs open from the left quick actions
- [ ] File receive acceptance, download and progress continue to work
- [ ] Light and dark themes and narrow Android viewport render without overlap
- [ ] PWA scope is correct for preview under `/PairDrop/v2/`
- [ ] Test paired devices with phone on cellular / laptop on Wi-Fi

Avoid opening V1 and V2 concurrently in the same browser during testing: same origin means their browser storage may be shared.

## Rollback and preview

The V1 site at `/PairDrop/` stays unchanged. V2 preview is deployed at `/PairDrop/v2/` via a nested tree in `gh-pages`. The new feature branch isn't merged into `master`.

Original project: https://github.com/schlagmichdoch/PairDrop • GPL-3.0.
