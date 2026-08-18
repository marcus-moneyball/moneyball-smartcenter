'use strict';

const fs = require('fs');
const path = require('path');
const { criarClienteApiSports, LIMITE_DIARIO } = require('./apiSportsService');
const db = require('./db');

function carregarWhitelist() {
  const caminho = path.join(process.cwd(), 'config', 'leagues-whitelist.json');
  const conteudo = fs.readFileSync(caminho, 'utf-8');
  return JSON.parse(conteudo);
}

/**
 * coletarUmEsporte(esporte, ligasHabilitadas, opcoes)
 * Roda a coleta de fixtures+odds+stats de UM esporte, respeitando a cota
 * própria daquele produto (100/dia, independente dos outros esportes).
 */
async function coletarUmEsporte(esporte, ligasHabilitadas, opcoes) {
  const { apiKey, hoje, temporadaAtual, margemSeguranca } = opcoes;
  const cliente = criarClienteApiSports(apiKey, esporte);

  const usoJaFeito = await db.obterUsoApiSportsHoje(esporte);
  let requisicoesUsadasNestaExecucao = 0;

  async function orcamentoDisponivel() {
    return usoJaFeito + requisicoesUsadasNestaExecucao < LIMITE_DIARIO - margemSeguranca;
  }
  async function registrarChamada() {
    requisicoesUsadasNestaExecucao += 1;
    await db.registrarUsoApiSports(esporte, 1);
  }

  const resultadoPorLiga = [];

  for (const liga of ligasHabilitadas) {
    if (!(await orcamentoDisponivel())) {
      resultadoPorLiga.push({ liga: liga.nome, status: 'pulada_orcamento_esgotado' });
      continue;
    }

    try {
      const ligaId = await db.upsertLiga({
        esporte,
        apiSportsId: liga.api_sports_id,
        nome: liga.nome,
        pais: liga.pais,
        pontosCorridos: liga.pontos_corridos,
      });

      const jogosBrutos = await cliente.buscarJogosPorLigaEData(liga.api_sports_id, hoje, temporadaAtual);
      await registrarChamada();

      if (jogosBrutos.length === 0) {
        resultadoPorLiga.push({ liga: liga.nome, status: 'sem_jogos_hoje' });
        continue;
      }

      const fixtureIdsInternos = [];
      const timesParaStats = new Set();

      for (const item of jogosBrutos) {
        // NOTA: campo "fixture"/"id" varia entre produtos — football usa
        // item.fixture.{id,date,status}, basketball/baseball tendem a usar
        // item.{id,date,status} direto no topo. Verifique contra uma
        // resposta real se algo vier undefined.
        const idJogo = item.fixture?.id ?? item.id;
        const dataJogo = item.fixture?.date ?? item.date;
        const statusJogo = item.fixture?.status?.short ?? item.status?.short ?? null;

        const timeCasaId = await db.upsertTime({
          esporte,
          apiSportsId: item.teams.home.id,
          nome: item.teams.home.name,
          ligaId,
        });
        const timeVisitanteId = await db.upsertTime({
          esporte,
          apiSportsId: item.teams.away.id,
          nome: item.teams.away.name,
          ligaId,
        });

        const fixtureId = await db.upsertFixture({
          esporte,
          apiSportsId: idJogo,
          ligaId,
          timeCasaId,
          timeVisitanteId,
          temporada: temporadaAtual,
          dataHora: dataJogo,
          status: statusJogo,
        });

        fixtureIdsInternos.push({ apiSportsId: idJogo, id: fixtureId });
        timesParaStats.add(JSON.stringify({ apiSportsId: item.teams.home.id, id: timeCasaId }));
        timesParaStats.add(JSON.stringify({ apiSportsId: item.teams.away.id, id: timeVisitanteId }));
      }

      let oddsInseridas = 0;
      if (await orcamentoDisponivel()) {
        const oddsBrutas = await cliente.buscarOddsPorLigaEData(liga.api_sports_id, hoje, temporadaAtual);
        await registrarChamada();

        for (const itemOdds of oddsBrutas) {
          const idJogoOdds = itemOdds.fixture?.id ?? itemOdds.game?.id ?? itemOdds.id;
          const fixtureCorrespondente = fixtureIdsInternos.find((f) => f.apiSportsId === idJogoOdds);
          if (!fixtureCorrespondente) continue;

          const snapshots = [];
          for (const bookmaker of itemOdds.bookmakers ?? []) {
            for (const bet of bookmaker.bets ?? []) {
              for (const valorAposta of bet.values ?? []) {
                snapshots.push({
                  mercado: bet.name,
                  selecao: `${bookmaker.name}:${valorAposta.value}`,
                  valor: Number(valorAposta.odd),
                });
              }
            }
          }
          await db.inserirOddsSnapshots(fixtureCorrespondente.id, snapshots);
          oddsInseridas += snapshots.length;
        }
      }

      let statsAtualizadas = 0;
      for (const timeSerializado of timesParaStats) {
        if (!(await orcamentoDisponivel())) break;
        const time = JSON.parse(timeSerializado);
        const fresca = await db.statsDeTimeEstaoFrescas(time.id, temporadaAtual);
        if (fresca) continue;

        const stats = await cliente.buscarEstatisticasDeTime(time.apiSportsId, liga.api_sports_id, temporadaAtual);
        await registrarChamada();
        await db.salvarStatsDeTime(time.id, temporadaAtual, stats);
        statsAtualizadas += 1;
      }

      resultadoPorLiga.push({
        liga: liga.nome,
        status: 'ok',
        jogos_coletados: jogosBrutos.length,
        odds_inseridas: oddsInseridas,
        stats_de_time_atualizadas: statsAtualizadas,
      });
    } catch (erro) {
      resultadoPorLiga.push({ liga: liga.nome, status: 'erro', erro: erro.message });
    }
  }

  return {
    requisicoes_usadas_nesta_execucao: requisicoesUsadasNestaExecucao,
    requisicoes_usadas_hoje_total: usoJaFeito + requisicoesUsadasNestaExecucao,
    limite_diario: LIMITE_DIARIO,
    resultado_por_liga: resultadoPorLiga,
  };
}

/**
 * rodarColetaNoturna()
 * Roda a coleta de TODOS os esportes configurados na whitelist, cada um
 * com sua própria cota. Erro num esporte não afeta os outros.
 */
async function rodarColetaNoturna(opcoes = {}) {
  const inicio = Date.now();
  const apiKey = opcoes.apiSportsKey || process.env.API_SPORTS_KEY;
  const margemSeguranca = opcoes.margemSeguranca ?? 10;
  const hoje = new Date().toISOString().slice(0, 10);
  const temporadaAtual = opcoes.temporada ?? new Date().getFullYear();

  const whitelist = carregarWhitelist();
  const esportes = Object.keys(whitelist).filter((chave) => !chave.startsWith('_'));

  const resultadoPorEsporte = {};

  for (const esporte of esportes) {
    const ligasHabilitadas = (whitelist[esporte].ligas || []).filter((liga) => liga.habilitada);
    if (ligasHabilitadas.length === 0) continue;

    try {
      resultadoPorEsporte[esporte] = await coletarUmEsporte(esporte, ligasHabilitadas, {
        apiKey,
        hoje,
        temporadaAtual,
        margemSeguranca,
      });
    } catch (erro) {
      resultadoPorEsporte[esporte] = { erro: erro.message };
    }
  }

  return {
    sucesso: true,
    tempo_ms: Date.now() - inicio,
    data_rodada: hoje,
    resultado_por_esporte: resultadoPorEsporte,
  };
}

module.exports = { rodarColetaNoturna };
