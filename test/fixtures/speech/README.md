# Real-speech clip for the Whisper e2e

`budget-garden.wav` is Kokoro fp32 (voice af_heart) saying "The budget meeting
is in the garden tomorrow morning." It was made with gifos-mcp-core:

    node scripts/speech-wav.mjs budget-garden.wav 'The budget meeting is in the garden tomorrow morning.'

`npm run test:e2e:whisper` plays it as Alice's microphone and passes when the
bot's Whisper transcript holds at least 80% of budget, meeting, garden,
tomorrow and morning. The clip is committed so every run hears the same
audio: no model download on the test computer, and never q8 (corrupt on
some CPUs).
