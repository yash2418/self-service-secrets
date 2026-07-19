const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

// Populated from the sample-api-service-secret k8s Secret, which the AWS
// Secrets Store CSI driver syncs from Secrets Manager per the
// SecretProviderClass in this service's Kustomize Dev overlay.
const SECRET_ENV_VARS = ['DB_HOST', 'DB_PASSWORD', 'API_KEY'];

app.get('/healthz', (_req, res) => res.status(200).send('ok'));
app.get('/readyz', (_req, res) => res.status(200).send('ready'));

// Reports which secret-backed env vars resolved, without ever echoing values.
app.get('/debug/env-loaded', (_req, res) => {
  const loaded = Object.fromEntries(
    SECRET_ENV_VARS.map((name) => [name, Boolean(process.env[name])])
  );
  res.json(loaded);
});

app.listen(port, () => console.log(`sample-api-service listening on ${port}`));
