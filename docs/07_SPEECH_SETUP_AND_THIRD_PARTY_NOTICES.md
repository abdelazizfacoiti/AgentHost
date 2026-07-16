# Local Speech Setup and Notices

AgentHost speech is local/offline only. Install providers manually through the operating system. AgentHost never installs packages, downloads models, or contacts cloud TTS services.

## Recommended provider

Install eSpeak NG using the normal package manager for the Linux distribution. Verify with:

```text
espeak-ng --version
espeak-ng --voices
```

AgentHost detects eSpeak NG and uses fixed argument arrays. Source and project licensing: [eSpeak NG](https://github.com/espeak-ng/espeak-ng). AgentHost does not bundle or redistribute the system executable.

## Optional providers

Piper is detected only when explicitly installed/configured. Voice files require local license review; executable and model/voice licensing may differ. See [Piper](https://github.com/OHF-Voice/piper1-gpl) and its [voice documentation](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md). No model download or bundling occurs.

Speech Dispatcher is diagnostic-only unless a compatible local installation is detected.

## Audio diagnostics

AgentHost probes PipeWire, PulseAudio, and ALSA read-only. It does not create virtual sinks, loopbacks, routes, or microphones. Governed transmission currently accepts only an already-available `default-output` route; arbitrary device routing is unsupported. PipeWire command reference: [pw-cli](https://docs.pipewire.org/page_man_pw-cli_1.html).

## Safety boundary

Provider discovery is read-only. Synthesis, playback, and stop require explicit tool calls; synthesis/playback use dry-run and confirmation. Transmission preparation does not transmit. Transmission execution requires fresh grant, exact artifact/route/target binding, and one-time confirmation. No recording, transcription, meeting join, automatic recap, message send, upload, payment, or credential access is included.
