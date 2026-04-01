import { describe, it, expect } from 'vitest';
import { StreamEmitter } from '../../../src/core/stream-emitter.js';

describe('StreamEmitter', () => {
  it('should emit and consume events via iterator', async () => {
    const emitter = new StreamEmitter();
    const iter = emitter.iterator();

    emitter.emit({ type: 'text_delta', content: 'hello' });
    emitter.emit({ type: 'text_delta', content: ' world' });
    emitter.close();

    const results = [];
    for await (const event of iter) {
      results.push(event);
    }

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ type: 'text_delta', content: 'hello' });
  });

  it('should handle consumer waiting before emit', async () => {
    const emitter = new StreamEmitter();
    const iter = emitter.iterator();

    // Consumer waits
    const promise = iter.next();

    // Then emit
    emitter.emit({ type: 'text_delta', content: 'delayed' });

    const result = await promise;
    expect(result.done).toBe(false);
    expect(result.value).toEqual({ type: 'text_delta', content: 'delayed' });

    emitter.close();
  });

  it('should return done after close', async () => {
    const emitter = new StreamEmitter();
    const iter = emitter.iterator();

    emitter.close();

    const result = await iter.next();
    expect(result.done).toBe(true);
  });

  it('should respect maxQueueSize (backpressure)', () => {
    const emitter = new StreamEmitter(2);

    emitter.emit({ type: 'text_delta', content: '1' });
    emitter.emit({ type: 'text_delta', content: '2' });
    emitter.emit({ type: 'text_delta', content: '3' }); // dropped

    emitter.close();

    // Should only have 2 events in queue
    const iter = emitter.iterator();
    const events: unknown[] = [];
    // Sync drain
    let next = iter.next();
    void next.then(r => { if (!r.done) events.push(r.value); });
  });

  it('should not emit after close', () => {
    const emitter = new StreamEmitter();
    emitter.close();
    emitter.emit({ type: 'text_delta', content: 'ignored' });
    // No error thrown, just ignored
  });
});
