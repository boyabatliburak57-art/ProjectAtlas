import { writeFile } from 'node:fs/promises';

const [image, runId, drillId, output] = process.argv.slice(2);
if (
  image === undefined ||
  !/@sha256:[a-f0-9]{64}$/u.test(image) ||
  runId === undefined ||
  !/^\d+$/u.test(runId) ||
  drillId === undefined ||
  !/^[0-9a-f-]{36}$/iu.test(drillId) ||
  output === undefined
)
  throw new Error(
    'usage: render-recovery-gate-job.mjs <immutable-image> <run-id> <drill-id> <output>',
  );

const job = `apiVersion: batch/v1
kind: Job
metadata:
  name: atlas-recovery-gate-${runId}
  namespace: atlas
  labels:
    app.kubernetes.io/name: atlas-recovery-gate
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 300
  ttlSecondsAfterFinished: 86400
  template:
    metadata:
      labels:
        app.kubernetes.io/name: atlas-recovery-gate
    spec:
      restartPolicy: Never
      serviceAccountName: atlas-recovery
      containers:
        - name: recovery-gate
          image: ${image}
          imagePullPolicy: IfNotPresent
          command:
            - node
            - packages/database/dist/src/cli/verify-recovery-gate.js
          env:
            - name: RECOVERY_DRILL_ID
              value: ${drillId}
          envFrom:
            - configMapRef:
                name: atlas-runtime-config
            - secretRef:
                name: atlas-restore-secrets
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 250m
              memory: 256Mi
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: [ALL]
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            seccompProfile:
              type: RuntimeDefault
`;

await writeFile(output, job, 'utf8');
