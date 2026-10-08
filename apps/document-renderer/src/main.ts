import { createRendererServer } from './server.js';
import { verifyChromiumSandbox } from '@docoo/documents';
if (process.env['NODE_ENV'] === 'production') await verifyChromiumSandbox();
createRendererServer(process.env['PDF_RENDERER_TOKEN'] ?? '').listen(4100, '0.0.0.0');
