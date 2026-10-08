import { describe, expect, it, vi } from 'vitest';
import { startDictation, type SpeechEngine } from './dictation';
class FakeSpeech implements SpeechEngine {
  static latest: FakeSpeech;
  constructor() { FakeSpeech.latest = this; }
  lang = ''; continuous = false; interimResults = false;
  onstart: SpeechEngine['onstart'] = null;
  onresult: SpeechEngine['onresult'] = null;
  onerror: SpeechEngine['onerror'] = null;
  onend: SpeechEngine['onend'] = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
}
const callbacks = () => ({ onFinal: vi.fn(), onInterim: vi.fn(), onStatus: vi.fn(), onError: vi.fn() });
describe('dictation', () => {
  it('keeps tentative words separate and appends each final segment only once', () => {
    const cb = callbacks(); startDictation(cb, FakeSpeech);
    const engine = FakeSpeech.latest;
    expect(engine.continuous).toBe(true); expect(engine.interimResults).toBe(true);
    engine.onresult?.({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: ' Learn Python ' } }] });
    expect(cb.onInterim).toHaveBeenLastCalledWith('Learn Python'); expect(cb.onFinal).not.toHaveBeenCalled();
    const results = [{ isFinal: true, 0: { transcript: ' Learn Python ' } }, { isFinal: true, 0: { transcript: 'and database indexes' } }];
    engine.onresult?.({ resultIndex: 0, results }); engine.onresult?.({ resultIndex: 1, results });
    expect(cb.onFinal.mock.calls).toEqual([['Learn Python'], ['and database indexes']]);
    expect(cb.onInterim).toHaveBeenLastCalledWith('');
  });
  it('stops and ends recording, with an idle state', () => {
    const cb = callbacks(); const session = startDictation(cb, FakeSpeech); session.stop();
    expect(FakeSpeech.latest.stop).toHaveBeenCalledOnce(); expect(cb.onStatus).toHaveBeenLastCalledWith('idle');
  });
  it('reports actionable microphone permission errors', () => {
    const cb = callbacks(); startDictation(cb, FakeSpeech); FakeSpeech.latest.onerror?.({ error: 'not-allowed' });
    expect(cb.onError).toHaveBeenCalledWith(expect.stringContaining('Microphone access was denied'));
    expect(cb.onStatus).toHaveBeenLastCalledWith('idle');
  });
  it('detaches callbacks and aborts on dismissal', () => {
    const cb = callbacks(); const session = startDictation(cb, FakeSpeech); session.cancel();
    expect(FakeSpeech.latest.abort).toHaveBeenCalledOnce(); expect(FakeSpeech.latest.onresult).toBeNull(); expect(FakeSpeech.latest.onend).toBeNull();
  });
  it('rejects unavailable speech engines and resets failed starts', () => {
    expect(() => startDictation(callbacks())).toThrow('unavailable');
    class Failed extends FakeSpeech { start = vi.fn(() => { throw new Error('Denied'); }); }
    const cb = callbacks(); expect(() => startDictation(cb, Failed)).toThrow('could not start');
    expect(cb.onStatus).toHaveBeenLastCalledWith('idle');
  });
});
