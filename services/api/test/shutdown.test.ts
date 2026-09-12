/**
 * The shutdown mechanism, on a bare server.
 *
 * Authority: Phase 7B.6 §78, §151
 *
 * WHY NOT AGAINST THE REAL API. Reproducing the hang needs a COMPLETED request
 * whose response stays open — which is exactly an SSE stream, which needs the
 * student routes, which need a Supabase configuration this environment does not
 * have. So the mechanism is exercised on a plain `http.Server` holding a
 * response open the way the SSE route does. Same Node API, same failure.
 *
 * A PARTIAL REQUEST IS NOT ENOUGH, and a first attempt at this used one and
 * passed while proving nothing: `closeIdleConnections` treats an incomplete
 * request as idle and closes it. The connection has to be a completed request
 * with an open response for the failure to appear at all.
 *
 * AND THE CLIENT HAS TO BE A RAW SOCKET. A second attempt used `fetch`, and it
 * was flaky under full-suite load: once nothing is holding the response body,
 * the HTTP client is free to tear the connection down, which lets `close()`
 * finish and makes the test claim there was never a bug. A `net.Socket` this
 * file owns is released when this file says so and not before.
 */

import { createServer, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';

/**
 * A server with one open, never-ended response, and the socket holding it.
 *
 * The request is complete — headers and the blank line — so the server has
 * dispatched it and is waiting on a response that never comes. That is what an
 * SSE connection looks like to `server.close()`.
 */
async function serverHoldingAStream(): Promise<{ server: Server; socket: Socket }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': open\n\n');
    /* Deliberately never ended. */
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;

  const socket = connect(port, '127.0.0.1');
  socket.on('error', () => {
    /* Torn down at the end of the test; an error here is not a failure. */
  });

  /* Resolve once the server has answered, so the response is genuinely open. */
  await new Promise<void>((ok) => {
    socket.once('data', () => ok());
    socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n');
  });

  return { server, socket };
}

describe('shutting down with a stream open', () => {
  /*
   * THE BUG. `server.close()` stops accepting and then waits for open
   * connections to finish — and a notification stream is designed never to
   * finish. Left like this, every rolling deploy waits for SIGKILL.
   */
  it('does not finish on close() alone while a stream is open', async () => {
    const { server, socket } = await serverHoldingAStream();
    try {
      const closed = new Promise<'closed'>((ok) => server.close(() => ok('closed')));
      const stillOpen = new Promise<'open'>((ok) => setTimeout(() => ok('open'), 1000));
      expect(await Promise.race([closed, stillOpen])).toBe('open');
    } finally {
      socket.destroy();
      server.closeAllConnections();
    }
  });

  /* THE FIX. Node's own, so there is nothing to track by hand. */
  it('finishes once the grace period ends the connections', async () => {
    const { server, socket } = await serverHoldingAStream();
    try {
      const closed = new Promise<'closed'>((ok) => server.close(() => ok('closed')));
      setTimeout(() => server.closeAllConnections(), 250);
      const timedOut = new Promise<'hung'>((ok) => setTimeout(() => ok('hung'), 5000));
      expect(await Promise.race([closed, timedOut])).toBe('closed');
    } finally {
      socket.destroy();
    }
  });
});
