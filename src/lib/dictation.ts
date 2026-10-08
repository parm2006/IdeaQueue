export type DictationStatus = 'idle' | 'starting' | 'listening' | 'stopping';
export interface SpeechResult { isFinal: boolean; 0: { transcript: string } }
export interface SpeechEngine {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<SpeechResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type SpeechConstructor = new () => SpeechEngine;

export function speechConstructor(): SpeechConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const browser = window as unknown as { SpeechRecognition?: SpeechConstructor; webkitSpeechRecognition?: SpeechConstructor };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}

const messages: Record<string, string> = {
  'not-allowed': 'Microphone access was denied. Allow it in your browser’s site settings, then try again.',
  'service-not-allowed': 'Speech recognition is unavailable in this browser. Try a different browser or type your thought.',
  'audio-capture': 'No microphone was found. Connect one and try again.',
  'no-speech': 'No speech was heard. Try recording again.',
  'network': 'The speech service could not connect. Check your connection and try again.',
};

/** Starts only on an explicit user action. Audio is handled by the browser speech service. */
export function startDictation(callbacks: {
  onFinal(text: string): void;
  onInterim(text: string): void;
  onStatus(status: DictationStatus): void;
  onError(message: string): void;
}, Constructor = speechConstructor()) {
  if (!Constructor) throw new Error('Voice capture is unavailable in this browser. Use a browser with speech recognition, or your keyboard’s dictation.');
  const recognition = new Constructor();
  const delivered = new Set<number>();
  recognition.lang = typeof navigator === 'undefined' ? 'en-US' : navigator.language || 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onstart = () => callbacks.onStatus('listening');
  recognition.onresult = event => {
    const interim: string[] = [];
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript.trim();
      if (result.isFinal) {
        if (!delivered.has(i)) { delivered.add(i); if (text) callbacks.onFinal(text); }
      } else if (text) interim.push(text);
    }
    callbacks.onInterim(interim.join(' '));
  };
  recognition.onerror = event => {
    if (event.error !== 'aborted') callbacks.onError(messages[event.error] ?? `Voice capture stopped (${event.error}). You can try again or keep typing.`);
    callbacks.onStatus('idle'); callbacks.onInterim('');
  };
  recognition.onend = () => { callbacks.onStatus('idle'); callbacks.onInterim(''); };
  callbacks.onStatus('starting');
  try { recognition.start(); }
  catch { callbacks.onStatus('idle'); throw new Error('Voice capture could not start. Check microphone access and try again.'); }
  return {
    stop() {
      callbacks.onStatus('stopping');
      try { recognition.stop(); }
      catch { callbacks.onStatus('idle'); }
    },
    cancel() {
      recognition.onresult = null; recognition.onstart = null; recognition.onerror = null; recognition.onend = null;
      try { recognition.abort(); } catch { /* Already stopped. */ }
    },
  };
}
