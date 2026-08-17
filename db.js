'use strict';

const { Pool } = require('pg');

/**
 * Pool de conexão compartilhado. Vercel serverless reaproveita a instância
 * entre invocações "quentes" — criar o Pool fora de qualquer função (nível
 * de módulo) evita abrir uma conexão nova a cada requisição.
 *
 * Requer DATABASE_URL nas variáveis de ambiente (connection string do
 * Postgres — Neon, Supabase, Vercel Postgres, qualquer um serve).
 */
let pool;

function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL ausente — configure a connection string do Postgres.');
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }, // necessário pra a maioria dos provedores gerenciados (Neon, Supabase)
      max: 5, // serverless: poucas conexões simultâneas por instância
    });
  }
  return pool;
}

/** Executa uma query simples. Use pra INSERT/UPDATE/SELECT pontuais. */
async function query(texto, parametros) {
  return getPool().query(texto, parametros);
}

/**
 * upsertLiga / upsertTime / upsertFixture / inserirOddsSnapshots — funções
 * de escrita específicas do domínio, pra não espalhar SQL cru pelo resto do
 * código. Todas idempotentes (ON CONFLICT), seguro rodar o cron várias vezes.
 */

async function upsertLiga({ apiSportsId, nome, pais, pontosCorridos }) {
  const resultado = await query(
    `INSERT INTO leagues (api_sports_id, nome, pais, pontos_corridos)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (api_sports_id) DO UPDATE SET nome = EXCLUDED.nome
     RETURNING id`,
    [apiSportsId, nome, pais, pontosCorridos]
  );
  return resultado.rows[0].id;
}

async function upsertTime({ apiSportsId, nome, ligaId }) {
  const resultado = await query(
    `INSERT INTO teams (api_sports_id, nome, liga_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (api_sports_id) DO UPDATE SET nome = EXCLUDED.nome
     RETURNING id`,
    [apiSportsId, nome, ligaId]
  );
  return resultado.rows[0].id;
}

async function upsertFixture({ apiSportsId, ligaId, timeCasaId, timeVisitanteId, temporada, dataHora, status }) {
  const resultado = await query(
    `INSERT INTO fixtures (api_sports_id, liga_id, time_casa_id, time_visitante_id, temporada, data_hora, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (api_sports_id) DO UPDATE SET
       status = EXCLUDED.status, data_hora = EXCLUDED.data_hora, atualizado_em = now()
     RETURNING id`,
    [apiSportsId, ligaId, timeCasaId, timeVisitanteId, temporada, dataHora, status]
  );
  return resultado.rows[0].id;
}

async function inserirOddsSnapshots(fixtureId, snapshots) {
  if (snapshots.length === 0) return;
  const valores = [];
  const placeholders = snapshots
    .map((s, i) => {
      const base = i * 3;
      valores.push(fixtureId, s.mercado, s.selecao, s.valor);
      return `($1, $${base + 2}, $${base + 3}, $${base + 4})`;
    })
    .join(', ');
  // Nota: fixtureId é $1 fixo, repetido em cada linha via SQL abaixo (mais simples que recalcular índices por linha)
  await query(
    `INSERT INTO odds_snapshots (fixture_id, mercado, selecao, valor)
     SELECT $1, m, s, v FROM UNNEST($2::text[], $3::text[], $4::numeric[]) AS t(m, s, v)`,
    [fixtureId, snapshots.map((s) => s.mercado), snapshots.map((s) => s.selecao), snapshots.map((s) => s.valor)]
  );
}

async function statsDeTimeEstaoFrescas(teamId, temporada, diasValidade = 5) {
  const resultado = await query(
    `SELECT atualizado_em FROM team_stats
     WHERE team_id = $1 AND temporada = $2
       AND atualizado_em > now() - ($3 || ' days')::interval`,
    [teamId, temporada, diasValidade]
  );
  return resultado.rows.length > 0;
}

async function salvarStatsDeTime(teamId, temporada, dados) {
  await query(
    `INSERT INTO team_stats (team_id, temporada, dados)
     VALUES ($1, $2, $3)
     ON CONFLICT (team_id, temporada) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = now()`,
    [teamId, temporada, JSON.stringify(dados)]
  );
}

/** Cota diária — evita estourar as 100 req/dia da API-Sports sem perceber. */
async function registrarUsoApiSports(quantidade = 1) {
  const hoje = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO api_sports_uso_diario (data, requisicoes_usadas)
     VALUES ($1, $2)
     ON CONFLICT (data) DO UPDATE SET
       requisicoes_usadas = api_sports_uso_diario.requisicoes_usadas + $2,
       atualizado_em = now()`,
    [hoje, quantidade]
  );
}

async function obterUsoApiSportsHoje() {
  const hoje = new Date().toISOString().slice(0, 10);
  const resultado = await query(
    `SELECT requisicoes_usadas FROM api_sports_uso_diario WHERE data = $1`,
    [hoje]
  );
  return resultado.rows[0]?.requisicoes_usadas ?? 0;
}

module.exports = {
  query,
  upsertLiga,
  upsertTime,
  upsertFixture,
  inserirOddsSnapshots,
  statsDeTimeEstaoFrescas,
  salvarStatsDeTime,
  registrarUsoApiSports,
  obterUsoApiSportsHoje,
};
