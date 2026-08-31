'use strict';

const { calcularNoMoneyballPro } = require('./proClient');
const { investigarContexto } = require('./contextInvestigator');
const { escreverJustificativa } = require('./groqJustificativa');
const { buscarPolymarket } = require('./coletores/polymarket');
const { buscarTips } = require('./coletores/tips');

/**
 * processarPartidaRadar(payload)
 *
 * Este é o arquivo que faltava no pacote original (relatorio-rodada.js já
 * importava daqui, mas o módulo não existia). Orquestra, para UMA partida
 * já aprovada pelo filtroQualidade.js:
 *
 *   1. Busca contexto adicional: Polymarket + tips de tipsters (stubs por
 *      enquanto, fail-open)
 *   2. Gemini investiga esse contexto -> fatores_incerteza + segunda
 *      aprovação (camada de julgamento, além da completude estrutural)
 *   3. Monta o payload de "mercados" a partir das odds coletadas e chama
 *      o Pro (/api/v1/calc) -- TODA a matemática (EV, Kelly, probabilidade,
 *      roteiro, matchup) acontece lá, não aqui
 *   4. Monta o Pódio (Ouro/Prata/Bronze) a partir do resultado do Pro
 *   5. Groq escreve a justificativa de cada posição do pódio (só texto)
 *
 * Contrato de retorno esperado por relatorio-rodada.js / relatorioBuilder.js:
 *   sucesso -> { sucesso: true, id_partida, confronto, liga, esporte, podio, alertas }
 *   falha   -> { sucesso: false, id_partida, etapa, erros }
 */
async function processarPartidaRadar(payload) {
  const { evento, cotacoes_odds_api_bruto: odds, metricas_sports_api: stats } = payload;
  const idPartida = evento.id_partida;

  try {
    // --- 1. Contexto adicional ---------------------------------------
    const [polymarket, tips] = await Promise.all([
      buscarPolymarket({ timeA: evento.time_a, timeB: evento.time_b, esporte: evento.esporte }),
      buscarTips({ timeA: evento.time_a, timeB: evento.time_b, esporte: evento.esporte }),
    ]);

    // --- 2. Investigação (Gemini) --------------------------------------
    const investigacao = await investigarContexto({ evento, polymarket, tips });

    if (!investigacao.aprovadoPeloInvestigador) {
      return {
        sucesso: false,
        id_partida: idPartida,
        etapa: 'investigacao_contexto',
        erros: [investigacao.motivo || 'Contexto reprovado pelo investigador (Gemini).'],
      };
    }

    // --- 3. Cálculo (Pro) -----------------------------------------------
    const mercados = montarMercadosParaCalculo(odds, evento);
    if (mercados.length === 0) {
      return {
        sucesso: false,
        id_partida: idPartida,
        etapa: 'montagem_mercados',
        erros: ['Nenhum mercado utilizável extraído das odds coletadas.'],
      };
    }

    const resultadosCalculo = await calcularNoMoneyballPro({
      esporte: evento.esporte,
      mercados,
      fatoresIncerteza: investigacao.fatoresIncerteza,
    });

    // --- 4. Montar o pódio -----------------------------------------------
    const podioBruto = montarPodio(resultadosCalculo);

    // --- 5. Justificativa (Groq) ------------------------------------------
    const contextoParaTexto = { evento, fatoresIncerteza: investigacao.fatoresIncerteza };
    const podio = {};
    for (const chave of ['ouro', 'prata', 'bronze']) {
      const posicao = podioBruto[chave];
      podio[chave] = posicao
        ? { ...posicao, justificativa_curta: await escreverJustificativa(posicao, contextoParaTexto) }
        : null;
    }

    const alertas = investigacao.fatoresIncerteza
      .filter((f) => f.impact_level === 'high')
      .map((f) => f.descricao);

    return {
      sucesso: true,
      id_partida: idPartida,
      confronto: { mandante: evento.time_a, visitante: evento.time_b },
      liga: evento.liga,
      esporte: evento.esporte,
      podio,
      alertas,
    };
  } catch (erro) {
    return {
      sucesso: false,
      id_partida: idPartida,
      etapa: 'erro_inesperado',
      erros: [erro.message],
    };
  }
}

/**
 * Converte as odds cruas (formato da The Odds API) no formato de "mercados"
 * que o Pro espera em /api/v1/calc. Ajuste conforme o formato real que
 * calcular_dossie() espera por mercado (ver api/calc.py e api/candidatos.py
 * no repo do Pro) -- aqui cobrindo só moneyline/h2h como ponto de partida.
 */
function montarMercadosParaCalculo(odds, evento) {
  const mercados = [];
  const bookmaker = odds?.bookmakers?.[0];
  const h2h = bookmaker?.markets?.find((m) => m.key === 'h2h');

  if (h2h) {
    mercados.push({
      tipo: 'moneyline',
      time_a: evento.time_a,
      time_b: evento.time_b,
      odds: Object.fromEntries(h2h.outcomes.map((o) => [o.name, o.price])),
    });
  }

  return mercados;
}

/**
 * Ordena os resultados calculados pelo Pro (por EV, já que é o critério que
 * o próprio Pro usa como norte -- ver docstring de prompts_mie2.py) e monta
 * o pódio. Puramente ordenação/seleção, nenhum recálculo.
 */
function montarPodio(resultadosCalculo) {
  const ordenados = [...resultadosCalculo]
    .filter((r) => r.ev != null)
    .sort((a, b) => b.ev - a.ev);

  return {
    ouro: ordenados[0] || null,
    prata: ordenados[1] || null,
    bronze: ordenados[2] || null,
  };
}

module.exports = { processarPartidaRadar };
