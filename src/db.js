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

async function upsertLiga({ esporte, apiSportsId, nome, pais, pontosCorridos }) {
  const resultado = await query(
    `INSERT INTO leagues (esporte, api_sports_id, nome, pais, pontos_corridos)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (esporte, api_sports_id) DO UPDATE SET nome = EXCLUDED.nome
     RETURNING id`,
    [esporte, apiSportsId, nome, pais, pontosCorridos]
  );
  return resultado.rows[0].id;
}

async function upsertTime({ esporte, apiSportsId, nome, ligaId }) {
  const resultado = await query(
    `INSERT INTO teams (esporte, api_sports_id, nome, liga_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (esporte, api_sports_id) DO UPDATE SET nome = EXCLUDED.nome
     RETURNING id`,
    [esporte, apiSportsId, nome, ligaId]
  );
  return resultado.rows[0].id;
}

async function upsertFixture({ esporte, apiSportsId, ligaId, timeCasaId, timeVisitanteId, temporada, dataHora, status }) {
  const resultado = await query(
    `INSERT INTO fixtures (esporte, api_sports_id, liga_id, time_casa_id, time_visitante_id, temporada, data_hora, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (esporte, api_sports_id) DO UPDATE SET
       status = EXCLUDED.status, data_hora = EXCLUDED.data_hora, atualizado_em = now()
     RETURNING id`,
    [esporte, apiSportsId, ligaId, timeCasaId, timeVisitanteId, temporada, dataHora, status]
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

/** Cota diária — evita estourar as 100 req/dia da API-Sports sem perceber. Cada esporte tem cota própria. */
async function registrarUsoApiSports(esporte, quantidade = 1) {
  const hoje = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO api_sports_uso_diario (data, esporte, requisicoes_usadas)
     VALUES ($1, $2, $3)
     ON CONFLICT (data, esporte) DO UPDATE SET
       requisicoes_usadas = api_sports_uso_diario.requisicoes_usadas + $3,
       atualizado_em = now()`,
    [hoje, esporte, quantidade]
  );
}

async function obterUsoApiSportsHoje(esporte) {
  const hoje = new Date().toISOString().slice(0, 10);
  const resultado = await query(
    `SELECT requisicoes_usadas FROM api_sports_uso_diario WHERE data = $1 AND esporte = $2`,
    [hoje, esporte]
  );
  return resultado.rows[0]?.requisicoes_usadas ?? 0;
}

/**
 * obterFixturesDoDiaComOdds()
 * Traz os jogos coletados hoje + nomes dos times + liga + primeira e última
 * odd de moneyline/1x2 capturadas (pra calcular volume de movimento no score
 * de hype). Não calcula nada — só junta os dados brutos.
 */
async function obterFixturesDoDiaComOdds() {
  const hoje = new Date().toISOString().slice(0, 10);
  const resultado = await query(
    `SELECT
       f.id, f.api_sports_id, f.esporte, f.data_hora, f.status,
       l.api_sports_id AS liga_api_sports_id, l.nome AS liga_nome,
       tc.nome AS time_casa, tv.nome AS time_visitante
     FROM fixtures f
     JOIN leagues l ON l.id = f.liga_id
     JOIN teams tc ON tc.id = f.time_casa_id
     JOIN teams tv ON tv.id = f.time_visitante_id
     WHERE f.data_hora::date = $1
     ORDER BY f.data_hora ASC`,
    [hoje]
  );

  // Busca abertura/atual separadamente por fixture (mais simples e legível
  // que uma janela SQL complexa embutida acima).
  const fixtures = [];
  for (const linha of resultado.rows) {
    const movimento = await query(
      `SELECT mercado, selecao, valor, capturado_em
       FROM odds_snapshots
       WHERE fixture_id = $1
       ORDER BY capturado_em ASC`,
      [linha.id]
    );
    fixtures.push({
      id: linha.id,
      apiSportsId: linha.api_sports_id,
      esporte: linha.esporte,
      dataHora: linha.data_hora,
      status: linha.status,
      ligaApiSportsId: linha.liga_api_sports_id,
      ligaNome: linha.liga_nome,
      timeCasa: linha.time_casa,
      timeVisitante: linha.time_visitante,
      snapshotsOdds: movimento.rows,
    });
  }
  return fixtures;
}

async function marcarFixtureAprovado(fixtureId, aprovado) {
  await query(`UPDATE fixtures SET aprovado_glv = $2 WHERE id = $1`, [fixtureId, aprovado]);
}

async function obterFixturePorId(fixtureId) {
  const resultado = await query(
    `SELECT
       f.id, f.api_sports_id, f.esporte, f.data_hora, f.temporada,
       l.api_sports_id AS liga_api_sports_id, l.nome AS liga_nome,
       tc.id AS time_casa_id, tc.nome AS time_casa, tc.api_sports_id AS time_casa_api_sports_id,
       tv.id AS time_visitante_id, tv.nome AS time_visitante, tv.api_sports_id AS time_visitante_api_sports_id
     FROM fixtures f
     JOIN leagues l ON l.id = f.liga_id
     JOIN teams tc ON tc.id = f.time_casa_id
     JOIN teams tv ON tv.id = f.time_visitante_id
     WHERE f.id = $1`,
    [fixtureId]
  );
  if (resultado.rows.length === 0) return null;

  const fixture = resultado.rows[0];

  const odds = await query(
    `SELECT DISTINCT ON (mercado, selecao) mercado, selecao, valor, capturado_em
     FROM odds_snapshots WHERE fixture_id = $1
     ORDER BY mercado, selecao, capturado_em DESC`,
    [fixtureId]
  );

  const statsCasa = await query(
    `SELECT dados FROM team_stats WHERE team_id = $1 AND temporada = $2`,
    [fixture.time_casa_id, fixture.temporada]
  );
  const statsVisitante = await query(
    `SELECT dados FROM team_stats WHERE team_id = $1 AND temporada = $2`,
    [fixture.time_visitante_id, fixture.temporada]
  );

  return {
    ...fixture,
    oddsAtuais: odds.rows,
    statsCasa: statsCasa.rows[0]?.dados ?? null,
    statsVisitante: statsVisitante.rows[0]?.dados ?? null,
  };
}

/**
 * inserirOddsApiSnapshots(eventos)
 * Grava snapshots da The Odds API — tabela própria (odds_api_snapshots),
 * sem tentar casar com fixtures da API-Sports (provedores diferentes têm
 * IDs diferentes; casar por nome de time é responsabilidade de quem
 * consome, não deste gravador).
 */
async function inserirOddsApiSnapshots(eventos) {
  for (const evento of eventos) {
    for (const snapshot of evento.snapshots) {
      // eslint-disable-next-line no-await-in-loop
      await query(
        `INSERT INTO odds_api_snapshots
           (sport_key, evento_id, time_casa, time_visitante, comeca_em, bookmaker, mercado, selecao, valor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          evento.sportKey,
          evento.eventoId,
          evento.timeCasa,
          evento.timeVisitante,
          evento.comecaEm,
          snapshot.bookmaker,
          snapshot.mercado,
          snapshot.selecao,
          snapshot.valor,
        ]
      );
    }
  }
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
  obterFixturesDoDiaComOdds,
  marcarFixtureAprovado,
  obterFixturePorId,
  inserirOddsApiSnapshots,
};
