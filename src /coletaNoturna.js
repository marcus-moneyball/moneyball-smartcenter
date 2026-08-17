'use strict';

const fs = require('fs');
const path = require('path');
const { criarClienteApiSports, LIMITE_DIARIO } = require('./apiSportsService');
const db = require('./db');

function carregarWhitelist() {
  const caminho = path.join(process.cwd(), 'config', 'leagues-whitelist.json');
  const conteudo = fs.readFileSync(caminho, 'utf-8');
  return JSON.parse(conteudo).ligas.filter((liga) => liga.habilitada);
}

/**
 * rodarColetaNoturna()
 *
 * Fluxo: pra cada liga habilitada na whitelist —
 *   1) busca fixtures do dia (1 chamada)
 *   2) busca odds do dia (1 chamada)
 *   3) busca estatística só dos times que jogam hoje E não têm cache recente
 * Para de gastar cota assim que chega perto do limite diário — nunca estoura.
 *
 * @returns {Promise<Object>} resumo da execução (nunca lança — erro por liga
 *   é isolado, uma liga falhando não derruba as outras)
 */
async function rodarColetaNoturna(opcoes = {}) {
  const inicio = Date.now();
  const apiKey = opcoes.apiSportsKey || process.env.API_SPORTS_KEY;
  const cliente = criarClienteApiSports(apiKey);
  const margemSeguranca = opcoes.margemSeguranca ?? 10; // para de gastar cota faltando N requisições pro limite

  const whitelist = carregarWhitelist();
  const hoje = new Date().toISOString().slice(0, 10);
  const temporadaAtual = opcoes.temporada ?? new Date().getFullYear();

  const usoJaFeito = await db.obterUsoApiSportsHoje();
  let requisicoesUsadasNestaExecucao = 0;

  const resultadoPorLiga = [];

  async function orcamentoDisponivel() {
    return usoJaFeito + requisicoesUsadasNestaExecucao < LIMITE_DIARIO - margemSeguranca;
  }

  async function registrarChamada() {
    requisicoesUsadasNestaExecucao += 1;
    await db.registrarUsoApiSports(1);
  }

  for (const liga of whitelist) {
    if (!(await orcamentoDisponivel())) {
      resultadoPorLiga.push({ liga: liga.nome, status: 'pulada_orcamento_esgotado' });
      continue;
    }

    try {
      const ligaId = await db.upsertLiga({
        apiSportsId: liga.api_sports_id,
        nome: liga.nome,
        pais: liga.pais,
        pontosCorridos: liga.pontos_corridos,
      });

      // 1 chamada: todos os jogos da liga hoje
      const fixturesBrutos = await cliente.buscarFixturesPorLigaEData(liga.api_sports_id, hoje, temporadaAtual);
      await registrarChamada();

      if (fixturesBrutos.length === 0) {
        resultadoPorLiga.push({ liga: liga.nome, status: 'sem_jogos_hoje' });
        continue;
      }

      const fixtureIdsInternos = [];
      const timesParaStats = new Set();

      for (const item of fixturesBrutos) {
        const timeCasaId = await db.upsertTime({
          apiSportsId: item.teams.home.id,
          nome: item.teams.home.name,
          ligaId,
        });
        const timeVisitanteId = await db.upsertTime({
          apiSportsId: item.teams.away.id,
          nome: item.teams.away.name,
          ligaId,
        });

        const fixtureId = await db.upsertFixture({
          apiSportsId: item.fixture.id,
          ligaId,
          timeCasaId,
          timeVisitanteId,
          temporada: temporadaAtual,
          dataHora: item.fixture.date,
          status: item.fixture.status?.short ?? null,
        });

        fixtureIdsInternos.push({ apiSportsId: item.fixture.id, id: fixtureId });
        timesParaStats.add(JSON.stringify({ apiSportsId: item.teams.home.id, id: timeCasaId }));
        timesParaStats.add(JSON.stringify({ apiSportsId: item.teams.away.id, id: timeVisitanteId }));
      }

      // 1 chamada: odds de TODOS os jogos da liga hoje
      let oddsInseridas = 0;
      if (await orcamentoDisponivel()) {
        const oddsBrutas = await cliente.buscarOddsPorLigaEData(liga.api_sports_id, hoje, temporadaAtual);
        await registrarChamada();

        for (const itemOdds of oddsBrutas) {
          const fixtureCorrespondente = fixtureIdsInternos.find((f) => f.apiSportsId === itemOdds.fixture.id);
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

      // Estatística de time — só quem joga hoje, e só se não tem cache recente
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
        jogos_coletados: fixturesBrutos.length,
        odds_inseridas: oddsInseridas,
        stats_de_time_atualizadas: statsAtualizadas,
      });
    } catch (erro) {
      resultadoPorLiga.push({ liga: liga.nome, status: 'erro', erro: erro.message });
    }
  }

  return {
    sucesso: true,
    tempo_ms: Date.now() - inicio,
    data_rodada: hoje,
    requisicoes_usadas_nesta_execucao: requisicoesUsadasNestaExecucao,
    requisicoes_usadas_hoje_total: usoJaFeito + requisicoesUsadasNestaExecucao,
    limite_diario: LIMITE_DIARIO,
    resultado_por_liga: resultadoPorLiga,
  };
}

module.exports = { rodarColetaNoturna };
