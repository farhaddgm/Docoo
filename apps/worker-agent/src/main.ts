import { runWorkerRuntime } from '@docoo/worker-runtime';

runWorkerRuntime({ workerName: 'docoo-worker-agent', taskQueue: 'docoo.agent' });
