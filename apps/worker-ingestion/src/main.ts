import { runWorkerRuntime } from '@docoo/worker-runtime';

runWorkerRuntime({ workerName: 'docoo-worker-ingestion', taskQueue: 'docoo.ingestion' });
