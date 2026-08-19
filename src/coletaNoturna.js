'use strict';

const fs = require('fs');
const path = require('path');
const { criarClienteFootballData } = require('./schedulesFutebol');
const { criarClienteBalldontlie } = require('./schedulesBasquete');
const { criarClienteMlbStatsApi } = require('./schedulesBeisebol');
const db = require('./db');

function carregarWhitelist() {
  const caminho = path.join(process.cwd(), 'config', 'leagues-whitelist.json');
  const conteudo = fs.readFileSync(caminho, 'utf-8');
  return JSON.parse(conteudo);
}

/**
 * coletarFutebol — 1 chamada cobre TODAS as competições configuradas.
 */
async function coletarFutebol(config, hoje) {
  const ligasHabilitadas = (config.ligas || []).filter((l) => l.habilitada);
  if (ligasHabilitadas.length === 0) return { status: 'sem_ligas_habilitadas' };

  const cliente = criarClienteFootballData(process.env.FOOTBALL_DATA_API_KEY);
  const porCodigo = Object.fromEntries(ligasHabilitadas.map((l) => [l.codigo, l]));

  const jogos = await cliente.buscarJogosDoDia(ligasHabilitadas.map((l) => l.codigo), hoje);

  let gravados = 0;
  for (const jogo of jogos) {
    const ligaConfig = porCodigo[jogo.competition?.code];
    if (!ligaConfig) continue; // jogo de competição fora da nossa whitelist, ignora

    const ligaId = await db.upsertLiga({
      esporte: 'futebol',
      apiSportsId: ligaConfig.id_interno,
      nome: ligaConfig.nome,
      pais: ligaConfig.pais,
      pontosCorridos: ligaConfig.pontos_corridos,
    });

    const timeCasaId = await db.upsertTime({
      esporte: 'futebol',
      apiSportsId: jogo.homeTeam.id,
      nome: jogo.homeTeam.name,
      ligaId,
    });
    const timeVisitanteId = await db.upsertTime({
      esporte: 'futebol',
      apiSportsId: jogo.awayTeam.id,
      nome: jogo.awayTeam.name,
      ligaId,
    });

    await db.upsertFixture({
      esporte: 'futebol',
      apiSportsId: jogo.id,
      ligaId,
      timeCasaId,
      timeVisitanteId,
      temporada: new Date(jogo.utcDate).getFullYear(),
      dataHora: jogo.utcDate,
      status: jogo.status,
    });
    gravados += 1;
  }

  return { status: 'ok', jogos_coletados: jogos.length, jogos_gravados: gravados };
}

/**
 * coletarBasquete — 1 chamada por liga (NBA, WNBA são "paths" diferentes
 * no mesmo provedor, não dá pra combinar numa chamada só).
 */
async function coletarBasquete(config, hoje) {
  const ligasHabilitadas = (config.ligas || []).filter((l) => l.habilitada);
  if (ligasHabilitadas.length === 0) return { status: 'sem_ligas_habilitadas' };

  const cliente = criarClienteBalldontlie(process.env.BALLDONTLIE_API_KEY);
  const resultadoPorLiga = [];

  for (const ligaConfig of ligasHabilitadas) {
    try {
      const jogos = await cliente.buscarJogosDoDia(ligaConfig.path, hoje);

      const ligaId = await db.upsertLiga({
        esporte: 'basquete',
        apiSportsId: ligaConfig.id_interno,
        nome: ligaConfig.nome,
        pais: 'EUA',
        pontosCorridos: true,
      });

      let gravados = 0;
      for (const jogo of jogos) {
        const timeCasaId = await db.upsertTime({
          esporte: 'basquete',
          apiSportsId: jogo.home_team.id,
          nome: jogo.home_team.full_name,
          ligaId,
        });
        const timeVisitanteId = await db.upsertTime({
          esporte: 'basquete',
          apiSportsId: jogo.visitor_team.id,
          nome: jogo.visitor_team.full_name,
          ligaId,
        });

        await db.upsertFixture({
          esporte: 'basquete',
          apiSportsId: jogo.id,
          ligaId,
          timeCasaId,
          timeVisitanteId,
          temporada: jogo.season,
          dataHora: jogo.date,
          status: jogo.status,
        });
        gravados += 1;
      }

      resultadoPorLiga.push({ liga: ligaConfig.nome, status: 'ok', jogos_coletados: jogos.length, jogos_gravados: gravados });
    } catch (erro) {
      resultadoPorLiga.push({ liga: ligaConfig.nome, status: 'erro', erro: erro.message });
    }
  }

  return { status: 'ok', resultado_por_liga: resultadoPorLiga };
}

