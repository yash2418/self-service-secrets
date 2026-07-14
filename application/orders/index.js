import express from 'express';
import pg from 'pg';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;
const PRODUCT_CATALOG_URL = process.env.PRODUCT_CATALOG_URL || 'http://product-catalog:8080';
const PAYMENTS_URL = process.env.PAYMENTS_URL || 'http://payments:8080';

const pool = new pg.Pool({
  host: process.env.PGHOST || 'postgres',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || 'orders',
  password: process.env.PGPASSWORD || 'orders',
  database: process.env.PGDATABASE || 'orders',
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      total NUMERIC NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `);
}

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'orders' }));

app.get('/orders', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM orders ORDER BY id DESC LIMIT 50');
  res.json(rows);
});

app.post('/orders', async (req, res) => {
  const { productId, quantity } = req.body || {};
  if (!productId || !quantity) {
    return res.status(400).json({ error: 'productId and quantity are required' });
  }

  try {
    const productRes = await fetch(`${PRODUCT_CATALOG_URL}/products/${productId}`);
    if (!productRes.ok) return res.status(404).json({ error: 'product not found' });
    const product = await productRes.json();
    const total = product.price * quantity;

    console.log(`[orders] charging payments service for order of ${productId} x${quantity}`);
    const chargeRes = await fetch(`${PAYMENTS_URL}/charge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount: total, productId }),
    });

    if (!chargeRes.ok) {
      const detail = await chargeRes.text();
      return res.status(502).json({ error: 'payment failed', detail });
    }
    const charge = await chargeRes.json();

    const { rows } = await pool.query(
      'INSERT INTO orders (product_id, quantity, total, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [productId, quantity, total, charge.status]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[orders] failed to create order', err.message);
    res.status(502).json({ error: 'upstream call failed', detail: err.message });
  }
});

async function waitForDb(retries = 10, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await initDb();
      return;
    } catch (err) {
      console.error(`[orders] database not ready (attempt ${attempt}/${retries}): ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

waitForDb()
  .then(() => app.listen(PORT, () => console.log(`orders listening on :${PORT}`)))
  .catch((err) => {
    console.error('failed to initialize database', err);
    process.exit(1);
  });
