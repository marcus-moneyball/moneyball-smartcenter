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
    const mercados = montarMercadosParaCalculo(odds, evento, stats);
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
    const podioBruto = montarPodio(resultadosCalculo, mercados, evento);

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
 * Converte odds cruas (The Odds API) + stats investigadas no formato real
 * que calcular_mercado()/estimar_lambda() do Pro esperam (ver api/calc.py):
 *   { id, linha, odd_real_decimal, lado_odd, tipo,
 *     media_marcada_time_a, media_sofrida_time_a,
 *     media_marcada_time_b, media_sofrida_time_b }
 * estimar_lambda() precisa dos 4 campos media_*; sem eles, calcular_mercado
 * devolve "sem_dados_suficientes" -- foi exatamente isso que aconteceu na
 * primeira versão deste arquivo (mandava um formato de moneyline que o Pro
 * não sabia interpretar).
 */
function montarMercadosParaCalculo(odds, evento, stats) {
  const mercados = [];
  const bookmaker = odds?.bookmakers?.[0];
  const totals = bookmaker?.markets?.find((m) => m.key === 'totals');
  const over = totals?.outcomes?.find((o) => o.name === 'Over');

  if (!over || over.point == null) {
    return mercados; // sem mercado de totais utilizável -- nada pra calcular
  }

  if (evento.esporte === 'futebol' && stats?.futebol) {
    const f = stats.futebol;
    mercados.push({
      id: `${evento.id_partida}-total_gols`,
      tipo: 'total_jogo',
      linha: over.point,
      odd_real_decimal: over.price,
      lado_odd: 'over',
      media_marcada_time_a: f.home_xg_ataque,
      media_sofrida_time_a: f.home_xga_defesa,
      media_marcada_time_b: f.away_xg_ataque,
      media_sofrida_time_b: f.away_xga_defesa,
    });
  } else if (evento.esporte === 'basquete' && stats?.basquete) {
    const b = stats.basquete;
    mercados.push({
      id: `${evento.id_partida}-total_pontos`,
      tipo: 'total_jogo',
      modelo: 'normal',
      linha: over.point,
      odd_real_decimal: over.price,
      lado_odd: 'over',
      media_marcada_time_a: b.home_xg_ataque,
      media_sofrida_time_a: b.home_xga_defesa,
      media_marcada_time_b: b.away_xg_ataque,
      media_sofrida_time_b: b.away_xga_defesa,
      desvio_padrao: 12,
    });
  }

  return mercados;
}

/**
 * Monta o pódio a partir dos resultados brutos do Pro. Duas coisas
 * importantes acontecem aqui que a versão anterior deste arquivo não fazia:
 *
 * 1. TRADUÇÃO DE CAMPOS: calcular_mercado() do Pro devolve
 *    { status, probabilidade_over, probabilidade_under, ev, ... } -- não
 *    tem "mercado"/"selecao"/"odd", que é o que relatorioBuilder.js espera
 *    pra exibir. Sem essa tradução, toda posição cai em "sem seleção
 *    segura o suficiente" mesmo quando o Pro calculou tudo certo -- foi
 *    exatamente isso que aconteceu nos primeiros testes reais.
 *
 * 2. EXIGÊNCIA DE EV POSITIVO: antes o filtro era só "ev != null", o que
 *    deixaria passar seleções com EV NEGATIVO (sem vantagem real) pro
 *    pódio. Agora exige ev > 0 de verdade -- por isso é esperado e
 *    correto que partidas com sinal fraco (ex: basquete, que hoje usa a
 *    própria linha do mercado como estimativa, sem vantagem real) apareçam
 *    como "sem seleção segura o suficiente": não é bug, é o sistema
 *    admitindo honestamente que não achou vantagem ali.
 */
function montarPodio(resultadosCalculo, mercadosOriginais, evento) {
  const mercadoPorId = Object.fromEntries((mercadosOriginais || []).map((m) => [m.id, m]));

  const posicoesValidas = resultadosCalculo
    .filter((r) => r.status === 'calculado' && r.ev != null && r.ev > 0)
    .map((r) => construirPosicaoExibicao(r, mercadoPorId[r.id], evento))
    .filter(Boolean)
    .sort((a, b) => b.ev - a.ev);

  return {
    ouro: posicoesValidas[0] || null,
    prata: posicoesValidas[1] || null,
    bronze: posicoesValidas[2] || null,
  };
}

function construirPosicaoExibicao(resultado, mercadoOriginal, evento) {
  if (!mercadoOriginal) return null; // não deveria acontecer (ids sempre batem), mas não quebra se acontecer

  const ladoUnder = mercadoOriginal.lado_odd === 'under';
  const probabilidade = ladoUnder ? resultado.probabilidade_under : resultado.probabilidade_over;
  const nomeMercado = evento.esporte === 'futebol' ? 'Total de Gols' : 'Total de Pontos';

  return {
    mercado: nomeMercado,
    selecao: `${ladoUnder ? 'Under' : 'Over'} ${mercadoOriginal.linha}`,
    odd: mercadoOriginal.odd_real_decimal,
    probabilidade_estimada: probabilidade,
    ev: resultado.ev,
  };
}

module.exports = { processarPartidaRadar };
