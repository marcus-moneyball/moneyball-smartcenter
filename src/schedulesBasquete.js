'use strict';

const BASE_URL = 'https://api.balldontlie.io';

/**
 * Cliente da balldontlie.io — free tier genuíno (5 req/min), cobre NBA e
 * WNBA no mesmo provedor, cada liga é um "path" diferente (/nba/v1/games,
 * /wnba/v1/games), não um parâmetro de liga.
 */
function criarClienteBalldontlie(apiKey) {
  if (!apiKey) {
    throw new Error('BALLDONTLIE_API_KEY ausente — configure via variável de ambiente.');
  }

  async function buscarJogosDoDia(path, data) {
    const url = new URL(`${BASE_URL}/${path}/v1/games`);
    url.searchParams.append('dates[]', data);

    const resposta = await fetch(url, { headers: { Authorization: apiKey } });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      throw new Error(`balldontlie (${path}) retornou HTTP ${resposta.status}: ${corpo.slice(0, 200)}`);
    }

    const dados = await resposta.json();
    return dados.data || [];
  }

  /**
   * buscarJogosFinalizadosPorPeriodo — usada só pela calibração estatística
   * (scripts/calibrarBasquete.js), nunca pela coleta diária. Pagina via
   * cursor (padrão da balldontlie v1) até esgotar o período ou o cursor.
   *
   * @returns {Promise<{jogos: Array, proximoCursor: number|null}>}
   */
  async function buscarJogosFinalizadosPorPeriodo(path, { dataInicio, dataFim, cursor, perPage = 100 }) {
    const url = new URL(`${BASE_URL}/${path}/v1/games`);
    url.searchParams.append('start_date', dataInicio);
    url.searchParams.append('end_date', dataFim);
    url.searchParams.append('per_page', String(perPage));
    if (cursor) url.searchParams.append('cursor', String(cursor));

    const resposta = await fetch(url, { headers: { Authorization: apiKey } });

    if (!resposta.ok) {
      const corpo = await resposta.text();
      throw new Error(`balldontlie (${path}) retornou HTTP ${resposta.status}: ${corpo.slice(0, 200)}`);
    }

    const dados = await resposta.json();
    const jogos = (dados.data || []).filter(
      (j) => j.status === 'Final' && Number.isFinite(j.home_team_score) && Number.isFinite(j.visitor_team_score)
    );

    return { jogos, proximoCursor: dados.meta?.next_cursor ?? null };
  }

  return { buscarJogosDoDia, buscarJogosFinalizadosPorPeriodo };
}

module.exports = { criarClienteBalldontlie };