/**
 * coletarBeisebol — MLB Stats API, sem chave, sem limite conhecido.
 */
async function coletarBeisebol(config, hoje) {
  const ligasHabilitadas = (config.ligas || []).filter((l) => l.habilitada);
  if (ligasHabilitadas.length === 0) return { status: 'sem_ligas_habilitadas' };

  const cliente = criarClienteMlbStatsApi();
  const resultadoPorLiga = [];

  for (const ligaConfig of ligasHabilitadas) {
    try {
      const jogos = await cliente.buscarJogosDoDia(ligaConfig.sportId, hoje);

      const ligaId = await db.upsertLiga({
        esporte: 'beisebol',
        apiSportsId: ligaConfig.id_interno,
        nome: ligaConfig.nome,
        pais: 'EUA',
        pontosCorridos: true,
      });

      let gravados = 0;
      for (const jogo of jogos) {
        const timeCasaId = await db.upsertTime({
          esporte: 'beisebol',
          apiSportsId: jogo.teams.home.team.id,
          nome: jogo.teams.home.team.name,
          ligaId,
        });
        const timeVisitanteId = await db.upsertTime({
          esporte: 'beisebol',
          apiSportsId: jogo.teams.away.team.id,
          nome: jogo.teams.away.team.name,
          ligaId,
        });

        await db.upsertFixture({
          esporte: 'beisebol',
          apiSportsId: jogo.gamePk,
          ligaId,
          timeCasaId,
          timeVisitanteId,
          temporada: new Date(jogo.gameDate).getFullYear(),
          dataHora: jogo.gameDate,
          status: jogo.status?.detailedState ?? null,
        });
        gravados += 1;
      }

      resultadoPorLiga.push({ liga: ligaConfig.nome, status: 'ok', jogos_coletados: jogos.length, jogos_gravados: gravados });
    } catch (erro) {
      resultadoPorLiga.push({ liga: ligaConfig.nome, status: 'erro', erro: erro.message });
    }
  }

  return { status: 'ok', resultado_por_liga: resultadoPorLiga };
}

/**
 * rodarColetaNoturna()
 * Versão sem controle de cota (as 3 fontes gratuitas não têm o problema
 * de temporada bloqueada nem limite apertado da API-Sports). Erro num
 * esporte não afeta os outros.
 */
async function rodarColetaNoturna() {
  const inicio = Date.now();
  const hoje = new Date().toISOString().slice(0, 10);
  const whitelist = carregarWhitelist();

  const resultadoPorEsporte = {};

  try {
    resultadoPorEsporte.futebol = await coletarFutebol(whitelist.futebol || {}, hoje);
  } catch (erro) {
    resultadoPorEsporte.futebol = { status: 'erro', erro: erro.message };
  }

  try {
    resultadoPorEsporte.basquete = await coletarBasquete(whitelist.basquete || {}, hoje);
  } catch (erro) {
    resultadoPorEsporte.basquete = { status: 'erro', erro: erro.message };
  }

  try {
    resultadoPorEsporte.beisebol = await coletarBeisebol(whitelist.beisebol || {}, hoje);
  } catch (erro) {
    resultadoPorEsporte.beisebol = { status: 'erro', erro: erro.message };
  }

  return {
    sucesso: true,
    tempo_ms: Date.now() - inicio,
    data_rodada: hoje,
    resultado_por_esporte: resultadoPorEsporte,
  };
}

module.exports = { rodarColetaNoturna };
