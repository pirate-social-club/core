# Community Assistant Voice Staging Smoke

Use this after a `pirate-web` or `pirate-api` deploy that could affect community assistant voice, Telegram assistant routing, assistant credentials, or ElevenLabs STT/TTS.

This is a staging smoke check, not a full E2E test.

## Goal

Confirm the live staging path works across:

- `pirate-web` assistant settings
- `pirate-api` assistant policy and credential routes
- per-community assistant policy DB rows
- control-plane assistant credentials
- Telegram community bot webhooks
- OpenRouter assistant answers
- ElevenLabs Scribe STT and ElevenLabs TTS

## 1. Confirm deployed versions

```bash
rtk proxy curl -sS https://staging.pirate.sc/__version
rtk proxy curl -sS https://api-staging.pirate.sc/__version
```

Confirm the `git_sha` values are the commits intended for the smoke.

## 2. Confirm assistant settings

Open the staging community assistant page as a community owner or admin:

```text
https://staging.pirate.sc/c/<community-id>/mod/assistant
```

Minimum expected state:

- assistant enabled
- OpenRouter key connected
- model selected
- ElevenLabs key connected
- voice mode set to `Voice replies`
- STT provider shown as ElevenLabs Scribe
- STT model set to `scribe_v2`
- TTS provider shown as ElevenLabs
- TTS voice ID non-empty

If the ElevenLabs key appears saved but voice settings still fail with `enabled voice requires a connected ElevenLabs key`, treat that as credential-route or route-wiring failure. The key must persist as a community-owned `elevenlabs` credential, not only local UI state.

## 3. Optional DB confirmation

When shell access to staging secrets is available, use the Pirate Infisical profile and inspect the target community's policy and credential rows.

Before reading staging secrets:

```bash
printf '\n' | rtk infisical user switch >/dev/null
```

Expected policy values:

```text
voice_mode=voice_replies
stt_provider=elevenlabs
stt_model=scribe_v2
tts_provider=elevenlabs
tts_voice=<non-empty>
```

Expected control-plane credentials:

```text
provider=openrouter  status=active
provider=elevenlabs  status=active
```

Do not paste API keys into logs, tickets, or chat. Only inspect provider, status, key suffix, and timestamps.

## 4. Telegram group smoke

Use the linked staging Telegram group for the community.

Text input:

```text
/ask can you hear me?
```

Expected:

- bot generates an assistant answer
- bot sends a Telegram voice note
- if ElevenLabs TTS or Telegram `sendVoice` fails, bot falls back to a text answer

Voice input:

1. Reply to one of the bot's messages with a Telegram voice note.
2. Ask a short question such as `what can you do?`

Expected:

- bot downloads the Telegram voice file
- ElevenLabs Scribe transcribes it
- assistant answers the transcript
- bot sends a Telegram voice note

Random group voice notes should not wake the assistant. Group voice is intentionally gated to reply-to-bot messages.

## 5. Telegram DM smoke

Use the community bot private chat from the Pirate Telegram connect flow.

Text input:

```text
can you hear me?
```

Expected: the bot replies with a voice note.

Voice input:

Send a short Telegram voice note.

Expected:

- bot transcribes the voice note
- assistant answers
- bot replies with a voice note

Unlinked Telegram users or users without community access should receive onboarding/access prompts and should not call OpenRouter or ElevenLabs.

## 6. Logs to check on failure

Look for these structured log events:

- `[telegram-assistant] voice STT start`
- `[telegram-assistant] voice STT success`
- `[telegram-assistant] voice STT failed`
- `[telegram-assistant] voice TTS start`
- `[telegram-assistant] voice TTS success`
- `[telegram-webhook] assistant TTS failed`
- `[telegram-webhook] sendVoice failed`
- `[telegram-assistant] voice reply send result`
- `[telegram-assistant] group text fallback`
- `[telegram-assistant] direct text fallback`

Useful fields:

- `communityId`
- `telegramChatId`
- `telegramCommunityBotId`
- `telegramUserId`
- `triggerType`
- `fileSize`
- `model`
- `ttsVoice`
- `requestId`
- `sent`

## 7. Minimum pass criteria

- Deployed web/API versions match the intended commits.
- Assistant settings show connected OpenRouter and ElevenLabs keys.
- Policy is configured for ElevenLabs Scribe and voice replies.
- Group `/ask` returns a voice note.
- Group reply-to-bot voice returns a voice note.
- DM text returns a voice note.
- DM voice returns a voice note.
- When voice output cannot be sent, the bot returns text instead of dropping the answer.
