import { createRendererServer } from './server.js';
createRendererServer(process.env['PDF_RENDERER_TOKEN'] ?? '').listen(4100, '0.0.0.0');
