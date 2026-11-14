import { preview } from 'vite';

const server = await preview({ preview: { host: '127.0.0.1', port: 0, open: false } });
try {
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Missing preview address');
  const origin = `http://127.0.0.1:${address.port}`;
  const response = await fetch(origin, { signal: AbortSignal.timeout(5000) });
  const html = await response.text();
  if (!response.ok || !html.includes('<title>Encore</title>')) throw new Error('Preview failed');
  const asset = html.match(/src="([^"]+\.js)"/);
  if (!asset) throw new Error('Built entry missing');
  const bundle = await fetch(new URL(asset[1], origin), { signal: AbortSignal.timeout(5000) });
  if (!bundle.ok || !(await bundle.text()).includes('Simulation scaffold ready')) {
    throw new Error('Built application bundle unavailable');
  }
  console.log('Smoke passed: built page and application bundle served on loopback.');
} finally {
  await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
