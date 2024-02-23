const Koa = require("koa");
const Router = require("@koa/router");
const { koaBody } = require("koa-body");
const { Pool } = require("pg");

const app = new Koa();
const router = new Router();

const pool = new Pool({
  host: "db",
  port: 5432,
  user: "admin",
  password: "123",
  database: "rinha",
});

const UPDATE_CUSTOMER_QUERY = `UPDATE clientes SET saldo = $1, transacoes = $2 WHERE id = $3;`;
const SELECT_CUSTOMER_BY_ID = (id) => `SELECT * FROM clientes WHERE id = ${id}`;

app.use(koaBody());

router.get("/clientes/:id/extrato", async (ctx) => {
  const customerId = parseInt(ctx.params.id);

  if (!customerId || customerId <= 0 || customerId > 5) {
    return (ctx.status = 404);
  }

  const { rows } = await pool.query(SELECT_CUSTOMER_BY_ID(customerId));

  ctx.status = 200;
  ctx.body = {
    saldo: {
      total: rows[0].saldo,
      data_extrato: new Date(),
      limite: rows[0].limite,
    },
    ultimas_transacoes: JSON.parse(rows[0].transacoes),
  };
});

router.post("/clientes/:id/transacoes", async (ctx) => {
  const customerId = parseInt(ctx.params.id);

  if (!customerId || customerId <= 0 || customerId > 5) {
    return (ctx.status = 404);
  }

  const { valor, tipo, descricao } = ctx.request.body;

  if (
    !valor ||
    typeof valor !== "number" ||
    valor <= 0 ||
    Math.floor(valor) !== valor
  ) {
    return (ctx.status = 422);
  }

  if (!["c", "d"].includes(tipo)) {
    return (ctx.status = 422);
  }

  if (
    !descricao ||
    typeof descricao !== "string" ||
    descricao.length <= 0 ||
    descricao.length > 10
  ) {
    return (ctx.status = 422);
  }

  const poolClient = await pool.connect();
  await poolClient.query("BEGIN");

  const result = await poolClient.query(
    SELECT_CUSTOMER_BY_ID(customerId) + " FOR UPDATE"
  );
  const [customer] = result.rows;

  const transactions = JSON.parse(customer.transacoes);

  if (tipo === "d" && customer.saldo - valor < -customer.limite) {
    await poolClient.query("ROLLBACK");
    poolClient.release();

    return (ctx.status = 422);
  }

  const newBalance =
    tipo === "c" ? customer.saldo + valor : customer.saldo - valor;

  if (transactions.length === 10) {
    transactions.pop();
  }

  transactions.unshift({
    descricao: descricao,
    tipo: tipo,
    valor: valor,
    realizada_em: new Date(),
  });

  await poolClient.query(UPDATE_CUSTOMER_QUERY, [
    newBalance,
    JSON.stringify(transactions),
    customerId,
  ]);

  await poolClient.query("COMMIT");
  poolClient.release();

  ctx.status = 200;
  ctx.body = {
    limite: customer.limite,
    saldo: newBalance,
  };
});

app.use(router.routes());

app.listen(process.env.API_PORT, () => {
  console.log(`[API ${process.env.API_PORT}] IS RUNNING`);
});
