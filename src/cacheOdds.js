'use strict';

const { Client } = require('pg');

/**
 * Cache simples baseado em Postgres (o DATABASE_URL do SmartCenter, que
 * hoje não tinha uso nenhum). Existe pra economizar chamadas de APIs
 * pagas por volume (Odds API principalmente) -- se o mesmo dado foi
 * buscado há menos de TTL_MINUTOS, devolve do cache em vez de gastar
 * chamada nova.
 *
 * TTL configurável via CACHE_ODDS_TTL_MINUTOS (padrão 10 min) -- curto o
 * suficiente pra não atrasar o cron de verdade (que roda 1x/dia), mas
 * evita gasto duplicado quando você testa manualmente várias vezes
 * seguidas.
 *
 * Fail-open: se o banco falhar por qualquer motivo, busca direto sem
 * cache -- nunca quebra a coleta por causa disso.
 */

const TTL_MINUTOS = Number(process.env.CACHE_ODDS_TTL_MINUTOS) || 10;

async function comCliente(fn) {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function garantirTabela(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS smartcenter_cache (
      chave TEXT PRIMARY KEY,
      valor JSONB NOT NULL,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

/**
 * @param {string} chave - identificador único do que está sendo cacheado (ex: "odds:soccer_epl")
 * @param {() => Promise<any>} buscarDados - função que busca o dado de verdade quando o cache não serve
 * @returns {Promise<any>}
 */
async function buscarComCache(chave, buscarDados) {
  if (!process.env.DATABASE_URL) {
    console.warn('[CACHE] DATABASE_URL não configurada -- buscando direto, sem cache.');
    return buscarDados();
  }

  try {
    return await comCliente(async (client) => {
      await garantirTabela(client);

      const resultado = await client.query(
        'SELECT valor, atualizado_em FROM smartcenter_cache WHERE chave = $1',
        [chave]
      );

      if (resultado.rows.length > 0) {
        const idadeMinutos = (Date.now() - new Date(resultado.rows[0].atualizado_em).getTime()) / 60000;
        if (idadeMinutos < TTL_MINUTOS) {
          console.log(`[CACHE] "${chave}" servido do cache (${idadeMinutos.toFixed(1)} min atrás).`);
          return resultado.rows[0].valor;
        }
      }

      const dadosFrescos = await buscarDados();

      await client.query(
        `INSERT INTO smartcenter_cache (chave, valor, atualizado_em) VALUES ($1, $2, now())
         ON CONFLICT (chave) DO UPDATE SET valor = $2, atualizado_em = now()`,
        [chave, JSON.stringify(dadosFrescos)]
      );

      return dadosFrescos;
    });
  } catch (erro) {
    console.warn(`[CACHE] Falha no cache (fail-open, buscando direto): ${erro.message}`);
    return buscarDados();
  }
}

module.exports = { buscarComCache };
