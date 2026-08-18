'use strict';

const fs = require('fs');
const path = require('path');
const { criarClienteOddsApi } = require('./oddsApiService');
const db = require('./db');

function carregarWhitelist() {
  const caminho = path.join(process.cwd(), 'config', 'odds-api-whitelist.json');
  const conteudo = fs.readFileSync(caminho, 'utf-8');
  return JSON.parse(conteudo).sport_keys.filter((s) => s.habilitado);
}

/**
 * rodarColetaOddsApi()
 * 1 chamada por sport_key da whitelist — cada chamada já devolve todos os
 * jogos daquele esporte/liga. Sem controle de orçamento manual aqui porque
 * a The Odds API já limita por créditos/mês (não por dia) e devolve a cota
 * restante no header — só registramos, não bloqueamos.
 */
async function rodarColetaOddsApi(opcoes = {}) {
  const inicio = Date.now();
  const apiKey = opcoes.oddsApiKey || process.env.ODDS_API_KEY;
  const cliente = criarClienteOddsApi(apiKey);
  const whitelist = carregarWhitelist();

  const resultadoPorEsporte = [];
  let ultimaCotaRestante = null;

  for (const item of whitelist) {
    try {
      const { eventos, cotaRestante, cotaUsada } = await cliente.buscarOddsPorEsporte(item.sport_key);
      ultimaCotaRestante = cotaRestante;

      const eventosParaGravar = eventos.map((evento) => ({
        sportKey: item.sport_key,
        eventoId: evento.id,
        timeCasa: evento.home_team,
        timeVisitante: evento.away_team,
        comecaEm: evento.commence_time,
        snapshots: (evento.bookmakers || []).flatMap((bookmaker) =>
          (bookmaker.markets || []).flatMap((mercado) =>
            (mercado.outcomes || []).map((selecao) => ({
              bookmaker: bookmaker.title,
              mercado: mercado.key,
              selecao: selecao.name,
              valor: Number(selecao.price),
            }))
          )
        ),
      }));

      await db.inserirOddsApiSnapshots(eventosParaGravar);

      resultadoPorEsporte.push({
        sport_key: item.sport_key,
        nome: item.nome,
        status: 'ok',
        eventos_coletados: eventos.length,
        cota_restante_apos_chamada: cotaRestante,
        cota_usada_apos_chamada: cotaUsada,
      });
    } catch (erro) {
      resultadoPorEsporte.push({ sport_key: item.sport_key, nome: item.nome, status: 'erro', erro: erro.message });
    }
  }

  return {
    sucesso: true,
    tempo_ms: Date.now() - inicio,
    cota_restante_final: ultimaCotaRestante,
    resultado_por_esporte: resultadoPorEsporte,
  };
}

module.exports = { rodarColetaOddsApi };
