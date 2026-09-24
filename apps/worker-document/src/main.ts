import { runWorkerRuntime } from '@docoo/worker-runtime';

runWorkerRuntime({ workerName: 'docoo-worker-document', taskQueue: 'docoo.document' });
