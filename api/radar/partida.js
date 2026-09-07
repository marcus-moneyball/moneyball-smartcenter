'use strict';

const { montarMercado } = require('../../src/montarMercadosRadar');
const { estruturarContexto } = require('../../src/interpretarContexto');
const { escreverArtigoPartida } = require('../../src/escreverArtigoPartida');
const { montarArtigoPartida } = require('../../src/relatorioPartida');
const { publicarRelatorioNoGhost } = require('../../src/ghostService');
const { calcularNoMoneyballPro } = require('../../src/proClient');
const { notificarResumoExecucao, notificarErroExecucao } = require('../../src/notificarTelegram');

const SPORT_KEY_PARA_ESPORTE = {
  soccer_epl: 'futebol',
  soccer_brazil_campeonato: 'futebol',
  basketball_nba: 'basquete',
  basketball_wnba: 'basquete',
  baseball_mlb: 'beisebol',
};

/**
 * Monta os destaques (mercados com EV positivo) a partir dos resultados do
 * Pro, cruzando de volta com os objetos de mercado originais (que carregam
 * o nome de exibição e a odd) pelo id.
 */
function montarDestaques(resultadosCalculo, mercadosMontados) {
  const mercadoPorId = Object.fromEntries(mercadosMontados.map((m) => [m.id, m]));

  return resultadosCalculo
    .filter((r) => r.status === 'calculado' && r.ev != null && r.ev > 0)
    .map((r) => {
      const original = mercadoPorId[r.id];
      if (!original) return null;
      const prob = original.lado_odd === 'under' ? r.probabilidade_under : r.probabilidade_over;
      return {
        mercado: original.id.split('-').slice(1).join(' ').replace(/_/g, ' '),
        selecao: `${original.lado_odd === 'under' ? 'Under' : 'Over'} ${original.linha}`,
        odd: original.odd_real_decimal,
        probabilidade_estimada: prob,
        ev: r.ev,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.ev - a.ev);
}

/**
 * POST /api/radar/partida
 * Body: ver contrato em smartcenter-radar-v4-plano.md
 */
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const inicio = Date.now();
  let confrontoNome = 'partida desconhecida';

  try {
    const segredoEsperado = process.env.CRON_SECRET;
    const auth = req.headers.authorization;
    if (segredoEsperado && auth !== `Bearer ${segredoEsperado}`) {
      return res.status(401).json({ sucesso: false, erro: 'Não autorizado.' });
    }

    const { confronto, mercados_visiveis, contexto_investigado, publicar } = req.body || {};
    if (!confronto?.match || !confronto?.sport_key || !Array.isArray(mercados_visiveis)) {
      return res.status(400).json({ sucesso: false, erro: 'Corpo inválido -- ver contrato em smartcenter-radar-v4-plano.md.' });
    }
    confrontoNome = confronto.match;

    // "Everton x Manchester United" -> time_a/time_b, necessário pros providers de stats
    const [timeA, timeB] = confronto.match.split(/\s+x\s+/i);
    const confrontoCompleto = { ...confronto, time_a: timeA?.trim(), time_b: timeB?.trim() };

    const esporte = SPORT_KEY_PARA_ESPORTE[confronto.sport_key];
    if (!esporte) {
      return res.status(400).json({ sucesso: false, erro: `sport_key "${confronto.sport_key}" não mapeado.` });
    }

    // --- Montar mercados calculáveis (pula os sem provider/dado, loga aviso) ---
    const mercadosMontados = [];
    const mercadosPulados = [];
    for (const item of mercados_visiveis) {
      const montado = await montarMercado(item, confrontoCompleto);
      if (montado) mercadosMontados.push(montado);
      else mercadosPulados.push(item.mercado);
    }

    // --- Estruturar contexto (Gemini, sem busca) --------------------------------
    const fatoresContexto = await estruturarContexto(contexto_investigado);

    // --- Calcular (Pro) ----------------------------------------------------------
    let destaques = [];
    if (mercadosMontados.length > 0) {
      const resultadosCalculo = await calcularNoMoneyballPro({
        esporte,
        mercados: mercadosMontados,
        fatoresIncerteza: fatoresContexto,
      });
      destaques = montarDestaques(resultadosCalculo, mercadosMontados);
    }

    // --- Escrever (Groq) -----------------------------------------------------------
    const analiseHtml = await escreverArtigoPartida(confronto, mercados_visiveis, destaques, fatoresContexto);

    // --- Montar e publicar ---------------------------------------------------------
    const artigo = montarArtigoPartida(confronto, mercados_visiveis, destaques, analiseHtml);
    const publicacao = await publicarRelatorioNoGhost(artigo, {
      status: publicar === 'published' ? 'published' : 'draft',
    });

    const resumo = {
      mercados_recebidos: mercados_visiveis.length,
      mercados_calculados: mercadosMontados.length,
      mercados_pulados: mercadosPulados,
      destaques: destaques.length,
    };

    await notificarResumoExecucao({
      nomeEsporte: `Radar: ${confronto.match}`,
      tempoMs: Date.now() - inicio,
      resumo: {
        total_coletado: mercados_visiveis.length,
        aprovados_filtro_qualidade: mercadosMontados.length,
        jogos_processados_com_sucesso: destaques.length > 0 ? 1 : 0,
      },
      publicacao,
    });

    return res.status(200).json({ sucesso: true, tempo_ms: Date.now() - inicio, resumo, publicacao });
  } catch (erro) {
    await notificarErroExecucao({ nomeEsporte: `Radar: ${confrontoNome}`, erro: erro.message });
    return res.status(500).json({ sucesso: false, erro: erro.message, tempo_ms: Date.now() - inicio });
  }
};
