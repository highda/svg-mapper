#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';

const [portFile] = process.argv.slice(2);
if (!portFile) throw new Error('Usage: github-connect-proxy.mjs <port-file>');

function allowed(host) {
  return host === 'github.com' || host.endsWith('.github.com') ||
    host.endsWith('.githubusercontent.com') ||
    host === 'registry.npmjs.org' || host === 'registry.yarnpkg.com';
}

const server = net.createServer((client) => {
  client.once('data', (chunk) => {
    const [method, authority] = chunk.toString('latin1').split(/\s+/, 3);
    const [host, portText] = (authority ?? '').split(':');
    const port = Number(portText);
    if (method !== 'CONNECT' || !allowed(host) || port !== 443) {
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = net.connect({ host, port }, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      client.pipe(upstream).pipe(client);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
});

server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(portFile, String(server.address().port), { mode: 0o600 });
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
